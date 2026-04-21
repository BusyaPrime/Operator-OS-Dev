# Technical Debt Registry

Living list of known tech debt. Each entry is trackable: discovered date,
type, priority, status, fix plan. Keep honest - if an item turns out to
be wrong, update it or close it as `wontfix`.

## Entry format

```
## TD-NNN: <Title, specific>
Discovered: YYYY-MM-DD (during PR-X investigation)
Type: dead-code | security | compliance | performance | maintainability | tech-gap
Priority: P1 (urgent) | P2 (important) | P3 (nice-to-have)
Status: open | in-progress | resolved | wontfix

### Description
### Risk if unaddressed
### Proposed fix
### Related
### History
```

---

## TD-001: Dead stub module in `apps/api/src/modules/commands/index.ts`

Discovered: 2026-04-22 (during P0.1 diagnostic sweep)
Type: dead-code
Priority: P3
Status: open

### Description

`apps/api/src/modules/commands/index.ts` builds a stub readiness module via
`createStubModule` and exports it as `commandsModule`. That module is
aggregated in `apps/api/src/modules/index.ts:operatorModules`, but
`apps/api/src/app.ts` never imports `operatorModules` from
`./modules/index.js`. The composition root builds its own inline
`operatorModules` array from `CommandsService`, `ExportsService`, etc. -
the real wiring. The `modules/*` tree is leftover scaffolding.

### Risk if unaddressed

Cognitive overhead for anyone reading the `apps/api/src/modules/` tree
expecting it to be real. Risk of divergence if someone edits only one of
the two parallel definitions. Small security risk: a future reviewer may
assume `commandsModule` is the canonical readiness source and update it
without realising the route layer uses `CommandsService.describeReadiness()`.

### Proposed fix

Delete `apps/api/src/modules/commands/index.ts`,
`apps/api/src/modules/exports/index.ts`, and any other unused siblings.
Keep `apps/api/src/modules/index.ts` only if something still consumes it -
grep confirms nothing does, so the whole `modules/` tree is likely
removable. ~1 hour.

### Related

