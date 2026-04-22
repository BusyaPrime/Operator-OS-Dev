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
- 2026-04-23 (Phase C.2): fully extended. PR #11 (`990ccb4`)
  added the HS256 `AccessTokenVerifier` fallback so the guard
  accepts auth-gateway-issued JWTs in addition to Firebase ID
  tokens. PR #11 code was merged on 2026-04-22 but the
  `operator-os-api` image stayed on `phase3-b7ad606` for over a
  day — the deploy gap is now tracked as TD-015. During Phase
  C.2 the image was rebuilt and deployed as revision
  `operator-os-api-00007-7q6` (`phase3-ceded57`), at which
  point verification 5.6 (mobile-side HS256 JWT → api →
  Vertex AI) returned HTTP 200 end-to-end. TD-005 now closed
  with real production evidence, not just merged code.

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

---

## TD-010: `packages/contracts` missing Universal AI interfaces

Discovered: 2026-04-23 (during Phase B SPEC update, PR #13)
Resolved: 2026-04-24 (Week 2 Phase 1.3, PR for TD-010)
Type: tech-gap
Priority: P2
Status: resolved

### Description

SPEC § 61 (rewritten in PR #13) references four interfaces as the
public surface of the Universal AI Control Platform:

- `AIAgent`
- `FileSystemProvider`
- `StreamProvider`
- `CostProvider`

Plus the supporting types: `AIVendor`, `Capability`,
`AgentConfig`, `Task`, `AgentResult`, `OutputChunk`,
`AgentStatus`, `ResourceMetrics`, `UsageEvent`, `PricingInfo`,
`CostEstimate`, `FileInfo`, `FileChange`.

None of these types currently exist in `packages/contracts`. Any
Week 2 Desktop Agent code that tries to
`import { AIAgent } from '@operator-os/contracts'` will fail at
typecheck. The SPEC also states that the legacy `AIProvider`
completion shape is "no longer re-exported from
`@operator-os/contracts`", which is technically true only because
no such export ever existed — but the statement reads as if the
removal were intentional bookkeeping, and a future reader may
waste time looking for it.

### Risk if unaddressed

- Week 2 Desktop Agent cannot be implemented against SPEC.
- The first agent to land will either hardcode Claude-Code-
  specific types (directly violating LAW #3 and the Universal AI
  ADR) or reinvent the interfaces locally, guaranteeing drift
  from SPEC.
- Refactor cost grows with every file added on top of whatever
  ad-hoc shape is used, exactly the exponential-debt scenario
  the ADR was written to prevent.
- Every hour the contracts package stays empty, the gap between
  SPEC and code widens and LAW #5 (verifiable honesty) degrades:
  the spec claims a public surface that does not exist.

### Proposed fix

First atomic commit of the Week 2 Desktop Agent branch:

- `packages/contracts/src/ai-agent.ts` — `AIAgent`, `AIVendor`,
  `Capability`, `AgentConfig`, `Task`, `AgentResult`,
  `AgentStatus`, `ResourceMetrics`.
- `packages/contracts/src/filesystem-provider.ts` —
  `FileSystemProvider`, `FileInfo`, `FileChange`,
  `FileChangeHandler`, `Unsubscribe`.
- `packages/contracts/src/stream-provider.ts` —
  `StreamProvider`, `OutputChunk` (shared with `ai-agent.ts` via
  re-export, not duplication).
- `packages/contracts/src/cost-provider.ts` — `CostProvider`,
  `UsageEvent`, `PricingInfo`, `CostEstimate`.
- Re-export all four interfaces (and their supporting types)
  from `packages/contracts/src/index.ts`.
- Types-only — no runtime logic, no dependencies beyond
  TypeScript.
- Add Vitest type-level tests (`expectTypeOf` from `vitest`) for
  each interface so drift from SPEC fails CI.

Estimated work: 2-3 hours.

### Related

- Discovered in: PR #13 Phase B (2026-04-23).
- Blocks: Week 2 Desktop Agent implementation (§ 129 in SPEC).
- References: SPEC § 61 (interface definitions), SPEC § 62-66.7
  (agent implementations that will consume the interfaces), SPEC
  § 27 (Desktop Agent and Provider Registry), DECISIONS.md ADR
  *Adopt Universal AI Control Platform Architecture* (2026-04-23).

### History

- 2026-04-23: filed during Phase C.1 as pre-work for Week 2.
- 2026-04-24 (Week 2 Phase 1.3, PR for TD-010): resolved. Landed
  `packages/contracts/src/ai/` with the four canonical interfaces
  (`AIAgent`, `FileSystemProvider`, `StreamProvider`,
  `CostProvider`) plus supporting types (`AIAgentIdentity`,
  `AIAgentRuntime`, `AIAgentStatus`, task types, `AgentManifest`,
  `AgentCapability`), an error hierarchy (`AIAgentError` base +
  three subclasses), and 90 new `expectTypeOf` tests under
  `__tests__/`. SPEC `§ 61-66.7` updated to v1.1 to match the
  landed shapes; the `§ 27` ClaudeCodeAgent reference
  implementation was rewritten against v1.1. Two new ADRs record
  the SPEC evolution + the type-level testing convention.
  Consumer packages can now
  `import { AIAgent } from '@operator-os/contracts'`.
  Week 2 Phase 1.4 (Desktop Agent incremental upgrade) is
  unblocked.

---

## TD-011: Cloud Run reserved environment variable pattern

Discovered: 2026-04-23 (during Phase C.2 step 8 deploy failure)
Type: tech-gap + documentation
Priority: P3
Status: resolved

### Description

Cloud Run reserves a set of environment variable names and
rejects any deploy that sets them via `--set-env-vars`,
`--update-env-vars`, or a declarative `env:` block in a
`gcloud run services replace` manifest. Reserved names (per the
container contract):

- `PORT` — auto-set to the `--port` value (or 8080 default).
- `K_SERVICE` — Cloud Run service name.
- `K_REVISION` — revision name.
- `K_CONFIGURATION` — configuration name.

Upstream reference:
https://cloud.google.com/run/docs/container-contract#env-vars

Phase C.2 step 8 triggered this exact error:

```
ERROR: (gcloud.run.deploy) spec.template.spec.containers[0].env:
  The following reserved env names were provided: PORT.
  These values are automatically set by the system.
```

because `infra/cloudbuild/auth-gateway.cloudbuild.yaml`,
`infra/scripts/deploy-auth-gateway.ps1`, and
`infra/cloud-run/auth-gateway.service.yaml` all listed
`PORT=8081` alongside `--port=8081`. The control flag is the
right knob; the env var is injected automatically from it.

### Risk if unaddressed

Every new Cloud Run service we add (conductor, streamer,
notifications, cost-tracker, audit-logger, ai-router, export-
worker, command-worker) is at risk of copying the same pattern
from `auth-gateway.*` or `api.*` infra files and hitting the
same deploy failure on first push. Each one costs a retry
round-trip (~5 minutes) and a branch + PR if the first deploy
is autonomous.

### Fix (applied in this PR)

- Removed `PORT` from `--set-env-vars` in
  `infra/cloudbuild/auth-gateway.cloudbuild.yaml` (c1 of PR #15).
- Removed `PORT` from `$EnvVars` in
  `infra/scripts/deploy-auth-gateway.ps1` (c2).
- Removed the `PORT` env entry from
  `infra/cloud-run/auth-gateway.service.yaml` (c3).
- Added comment blocks in all three files explaining why `PORT`
  is absent and pointing at the Cloud Run container-contract
  reserved-env-vars page, so the rule is visible where the next
  engineer would be tempted to add it back.

`api.cloudbuild.yaml`, `api.service.yaml`, and `deploy-api.ps1`
do NOT contain the `PORT` env — they always did it right and
are the positive examples for new service scaffolding. This
entry documents why.

### Related

- Discovered in: Phase C.2 step 8 (2026-04-23).
- Resolved in: PR #15 `fix(auth-gateway): remove reserved PORT
  env var`.
- Applies to: every future Cloud Run service spec. `docs/DEPLOY.md`
  should gain a "Cloud Run reserved env vars" subsection when it
  is next touched (Week 1 closure PR is the natural place).

### History

- 2026-04-23: failure observed on `auth-gateway:phase3-bd5f113`
  deploy. Fix filed in the same branch. TD closed resolved on
  merge of PR #15.

---

## TD-012: `app.setErrorHandler` masks FastifyError statusCode as 500

Discovered: 2026-04-23 (during Phase C.2 5.5 iteration 1)
Type: observability
Priority: P3
Status: open

### Description

Both `apps/auth-gateway/src/app.ts` and `apps/api/src/app.ts`
define a Fastify `setErrorHandler` with three branches:

1. `ZodError` → HTTP 400.
2. `IntegrationError` → respects the integration's statusCode.
3. **Fallback** → `reply.status(500).send({message:"Internal server error"})`.

The fallback ignores `error.statusCode` even when it is present
and expresses a real HTTP semantic. Fastify's own
`FastifyError` (e.g. `FST_ERR_CTP_INVALID_JSON_BODY`,
statusCode 400) lands in the fallback and becomes a 500, which:

- Misleads clients into thinking the server is broken when the
  request was malformed.
- Produces monitoring noise (5xx error rate spikes on client-
  side mistakes).
- Violates **LAW #5 Verifiable Honesty** — the response code does
  not describe the actual failure.

Surfaced during Phase C.2 iteration 1 when PowerShell's `\"`
escape semantics produced a malformed JSON body. The user
saw HTTP 500 "Internal server error" and spent time chasing a
server bug before it turned out to be a 400 client error
promoted by this handler.

### Risk if unaddressed

Every malformed-body client error surfaces as a 5xx in logs
and client UIs, eroding the "5xx = our fault" mental model
that operators rely on during incidents.

### Proposed fix

Three-line change in each `setErrorHandler`, before the
fallback 500 branch:

```typescript
if (
  typeof error.statusCode === 'number' &&
  error.statusCode >= 400 &&
  error.statusCode < 500
) {
  reply.status(error.statusCode).send({
    code: error.code ?? 'client_error',
    message: error.message,
    requestId: request.id
  });
  return;
}
```

Apply symmetrically to `api` and `auth-gateway`. Estimated
fix: ~30 min including a unit test per service (inject an
error with statusCode 400, assert response shape).

### Related

- Discovered in: Phase C.2 iteration 1 (`docs/sessions/2026-04-23-phase-c2-auth-gateway-deploy.md`).
- Bundles with TD-009 which describes the same symptom pattern
  on the `/v1/ai/*` path (api returns 502 where 401 would be
  more accurate).

### History

- 2026-04-23: filed during Week 1 closure.

---

## TD-013: `auth-gateway` idToken whitespace sanitisation

Discovered: 2026-04-23 (during Phase C.2 5.5 iteration 2)
Type: security + ergonomics
Priority: P2
Status: resolved

### Description

Google ID tokens are strictly base64url `.` base64url `.`
base64url. No whitespace is ever legal inside a real token.
In practice, clients that copy tokens out of browser UIs
(OAuth Playground, sign-in consoles) routinely paste a string
with embedded line-wrap newlines, trailing whitespace, or
BOMs. Those contaminated bytes break base64 decoding inside
`google-auth-library`, which then emits a misleading error
message (see library bug at
`node_modules/google-auth-library/build/src/auth/oauth2client.js:715`
— off-by-one that shows `segments[0]` in the error when the
failure was on `segments[1]`).

Without a defensive sanitisation layer at the auth-gateway
boundary, every copy-paste contamination produces a 502 with
an unhelpful upstream message, and the real cause (client
encoding) stays hidden.

### Risk if unaddressed

- Every OAuth-Playground-style signin attempt with a
  text-box-wrapped token fails with a confusing error.
- Support load: every affected user thinks the service is
  broken.
- No attack-surface amplification (these bytes would fail
  cryptographic verification anyway); purely a UX + LAW #5
  (Verifiable Honesty) concern.

### Fix (shipped in PR #16)

New `sanitizedJwtSchema` exported from
`@operator-os/contracts/src/auth-gateway.ts`:

1. Accept non-empty string.
2. `.trim()` + strip ALL `\s+` whitespace from anywhere.
3. Refine: result remains non-empty after sanitisation.
4. Refine: exactly 3 dot-separated segments.
5. Refine: every character is in the base64url alphabet
   (`A-Z a-z 0-9 - _`) or the legal padding `=`.

Invalid shapes now return HTTP 400 with a specific Zod
message from `app.setErrorHandler` rather than falling
through to 502 with a confusing upstream message.

16 unit tests landed in
`packages/contracts/src/auth-gateway.test.ts` covering whitespace
strip (leading, trailing, embedded across all 3 segments),
wrong segment counts, empty / whitespace-only input, non-JWT
plain strings, non-base64url chars, JWT-shaped non-Google
tokens (shape-only validation), and base64-padded tokens.

### Related

- Discovered in: Phase C.2 iteration 2.
- Resolved in: PR #16 `fix(auth-gateway): sanitize idToken +
  structured logging for verifier diagnostics`.
- Applies to: signin endpoint on auth-gateway. Refresh + signout
  endpoints use different schemas and are not affected.

### History

- 2026-04-23: filed and resolved during the same PR (#16).

---

## TD-014: `api.cloudbuild.yaml` resets IAM allUsers on every deploy

Discovered: 2026-04-23 (during Phase C.2 step 11 api redeploy)
Resolved: 2026-04-24 (PR #19, commits `5ebf0c6` + `bd7d959`)
Type: ops-trap
Priority: P2
Status: resolved

### Description

`infra/cloudbuild/api.cloudbuild.yaml` includes
`--no-allow-unauthenticated` in its `gcloud run deploy` step.
Every successful build therefore resets the Cloud Run IAM
policy back to its default — which excludes the
`allUsers → roles/run.invoker` binding that
`operator-os-api` now relies on (see DECISIONS.md
*operator-os-api: allUsers Invoker + HS256 Verifier Over
Firebase*).

Observed on the Phase C.2 api redeploy: after the successful
build, `curl $API/health` returned HTML 401 from Google
Frontend instead of Fastify JSON 200. Re-applying the binding
manually restored the expected behaviour.

### Risk if unaddressed

Every future api deploy silently breaks public reachability
until an operator notices and re-runs
`gcloud run services add-iam-policy-binding ...`. The gap
window is minutes to hours; during it, mobile clients see
HTML 401 (a broken UX) rather than a structured JSON error.

### Proposed fix

Pick one:

A. **Swap the flag to `--allow-unauthenticated`.** Aligns the
   cloudbuild config with the runtime IAM policy. Simplest
   diff. Recommended.

B. **Add a post-deploy IAM binding step to the cloudbuild.**
   Keeps `--no-allow-unauthenticated` as a "safe default" and
   explicitly grants `allUsers → run.invoker` after deploy.
   Slightly more steps; slightly more resilient to accidental
   IAM drift between deploys.

Option A is the recommended fix: it's the smallest surface and
makes the cloudbuild match the runtime reality that the
DECISIONS.md ADR committed to. ~10 min including a one-line
flag swap in `infra/cloudbuild/api.cloudbuild.yaml` and the
matching `--allow-unauthenticated` in
`infra/scripts/deploy-api.ps1`.

### Related

- DECISIONS.md ADR *operator-os-api: allUsers Invoker + HS256
  Verifier Over Firebase*.
- `docs/sessions/2026-04-23-phase-c2-auth-gateway-deploy.md`
  Step 11 (api redeploy + IAM re-apply).
- Bundles with TD-015 (no auto-deploy trigger): a CI addition
  that auto-redeploys api would hit this trap silently on every
  green merge if not fixed first.

### History

- 2026-04-23: observed and filed during Week 1 closure.
- 2026-04-24 (PR #19, Week 2 Phase 1.1): resolved via Option A.
  `--no-allow-unauthenticated` replaced with `--allow-unauthenticated`
  in both `infra/cloudbuild/api.cloudbuild.yaml` and
  `infra/scripts/deploy-api.ps1`. Deploy flags now align with the
  IAM-open + Fastify-middleware-auth posture committed in the
  2026-04-23 ADR.
- 2026-04-24 (Week 2 Phase 1.2 smoke 5): **verified in
  production.** CI-driven deploy via CD workflow
  `.github/workflows/cd-deploy.yml` (run `24798687205`) landed
  revision `operator-os-api-00008-pcc` serving at 100% traffic,
  image `phase3-51ed361`. Post-deploy IAM policy still contained
  `allUsers → roles/run.invoker` — no manual re-apply needed,
  no drift. Anonymous `curl $API/health` returns HTTP 200 with
  `status:"ok"`. The trap is closed: every future deploy through
  this path preserves the binding atomically.

---

## TD-015: No auto-deploy trigger for `apps/api/**` merges

Discovered: 2026-04-23 (while diagnosing Phase C.2 step 11)
Resolved: 2026-04-24 (PR #20 initial, PR #22/#26 follow-up fixes,
  verified live via CD run `24798687205` on 2026-04-24)
Type: ops-trap + process
Priority: P2
Status: resolved

### Description

`operator-os-api` has **no CI-driven redeploy** on merges to
`phase3/live-deploy-and-vertex`. Cloud Build is invoked
manually by an operator (or Claude Code acting as operator)
via `gcloud builds submit`. Merges that change `apps/api/**`
ship their code into the default branch but the running Cloud
Run service keeps serving the previous image.

**Concrete example observed this week:** PR #11 landed the
`AccessTokenVerifier` in `apps/api/src/integrations/access-token-verifier.ts`
and wired it into `FirebaseAuthService` on `2026-04-22`, but
the `operator-os-api` service continued serving image
`phase3-b7ad606` (PR #6) for over a day until Phase C.2
stumbled on the mismatch during verification 5.6.

The same gap exists for `operator-auth-gateway` but was
masked this week because the only merges that touched
auth-gateway were explicitly followed by manual deploys as
part of Phase C.

### Risk if unaddressed

- Merged-but-undeployed code accumulates silently. The gap
  between "phase3 HEAD" and "production image" grows until
  it is caught by a symptom.
- Auditability: `git log` says a change is live on a date
  when production is actually running an older image. This
  violates **LAW #5 Verifiable Honesty** at the operational
  layer.
- Week 2 Desktop Agent work will add real agent traffic; a
  merged-but-undeployed api bug will be caught by real user
  impact rather than by CI.

### Proposed fix

One of:

A. **GitHub Actions workflow** that detects merges to
   `phase3/live-deploy-and-vertex` affecting
   `apps/api/**` or `apps/auth-gateway/**` and invokes
   `gcloud builds submit` with the merge SHA as `_IMAGE_TAG`.
   Requires a CI-scoped service account with
   `cloudbuild.builds.editor` (similar to `deploy-bot`'s
   posture). Most robust.

B. **PR label gate** — add a required label
   `api-deploy-required` or `auth-gateway-deploy-required`
   that the merger must remove only after running the
   deploy. Lighter weight; still human-triggered.

C. **Daily reconciliation job** that diffs deployed image SHA
   vs phase3 HEAD and alerts if behind. Catches the gap
   after-the-fact but doesn't prevent it.

A is the cleanest and matches the "continuous deploy"
mental model the Phase C roadmap already assumed. TD-014
must be fixed first — otherwise the automated deploy would
break IAM on every run.

### Related

- `docs/sessions/2026-04-23-phase-c2-auth-gateway-deploy.md`
  Step 11 (deploy-gap diagnosis).
- Blocks on TD-014 (IAM reset on deploy).
- References `infra/cloudbuild/api.cloudbuild.yaml`,
  `infra/cloudbuild/auth-gateway.cloudbuild.yaml`,
  `.github/workflows/*`.

### History

- 2026-04-23: filed during Week 1 closure after identifying
  PR #11 had been undeployed for over 24 hours.
- 2026-04-24 (PR #20 + #22 + #26, Week 2 Phase 1.2): resolved.
  Landed `.github/workflows/cd-deploy.yml` with WIF auth,
  canonical Cloud Build flags, and `_DEPLOY=true` substitution.
  Full production verification via CD run `24798687205`: both
  `operator-os-api-00008-pcc` and `operator-auth-gateway-00004-775`
  deployed from the merge SHA `phase3-51ed361` with no human
  hand on `gcloud builds submit`. The "merged but undeployed"
  class of bug is closed. Follow-up: TD-021 tracks the gcloud
  build-log streaming hang that kept the GitHub Actions UI
  `in_progress` even after Cloud Build returned SUCCESS; it
  does not affect whether deploys actually happen, only the
  workflow-green signal.

---

## TD-020: Remove `AgentHeartbeatRequestSchemaV0` deprecation alias

Discovered: 2026-04-24 (filed with Week 2 kickoff ADRs)
Closed: 2026-04-24 (same day, after pre-Phase-1.3 research)
Type: maintainability
Priority: P3
Status: wontfix — not applicable

### Description

Week 2 TZ Part 4.4 replaces the existing agent heartbeat schema
in `@operator-os/contracts` with an agent-centric shape
(`agentId`, `providerId`, `providerVersion`, `platform`,
`hostname`, `state`, `uptimeSeconds`, `activeTaskCount`,
`systemLoad`, `healthChecks`, `timestamp`). Per the 2026-04-24
ADR *Heartbeat Schema Replacement With V0 Backward-Compat
Alias* the old shape is preserved as
`AgentHeartbeatRequestSchemaV0` with a `@deprecated` JSDoc tag
so existing callers have a migration window.

This entry tracks the eventual removal of the V0 alias so the
deprecation does not orphan.

### Risk if unaddressed

The deprecation alias accumulates callers over time. Without a
forcing function for removal, the codebase ends up maintaining
two schemas indefinitely — the exact outcome the alternative
"V0 permanent" option was rejected to avoid.

### Proposed fix

Remove the `AgentHeartbeatRequestSchemaV0` export after **either**:

- Two minor version bumps of `@operator-os/contracts`
  (e.g. `0.3.0` → `0.5.0` if the schema landed in `0.3.0`), **or**
- The next major version bump (`0.x.x` → `1.0.0`)

whichever comes first. At removal time:

1. Grep the repo for `AgentHeartbeatRequestSchemaV0` usage.
2. Migrate any remaining callers to `AgentHeartbeatRequestSchema`.
3. Delete the V0 export from `packages/contracts`.
4. Close this TD.

### Related

- DECISIONS.md ADR *Heartbeat Schema Replacement With V0
  Backward-Compat Alias* (2026-04-24).
- Week 2 TZ Phase 1.4 Part 4.4 (target shape).
- The PR that lands the schema replacement will carry a
  cross-reference to this TD so the deprecation window start
  date is unambiguous.

### History

- 2026-04-24 (morning): filed during Week 2 kickoff alongside
  the replacement-with-alias ADR so the deprecation is tracked,
  not orphaned.
- 2026-04-24 (same day, after pre-Phase-1.3 research): closed
  as `wontfix — not applicable`. Research revealed that the
  repo does not carry an existing `AgentHeartbeatRequestSchema`
  to alias from; the api uses `deviceStateSchema` directly as
  its heartbeat body and that schema is shared across the
  operator-state model and messaging contracts (so replacing
  it would force unrelated consumers to carry agent-process
  fields). The revised direction — *Agent Heartbeat Schema Is
  Additive, Not Replacement* (DECISIONS.md, same day) — adds
  `AgentHeartbeatRequestSchema` as a new sibling and leaves
  `deviceStateSchema` untouched. With no alias to remove,
  this TD has no fix to track. See the superseding ADR for
  the new direction and PR #21 for the additive schema
  landing.

---

## TD-016: Migrate GitHub Actions GCP auth to Workload Identity Federation

Discovered: 2026-04-23 (filed during Week 1 closure)
Closed: 2026-04-24 (preempted — migration executed before any
  JSON key was ever created)
Type: security-posture
Priority: P3
Status: resolved — preempted

### Description

Week 1 closure planned Phase 1.2 (CI auto-deploy for api +
auth-gateway) to use a long-lived JSON service-account key for
`deploy-bot@operator-os-dev` stored in a GitHub Secret, with a
"future TD-016: migrate to Workload Identity Federation" item
to close later. Classic "land the easy path first, migrate to
the secure path after" pattern.

### Why it never shipped

Before Phase 1.2 opened, Akmal attempted
`gcloud iam service-accounts keys create` against
`deploy-bot@operator-os-dev` and received
`FAILED_PRECONDITION: Key creation is not allowed on this
service account. Violation: constraints/iam.disableServiceAccountKeyCreation`
— an org-level policy blocking all long-lived JSON key
creation.

Two paths forward: (a) waive the org policy to allow JSON keys,
(b) adopt WIF directly. Path (b) executes the TD-016 migration
**before** the JSON-key path ever landed, so there's nothing
to migrate from.

### Resolution (pre-emptive)

Akmal set up on the Google side (via `gcloud` on their worker):

- Enabled `iamcredentials.googleapis.com` + `sts.googleapis.com`.
- Created global Workload Identity Pool `github-actions-pool`.
- Created OIDC provider `github-actions-provider` with issuer
  `https://token.actions.githubusercontent.com`, attribute
  mapping (sub, actor, repository, repository_owner), attribute
  condition `assertion.repository_owner == 'BusyaPrime'`.
- Bound `deploy-bot@operator-os-dev` with
  `roles/iam.workloadIdentityUser` for principalSet
  `attribute.repository/BusyaPrime/Operator-OS-Dev`.
- Created GitHub repo secrets `GCP_PROJECT_ID`,
  `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`. None
  carry credentials; only the provider resource path and the
  SA email.

`.github/workflows/cd-deploy.yml` (landed via PR #20 /
commit `4645b5a`) uses `google-github-actions/auth@v2` with
these inputs and requires `permissions: id-token: write` so
each workflow run mints a short-lived federated token.

### Consequences captured

- No JSON service-account key exists in the project. The
  ops risk tracked by TD-016 is gone rather than shifted.
- If a second repo ever needs to deploy to the same GCP
  project, the ops move is "add its repo to the pool's
  principalSet", not "provision another JSON key".
- Audit trail via Cloud Audit Logs includes the full GitHub
  OIDC assertion (workflow name, run id, repository, actor,
  ref) for every token exchange — strictly better than the
  opaque "whoever had the JSON key" view.

### Related

- DECISIONS.md ADR *Adopt Workload Identity Federation From
  Day 1 (TD-016 Preempted)* (2026-04-24).
- PR #20 (this TD's sibling work — lands the workflow).
- TD-015 (auto-deploy) — resolved alongside TD-016 in the
  same PR.

### History

- 2026-04-23: filed during Week 1 closure as a future
  migration item after adopting the simpler JSON-key path for
  Phase 1.2.
- 2026-04-24: closed as resolved-preempted after
  `constraints/iam.disableServiceAccountKeyCreation` blocked
  key creation. WIF adopted directly; the migration never had
  to happen.
- 2026-04-24 (same day, CD run `24798687205`): verified in
  production. WIF-backed auth chain executed end-to-end with
  no JSON keys: GitHub OIDC → STS federated token → impersonate
  `deploy-bot` → `gcloud builds submit --service-account=deploy-bot`
  → Cloud Build self-actAs via deploy-bot `iam.serviceAccountUser`
  self-binding → image built + pushed + Cloud Run deployed.
  The audit path captured the GitHub Actions assertion
  (workflow, run id, actor, ref) on every token exchange in
  Cloud Audit Logs, as the ADR predicted.

---

## TD-021: `gcloud builds submit` log-streaming hangs in GitHub Actions runner

Discovered: 2026-04-24 (during Week 2 Phase 1.2 CD smoke runs 4 + 5)
Type: ops-ergonomics
Priority: P3
Status: open

### Description

`gcloud builds submit` streams Cloud Build logs to stdout by
default. In the GitHub Actions `ubuntu-latest` runner under
`.github/workflows/cd-deploy.yml`, the streaming tail does not
terminate cleanly after Cloud Build reports SUCCESS. Observed
twice in a row on Phase 1.2 smoke tests:

- Run `24796992344` (smoke 4): Cloud Build SUCCESS at
  `c5f8aca9-73f3-4852-8fd6-0002d81463de` and
  `63dedee2-2430-45f8-89b2-518a0cf2f466` (build + push only, no
  deploy — separate bug resolved in PR #26). `gcloud builds
  submit` in the runner stayed `in_progress` for 40+ minutes
  after Cloud Build's own completion. Cancelled manually with
  `gh run cancel`.
- Run `24798687205` (smoke 5): Cloud Build SUCCESS, Cloud Run
  revisions `operator-os-api-00008-pcc` and
  `operator-auth-gateway-00004-775` created and serving, but
  the `deploy-api` and `deploy-auth-gateway` GitHub Actions
  jobs stayed `in_progress` past the point of deploy success.
  `verify-health` never got to run because its `needs:`
  dependency jobs never reported a `conclusion`. Cancelled
  manually.

### Risk if unaddressed

- `verify-health` job never runs, so we lose the post-deploy
  health check signal in CI. Manual verification via
  `curl $SERVICE/health` works but is not automated.
- Every CD run shows up as `cancelled` or `in_progress` in the
  Actions history rather than as a clean green. Fine for one
  incident; painful for long-running ops hygiene.
- Intermittent — not every `gcloud builds submit` from GitHub
  runners hangs, but a material fraction does. Predicting which
  runs will hang is not possible without more data.

### Probable root cause

Known class of issue with `gcloud builds submit --async=false`
(the default) against Cloud Build when build logs contain
non-trivial output and the streaming TCP connection goes
idle between chunks. The gcloud client-side log reader does
not reliably detect end-of-build on the streaming path; it
waits for an EOF that sometimes doesn't arrive promptly.

### Proposed fix (two alternatives)

- **(A) Add `--async` flag to `gcloud builds submit`.** Submit
  the build and return immediately with the build id. Add a
  follow-up step `gcloud builds describe <id> --wait` or a
  polling loop that reads build status directly. Cleaner
  separation of "submit" from "wait for completion".
- **(B) Wrap the submit step with a shell timeout.** e.g.
  `timeout 900 gcloud builds submit ...`; if Cloud Build has
  already succeeded, the image is built regardless, and the
  timeout kill is cosmetic. Follow-up step checks Cloud Build
  status explicitly.

(A) is more robust; (B) is simpler. Either unblocks
`verify-health` and produces a clean workflow signal.

### Related

- Week 2 Phase 1.2 CD runs `24796992344` + `24798687205`.
- `.github/workflows/cd-deploy.yml` — the file to change.
- Does not block Phase 1.3+ because deploys do succeed; this is
  a CI-ergonomics issue, not a deploy-correctness issue.

### History

- 2026-04-24: filed after observing the second occurrence on
  smoke test 5. Functional deploys are working; this TD is
  about the GitHub Actions workflow signal quality only.

## TD-022: api `/v1/cost/*` endpoints not implemented

Discovered: 2026-04-24 (Week 2 Phase 1.4 commit c6)
Type: missing-feature
Priority: P2
Status: open

### Description

`apps/desktop-agent/src/providers/api-cost-provider.ts` (the
`CostProvider` implementation shipped with every `AIAgent`)
expects the api to expose cost-related endpoints:

- `GET /v1/cost/estimate` — pre-task cost estimate.
- `POST /v1/cost/usage` — record actual token + cost usage.
- `GET /v1/cost/budget/:userId` — per-user budget status.
- `POST /v1/cost/enforce` — throw BudgetExceededError if over.
- `GET /v1/cost/spending/:userId` — aggregated reports.

None of these exist on the api today. `ApiCostProvider` ships
a stub set per Decision 1 (2026-04-24): estimate returns zero
with `confidence='low'`; recordUsage logs only; checkBudget
returns `MAX_SAFE_INTEGER` limit; enforceBudget no-ops;
getUserSpending throws `AIAgentError('COST_ENDPOINT_UNAVAILABLE')`
because a zeroed spending report would misrepresent to a UI.

### Risk if unaddressed

- Budget enforcement is a no-op. Any agent run that would have
  been rejected on cost grounds executes instead. For local
  dev + the internal operator that's acceptable; for any
  external user, it is not.
- Cost telemetry is lost. Every task's token counts live only
  in the desktop agent's pino log and cannot be aggregated
  into billing or usage dashboards.
- When mobile ships a spending view, it will fail with
  `COST_ENDPOINT_UNAVAILABLE` until these endpoints land.
  That's the designed fail-loudly posture (intentionally not
  a stub), but it means the feature is blocked on the api.

### Proposed fix

1. Add the endpoints to `apps/api/src/routes/ai/cost.ts`
   (new file), backed by a Firestore `costUsage` collection
   + a `userBudgets` doc per user.
2. Replace stub branches in `ApiCostProvider` with real
   `fetch`-based calls. Outbound Zod-parse per project
   pattern; response Zod-parse too.
3. Wire a small pricing table keyed by `providerId` + `model`.
   Anthropic + OpenAI public pricing for seed data.
4. Delete the `AIAgentError('COST_ENDPOINT_UNAVAILABLE')`
   throw in `getUserSpending`; its existence was a deliberate
   failing door to this TD.

### Related

- `apps/desktop-agent/src/providers/api-cost-provider.ts` —
  the stub (search "TD-022" for every branch that will change).
- `packages/contracts/src/ai/cost-provider.ts` — the
  interface the real endpoints must honour.
- Phase 1.4 Decision 1 (2026-04-24) — records why stubs
  were chosen over "fail loud everywhere".

### History

- 2026-04-24: filed when the stub provider landed in c6 of
  Phase 1.4. Scope of the fix is not trivial (schema,
  Firestore model, pricing table) — scheduled for a later
  phase that focuses on billing observability.

## TD-023: Evaluate node-pty for raw-terminal agent streaming

Discovered: 2026-04-24 (Week 2 Phase 1.4 design)
Type: research
Priority: P3
Status: open

### Description

`ClaudeCodeAgent` (phase 1.4) drives the `claude` CLI via
`execa` with `--output-format json`. That gives a single
final JSON document per task; streaming tokens to the UI
depends on `--output-format stream-json`, which emits JSONL
but still through stdout pipes.

For two classes of agent we don't yet support, `execa`
isn't sufficient:

- **Truly interactive CLIs** (e.g. any CLI that wants a TTY
  to render colour / progress bars correctly; anything
  expecting terminal resize events).
- **Agents that need pseudoterminal fidelity** — if in the
  future an agent spawns a REPL-style flow that depends on
  terminal-attached behaviour.

`node-pty` is the standard answer for both. It is also a
native build (node-gyp), which means non-trivial packaging
decisions for the desktop agent's eventual signed installers.

### Risk if unaddressed

- Claude Code specifically works with execa + stream-json,
  so there is no immediate blocker. Deferring is fine.
- Future agent adapters (Cursor CLI, Gemini CLI) may surface
  pty-only behaviours when tested end-to-end. Without a
  decision on node-pty, each integration would re-debate the
  same question.

### Proposed fix

1. Spike: wire up `node-pty` in a branch, run Claude Code
   stream-json through it, compare CPU + latency to the
   execa path.
2. Decide whether to ship `node-pty` by default, make it
   opt-in per-agent via a manifest hint, or skip entirely
   until a real blocker surfaces.
3. If shipping, document the signed-installer implications
   in `docs/DEPLOY.md` (native binding → per-platform
   prebuilt binaries).

### Related

- `apps/desktop-agent/src/agents/claude-code-agent/claude-code-agent.ts`
  — currently uses execa.
- `packages/contracts/src/ai/stream-provider.ts` — the
  interface pty output would still flow through.

### History

- 2026-04-24: filed during Phase 1.4 research, deferred
  because execa path is sufficient for the first
  first-party agent.

## TD-024: api `/v1/agent/heartbeat/agent` endpoint missing

Discovered: 2026-04-24 (Week 2 Phase 1.4 commit c12)
Type: missing-feature
Priority: P2
Status: open

### Description

The Desktop Agent's new `AgentHeartbeatLoop` (Phase 1.4)
posts additive per-agent heartbeats to
`POST /v1/agent/heartbeat/agent`. The endpoint does not
exist on `apps/api`. Today, the loop will hit the api, get
back a 404, count that as a failure, and exponentially back
off. The agent continues to operate — the existing
device-state heartbeat (`POST /v1/agent/heartbeat`) is
unaffected (see the *Agent Heartbeat Schema Is Additive,
Not Replacement* ADR, 2026-04-24).

The additive approach means this TD is purely about
enabling agent-centric observability (active task count,
per-check health, provider version telemetry) — not about
rescuing a broken production path.

### Risk if unaddressed

- Agent-centric observability stays dark. Admins cannot
  see, from the api side, whether an agent is idle / busy
  / degraded / offline — only device-level liveness.
- `registry.notifyStateChanged('degraded')` events fire on
  the desktop agent based on *remote* heartbeat failures,
  and right now every heartbeat fails, so every agent will
  eventually be marked degraded by the loop's own counters.
  The UI we haven't built yet would show that noisy signal.
  Until the UI lands, the degraded state is inert.
- Backoff ensures at most ~1 rps per agent across the fleet,
  so api load is a non-issue. The api log does accumulate
  steady 404s per agent until this TD closes.

### Proposed fix

1. Add `apps/api/src/routes/ai/heartbeat.ts` with a POST
   handler for `/v1/agent/heartbeat/agent`.
2. Body validation: `agentHeartbeatRequestSchema` (already
   lives in `packages/contracts/src/agent/heartbeat.ts`).
3. Storage: Firestore `agentHeartbeats` collection keyed by
   `agentId`, TTL 7 days for raw samples. A rollup doc per
   `agentId` holds the most-recent sample for quick reads.
4. Response: `agentHeartbeatResponseSchema` —
   `pendingTaskIds` empty for now (router integration is
   later work), `commands` empty.
5. Auth: once the desktop agent's bearer-token flow is
   wired, require an auth-gateway HS256 JWT in the header.
6. When shipped, delete the `TD-024` comments in
   `apps/desktop-agent/src/heartbeat/agent-heartbeat-loop.ts`
   and `apps/desktop-agent/src/runtime.ts`.

### Related

- `apps/desktop-agent/src/heartbeat/agent-heartbeat-loop.ts`
  — the producer.
- `packages/contracts/src/agent/heartbeat.ts` — the Zod
  schemas both sides must honour.
- ADR *Agent Heartbeat Schema Is Additive, Not Replacement*
  (2026-04-24) — the decision that keeps this TD additive
  rather than disruptive.
- Legacy device-state heartbeat (`POST /v1/agent/heartbeat`)
  continues to serve mobile / UI today; it is NOT what this
  TD replaces.

### History

- 2026-04-24: filed when the desktop-agent-side loop landed
  in Phase 1.4 commit c12. api-side implementation is
  scheduled for the phase that opens agent observability
  to the mobile UI.