- Discovered in: P0.1 (PR #1 investigation)
- References: `apps/api/src/app.ts` lines 82-98 for the real inline array

### History

- 2026-04-22: discovered during PR-1 scope audit.

---

## TD-002: Dead stub module in `apps/api/src/modules/exports/index.ts`

Discovered: 2026-04-22 (during P0.1 diagnostic sweep)
Type: dead-code
Priority: P3
Status: open

### Description

Mirror of TD-001 for exports. `exportsModule` in
`apps/api/src/modules/exports/index.ts` is aggregated into
`operatorModules` in `apps/api/src/modules/index.ts` but never consumed
by `apps/api/src/app.ts`. Real exports readiness comes from
`ExportsService.describeReadiness()`.

### Risk if unaddressed

Same as TD-001: cognitive overhead and divergence risk.

### Proposed fix

Handle together with TD-001 as a single cleanup PR.

### Related

- Discovered in: P0.1 (PR #1 investigation)
- Linked: TD-001

### History

- 2026-04-22: discovered during PR-1 scope audit.

---

## TD-003: `:latest` image tag in `infra/cloud-run/api.service.yaml`

Discovered: 2026-04-22 (during P0.1 diagnostic sweep)
Type: compliance
Priority: P2
Status: open

### Description

`infra/cloud-run/api.service.yaml` line 15 pins the runtime image to
`europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:latest`.
`:latest` is a moving tag. CLAUDE.md rule R9 requires explicit tagged
references (git SHA) for Cloud Run deploys so rollback and audit stay
deterministic.

### Risk if unaddressed

- Rollback is unreliable: the manifest cannot be used to reproduce a
  specific revision because `:latest` resolves to whatever was pushed
  most recently.
- Deploy race conditions: if two deploys run in parallel, one can
  overwrite `:latest` between the build push and the Cloud Run
  apply, pulling the wrong image into the new revision.
- Audit trail gap: auditing a past deploy cannot answer "what exactly
  was running" from the YAML alone.

### Proposed fix

- Replace the hard-coded `:latest` with a templated substitution
  (`${IMAGE_TAG}` or `${IMAGE_SHA}`) that the deploy pipeline fills in.
- Update `infra/scripts/deploy-api.ps1` and `infra/cloudbuild/api.cloudbuild.yaml`
  to pass the git SHA (or a tag derived from it) into the substitution.
- Document in `docs/DEPLOY.md` that the YAML is a template, not a
  runnable manifest.

Estimate: ~2 hours including verifying Cloud Build substitutions.

### Related

- Architecture law: LAW #4 (security-first), LAW #5 (verifiable honesty).
- CLAUDE.md rule: R9.
- References: `infra/cloud-run/api.service.yaml`,
  `infra/scripts/deploy-api.ps1`, `infra/cloudbuild/api.cloudbuild.yaml`.

### History

- 2026-04-22: noted during PR-1 review, not fixed in PR-1 (out of
  scope).

---

## TD-004: Missing OIDC verification middleware for `/internal/tasks/*`

Discovered: 2026-04-22 (introduced alongside PR #1)
Type: security
Priority: P2
Status: open

### Description

PR #1 added stub handlers under `/internal/tasks/commands`,
`/internal/tasks/approvals`, `/internal/tasks/exports`. Cloud Tasks
delivers jobs to these paths with an OIDC ID token issued to
`cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`. The current
security posture relies on two layers:

1. Cloud Run is deployed with `--no-allow-unauthenticated`, so only
   callers with `roles/run.invoker` on the service can reach it.
2. The runtime service account has `run.invoker` for Cloud Tasks -> this
   service specifically.

A third defence-in-depth layer is missing: the handlers themselves do not
inspect the `Authorization: Bearer <id_token>` header. They trust that
Cloud Run rejected unauthenticated callers upstream.

### Risk if unaddressed

- If Cloud Run IAM is ever misconfigured (manifest drift, UI accident,
  policy migration), the handlers become reachable by the broader
  world without an in-process safety net.
- No audit of the calling identity on the application side: the request
  log shows `task_received` but not "caller was runtime SA via OIDC".
- Cannot distinguish a Cloud Tasks dispatch from an in-cluster request
  that happens to have `run.invoker`.

### Proposed fix

Add a Fastify `preHandler` hook scoped to `/internal/tasks/*` that:

1. Reads `Authorization: Bearer <token>`; 401 if absent.
2. Verifies the token with `google-auth-library` (`OAuth2Client.verifyIdToken`).
3. Asserts `audience` equals the service URL.
4. Asserts `issuer` equals `https://accounts.google.com`.
5. Optionally asserts `email` matches
   `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`.
6. Logs the verified identity in the `task_received` event.

Estimate: ~4 hours including unit tests with a stubbed verifier.

### Related

- Architecture laws: LAW #4 (security-first), LAW #5 (verifiable honesty).
- Discovered in: PR #1.
- References: `apps/api/src/routes/internal-tasks.ts`,
  `apps/api/src/integrations/auth.ts`.

### History

- 2026-04-22: introduced as an acknowledged gap in PR #1; filed here
  so it does not slip.

---

## TD-005: `/v1/agent/*` and `/v1/ai/*` routes are anonymous

Discovered: 2026-04-22 (during P0.1 diagnostic sweep)
Resolved: 2026-04-22 (Day 2, PR #6, Cloud Run revision operator-os-api-00006-zng)
Type: security
Priority: P1
Status: resolved

### Description

Routes registered in `apps/api/src/routes/agent.ts` and
`apps/api/src/routes/ai.ts` do not require authentication. The
`FirebaseAuthService` exposes both `createOptionalGuard()` and
`createRequiredGuard()` skeletons, but neither is wired in on those
routes.

- `POST /v1/agent/heartbeat`, `GET /v1/agent/commands`, `POST /v1/agent/sessions`, `POST /v1/agent/exports`, `POST /v1/agent/alerts`
- `POST /v1/commands`, `POST /v1/sessions`
- `POST /v1/ai/summarize/operator-state`, `POST /v1/ai/explain/agent-activity`, `POST /v1/ai/suggest-cost-optimizations`, `POST /v1/ai/plan-task-breakdown`

### Risk if unaddressed

- Any caller with `run.invoker` on the Cloud Run service can fake
  heartbeats, sessions, alerts for arbitrary `deviceId` values, writing
  forged data to Firestore, Pub/Sub, and BigQuery.
- Cloud Run currently requires authenticated callers, which gates the
  attack surface, but the anonymous-route model is not safe against a
  future `--allow-unauthenticated` flip or a broader invoker grant.
- `/v1/ai/*` calls Vertex AI and bills tokens. Unauthenticated callers
  inside the Cloud Run trust boundary can burn token budget with no
  attribution.

### Proposed fix

- Attach `createRequiredGuard()` to `/v1/agent/*` and `/v1/ai/*`.
- For `/v1/agent/*`: accept either a Firebase ID token (human
  operator) or an OIDC ID token for the desktop-agent service identity.
- For `/v1/ai/*`: add per-operator rate limiting (CLAUDE.md R19) and a
  token-per-call cap (R19).
- `/v1/operator/*` read endpoints: use `createOptionalGuard()` so the
  mobile dashboard can still run in bootstrap-fallback, but start
  enforcing on privileged writes.

Estimate: ~1 day including tests and a small desktop-agent update to
attach its token.

### Related

- Architecture laws: LAW #4 (security-first).
- CLAUDE.md rules: R16 (integration tests for auth), R19 (AI cost
  control).
- References: `apps/api/src/routes/agent.ts`, `apps/api/src/routes/ai.ts`,
  `apps/api/src/integrations/auth.ts`, `apps/desktop-agent/src/api-client.ts`.

### History

- 2026-04-22: discovered during P0.1 diagnostic sweep; captured here
  so the auth rollout can be scoped properly.
- 2026-04-22 (Day 2, PR #6): resolved. `createRequiredGuard()` on
  `/v1/ai/*`, `createAgentGuard(audience)` on `/v1/agent/*` plus
  `/v1/commands` and `/v1/sessions`. Deployed as revision
  `operator-os-api-00006-zng`. Verified live: Cloud Run IAM returns
  403 for unauthenticated callers; authenticated callers with
  wrong-audience OIDC tokens get 401 from the agent guard; non-
  Firebase tokens hitting `/v1/ai/*` currently surface as 502
  upstream_error, which is tracked separately as TD-009.

---

## TD-006: CI workflow does not trigger on `phase3/**` pushes

Discovered: 2026-04-22 (during P0.1 diagnostic sweep)
Type: tech-gap
Priority: P2
Status: open

### Description

`.github/workflows/ci.yml` trigger block lists
`main`, `bootstrap/**`, `phase2/**`, `feature/**`, `chore/**`. Current
active branch is `phase3/live-deploy-and-vertex`. Pushes to `phase3/*`
do not trigger CI. PRs still run CI via the `pull_request:` trigger, so
merges are gated, but direct pushes (merge commits, hotfix pushes) are
not.

### Risk if unaddressed

- Merge commits landing on `phase3/*` without a PR (e.g., admin merge,
  command-line push) skip the quality gate.
- A green PR merged via squash produces a new commit on `phase3/*`
  that is never re-validated in its final form.

### Proposed fix

Add `phase3/**` (and `feat/**`, to match the branch slug convention in
use) to the `push.branches` list in `.github/workflows/ci.yml`.

Estimate: 15 minutes.

### Related

- CLAUDE.md rules: R16.
- References: `.github/workflows/ci.yml`.

### History

- 2026-04-22: discovered; safe trivial fix, will be folded into the
  next chore pass.

---

## TD-008: `infra/scripts/deploy-api.ps1` variable interpolation is broken

Discovered: 2026-04-22 (during P0.1 Phase D deploy attempt)
Type: tech-gap
Priority: P2
Status: open

### Description

`infra/scripts/deploy-api.ps1` line 17 builds the image URI as:

```
$ImageUri = "europe-west4-docker.pkg.dev/$ProjectId/$Repository/$ServiceName:$ImageTag"
```

Windows PowerShell parses `$ServiceName:$ImageTag` as a drive-qualified
variable reference (colon is a drive-scope separator), which throws
`InvalidVariableReferenceWithDrive`. The script cannot even enter its
first real step.

### Risk if unaddressed

- The documented deploy path in `docs/DEPLOY.md` (`.\infra\scripts\deploy-api.ps1 -ImageTag <tag> -UseCloudBuild -Deploy`)
  is non-functional on Windows PowerShell 5.1.
- Anyone following `docs/DEPLOY.md` verbatim will hit a parser error
  and have to bypass the script (calling `gcloud builds submit`
  manually with the right substitutions, which is what the P0.1
  Phase D deploy actually did).
- This is a deploy footgun: the last verified deploy before P0.1
  (`operator-os-api-00003-rzm` in pass 3) was produced through this
  script, meaning either the script was working in a different shell
  or the blocker was introduced between pass 3 and P0.1. Until the
  script is fixed, the docs are lying about how to deploy.

### Proposed fix

- Wrap every ambiguous variable reference in `${}` to force
  PowerShell to stop at the closing brace:
  - Line 17: `"europe-west4-docker.pkg.dev/${ProjectId}/${Repository}/${ServiceName}:${ImageTag}"`
- Audit the rest of the script for similar patterns (`$SomeName:`).
- Add a smoke run on a harmless tag to CI so the script does not
  regress again.

Estimate: ~30 minutes including smoke.

### Related

- Discovered in: P0.1 Phase D (PR-3 session).
- References: `infra/scripts/deploy-api.ps1:17`, `docs/DEPLOY.md`.

### History

- 2026-04-22: hit `InvalidVariableReferenceWithDrive` when trying to
  run the script from Git Bash via `powershell.exe -File`. Bypassed
  by calling `gcloud builds submit` directly with the substitutions
  the script would have passed. Script itself still broken.

---

## TD-007: `docs/DECISIONS.md` is not in ADR format

Discovered: 2026-04-22 (during P0.1 diagnostic sweep)
Type: maintainability
Priority: P3
Status: open

### Description

CLAUDE.md rule R15 requires architectural decisions to be recorded as
ADRs with number, date, status, context, decision, consequences. The
current `docs/DECISIONS.md` is a flat bullet list without numbering,
dates, or status fields. It is useful but not trackable over time:
there is no way to mark a decision as superseded, no way to see when
it was made, no way to cross-reference from code or PRs.

### Risk if unaddressed

- Decisions accumulate without status; revisiting a stale decision is
  hard.
- No way to link a PR to the ADR it implements.
- LAW #5 concern: decisions made during bootstrap may be assumed
  current when they are actually stale.

### Proposed fix

- Renumber existing decisions as ADR-001, ADR-002, ...
- Add YAML frontmatter or a standard ADR header block (date, status,
  context, decision, consequences).
- Decision: either rewrite `docs/DECISIONS.md` in place, or split into
  `docs/decisions/ADR-XXX-title.md` individual files.
- Document the chosen format in CLAUDE.md rule R15 as normative.

Estimate: ~3 hours for the rewrite plus tooling.

### Related

- CLAUDE.md rules: R15.
- References: `docs/DECISIONS.md`.

### History

- 2026-04-22: discovered.

---

## TD-009: `/v1/ai/*` returns 502 upstream_error instead of 401 for invalid tokens

Discovered: 2026-04-22 (Day 2 TD-005 post-deploy verification)
Type: maintainability
Priority: P3
Status: open

### Description

`createRequiredGuard()` on `/v1/ai/*` calls
`resolveSession(authorization, { strict: true })`. When the supplied
bearer token is well-formed but fails Firebase verification (for
example a valid Google OIDC token with the wrong audience), the
strict path throws an `IntegrationError{code:'upstream_error',
statusCode:502}` mapped by `mapGoogleIntegrationError('auth', ...)`.

The global error handler returns the 502 verbatim, so the client
sees HTTP 502 for what is really a client-side authentication
failure.

Verified live on revision `operator-os-api-00006-zng`: a valid
Google OIDC user token (from `gcloud auth print-identity-token`)
posted to `/v1/ai/summarize/operator-state` returns 502 with body
`{"code":"upstream_error","dependency":"auth","details":{...aud
mismatch...}}`.

### Risk if unaddressed

- Client developers reading 502 assume the server crashed. They may
  retry aggressively instead of fixing their token.
- 5xx response rates look like service regression in monitoring
  dashboards; a real 5xx can be missed in the noise.
- LAW #5 (verifiable honesty): the response code does not describe
  the actual failure.

### Proposed fix

In `FirebaseAuthService.verifyFirebaseIdToken`, catch errors that
indicate token-validation failure (invalid signature, wrong
audience, expired, revoked) and throw
`IntegrationError{code:'unauthenticated', statusCode:401}` instead
of letting `mapGoogleIntegrationError` produce `upstream_error`.

Same applies to `verifyGoogleIdToken` for OIDC-verification errors
when the guard path does not fall back.

Estimated fix: ~1 hour including tests.

### Related

- Discovered in: Day 2 TD-005 deploy verification.
- References: `apps/api/src/integrations/auth.ts`,
  `apps/api/src/integrations/runtime.ts` (`mapGoogleIntegrationError`).
- Architecture laws: LAW #5.

### History

- 2026-04-22: discovered during TD-005 deploy probe.
