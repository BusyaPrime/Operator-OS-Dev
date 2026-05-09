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
Status: resolved (Week 2 Phase 2, 2026-04-24 — PR #32)

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
- 2026-04-24 (Phase 2): RESOLVED via PR #32. Endpoints landed:
  `POST /v1/cost/estimate`, `POST /v1/cost/record`,
  `GET /v1/cost/status/:userId`,
  `GET /v1/cost/spending/:userId?period=`. Pricing table lives
  in `apps/api/src/services/cost.ts` per the *Cost Records
  Persist In Firestore, Pricing Table Lives In Code* ADR.
  `ApiCostProvider` stubs in desktop-agent still render zero
  until a follow-up commit swaps them for real calls;
  functional replacement tracked inline (not a new TD — the
  stubs are honest placeholders that log what they would do).
  Enterprise admin surface for editing user_budgets docs is
  the new TD-025.

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
Status: resolved (Week 2 Phase 2, 2026-04-24 — PR #32)

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
- 2026-04-24 (Phase 2): RESOLVED via PR #32. Endpoint
  `POST /v1/agent/heartbeat/agent` is live; request body
  validated against `agentHeartbeatRequestSchema`; 5s-per-
  agent in-memory rate limiter returns 429 on spam;
  Firestore accessor persists to `agentHeartbeats` with
  doc id `{agentId}__{receivedAtMs}`. Manual step
  remaining: Firestore Console TTL policy on
  `agentHeartbeats.receivedAt` (7 days) — noted in the PR
  body and in a code comment next to the accessor.
  Existing `POST /v1/agent/heartbeat` (deviceStateSchema)
  left untouched; see *Agent Heartbeat v2 Ships As A New
  Endpoint, Not A Modified One* ADR.

## TD-017: api `/v1/agent/ws` WebSocket endpoint missing

Discovered: 2026-04-22 (Phase 1.4 `WebSocketStreamProvider` landed
    against a 404 endpoint)
Type: missing-feature
Priority: P2
Status: resolved (Week 2 Phase 2, 2026-04-24 — PR #32)

### Description

The Desktop Agent's `WebSocketStreamProvider` (Phase 1.4)
connects to `wss://.../v1/agent/ws` and POSTs a `hello` frame
with the agent's manifest. The endpoint did not exist on the
api until Phase 2. Without it, the provider's per-task WebSocket
connect failed with `ECONNREFUSED` (local) or 404 (prod); the
local fan-out to in-process listeners still worked, so
`ClaudeCodeAgent` tests and local-only invocations were
unaffected. The gap was strictly about enabling real end-to-end
streaming from agent through api to mobile.

### Resolution

PR #32 added `WSS /v1/agent/ws` via `@fastify/websocket` with:
- `preValidation` on the upgrade running the same agent-guard
  the HTTP `/v1/agent/*` routes already use (HS256 JWT).
- hello → welcome handshake with `sessionId` + `serverFeatures`.
- Ping loop at `pingIntervalMs` (default 30s); inactive
  sessions closed with 4008 after `pongTimeoutMs` (default 60s).
- `AgentSessionRegistry` (in-memory, one Fastify instance) with
  close-prior-on-duplicate-agentId (code 4004).
- Close codes covered: 1000 normal, 1011 internal, 4001
  unauthorized, 4002 hello-invalid, 4003 hello-timeout, 4004
  duplicate-agent, 4008 ping-timeout.
- Graceful `onClose` hook closes every live session with 1001
  "going-away" so rolling deploys don't leak zombies.

See ADR *Agent WebSocket Sessions Are In-Memory (MVP); Redis
Coordination Is A Future TD* (2026-04-24) for the multi-instance
migration plan.

### Related

- `apps/api/src/routes/agent-ws.ts` — route + handshake + ping
  loop + post-welcome frame handlers.
- `apps/api/src/services/agent-session-registry.ts` — in-memory
  registry.
- `apps/desktop-agent/src/providers/websocket-stream-provider.ts`
  — the producer that was waiting on this endpoint.
- Sibling Phase 2 TD closures: TD-022 (cost), TD-024 (heartbeat v2).

### History

- 2026-04-22: implicitly filed when `WebSocketStreamProvider`
  landed in Phase 1.4 without a matching api endpoint. Tracked
  informally in code comments + closure docs; never had a
  dedicated `TECH_DEBT.md` entry until it closed.
- 2026-04-24 (Phase 2): RESOLVED via PR #32. Retroactively
  formalised here for the closure record.

## TD-025: Enterprise admin surface for editing `user_budgets`

Discovered: 2026-04-24 (Week 2 Phase 2 cost endpoints)
Type: missing-feature
Priority: P3
Status: open

### Description

Phase 2 (TD-022) ships per-user cost records + a `user_budgets`
Firestore collection that holds plan-override docs. The api
surface to *read* a user's own budget already exists
(`GET /v1/cost/status/:userId`). There is no surface to **set**
a `userBudgets/{userId}` document except by manually editing
Firestore in the Console.

That is fine for local dev and the single-operator case — the
internal `free` plan default of $1/month is enforced, and the
ADR *Cost Records Persist In Firestore, Pricing Table Lives In
Code* already records that plan-level budgets are source-of-
truth in code. For enterprise customers who need a custom
`monthlyLimitUsd`, an admin needs a way to upsert the override.

### Risk if unaddressed

- Today the free / pro / enterprise defaults cover every case;
  `custom` plan users do not yet exist. So no functional harm
  right now.
- First enterprise onboarding will require either a manual
  Firestore edit (error-prone) or this TD to close.
- `user_budgets` docs are Zod-validated on read, so a malformed
  manual edit is caught and logged, but the user would silently
  fall back to plan defaults instead of their custom ceiling —
  degrades gracefully rather than over-charging.

### Proposed fix

1. Add a `POST /v1/admin/budgets/:userId` endpoint behind an
   admin-role guard (requires
   `verifiedUserContextSchema.roles` to include `admin`).
2. Body validated against the existing `UserBudgetRecord`
   shape; Firestore repo already has `setUserBudget()`.
3. Mobile settings tab gains a "billing" view (future) that
   renders `GET /v1/cost/status/:userId` — but the *edit*
   surface remains admin-only.
4. Enterprise sign-up flow (further future) can call this
   endpoint automatically.

### Related

- `apps/api/src/integrations/firestore.ts` — `setUserBudget`
  method is already implemented; just unused by any route.
- `apps/api/src/services/cost.ts` — `PLAN_BUDGETS` records
  what `custom` plan means (monthlyLimitUsd = 0, i.e. "read
  from Firestore").
- ADR *Cost Records Persist In Firestore, Pricing Table Lives
  In Code* (2026-04-24).

### History

- 2026-04-24: filed when the Phase 2 cost endpoints landed.
  Deferred because no `custom` plan users exist yet; admin
  surface is dead weight until the first enterprise onboarding.

## TD-026: Add `expireAt` field to `agentHeartbeats` for proper TTL support

Discovered: 2026-04-23 (Phase 2 post-merge Firestore manual
    setup by Akmal)
Type: schema-design / missing-feature
Priority: P2
Status: open
Target: Week 4 batch

### Description

Phase 2 (TD-024) landed
`FirestoreOperatorRepository.recordAgentHeartbeat`, which
persists each heartbeat with a server-assigned `receivedAt`
timestamp and expects manual TTL configuration on that field
in the Firestore Console.

Applying a TTL on `receivedAt` is **wrong**: Firestore's TTL
service deletes documents when the named field's value equals
or has passed "now". Because `receivedAt` is the *creation*
timestamp, documents would be eligible for deletion from the
moment they are written — the opposite of a 7-day retention.

Correct design: write an **`expireAt`** field alongside
`receivedAt`, computed at write time as `receivedAt + 7 days`.
Firestore's TTL then fires on `expireAt` and preserves
documents for the intended window.

### Risk if unaddressed

- Without TTL, heartbeats accumulate indefinitely. Rate:
  ~4 KB per heartbeat × one agent × 30s cadence ≈
  1.2 MB / week / agent. Firestore's free tier includes 1 GB
  of storage, so a single agent runs for ~800 weeks before
  the free tier bites. Acceptable for MVP / local dev.
- At production scale (multi-agent, multi-user), storage
  grows roughly linearly; cost is minor but the collection
  becomes slower to range-query over time.
- **No correctness impact today.** Every current reader of
  `agentHeartbeats` queries on `(agentId, receivedAt DESC)`
  which returns the latest rows first regardless of how many
  stale rows exist behind them.

### Proposed fix

1. In `apps/api/src/integrations/firestore.ts`,
   `recordAgentHeartbeat`, compute:
   ```ts
   const expireAtMs = receivedAtMs + 7 * 24 * 60 * 60 * 1000;
   const expireAt = new Date(expireAtMs).toISOString();
   ```
   Persist alongside `receivedAt`.
2. After deploy, Akmal applies Firestore TTL policy on
   `agentHeartbeats.expireAt` (7-day behaviour then follows
   from the field value, not from the policy offset).
3. No code reader today needs the new field; it is write-only
   for the TTL service. Adding it does not break existing
   queries.

### Related

- `apps/api/src/integrations/firestore.ts` — the accessor that
  needs the write addition.
- ADR *Agent Heartbeat v2 Ships As A New Endpoint, Not A
  Modified One* (2026-04-24) — the decision this TD follows up.
- Firestore TTL docs note this precise pitfall:
  https://cloud.google.com/firestore/docs/ttl

### History

- 2026-04-23: filed when Akmal attempted to apply the 7-day
  TTL on `receivedAt` and realised the field semantics were
  wrong for TTL purposes. Scheduled for Week 4 batch alongside
  the `POST /v1/tasks` + task queue work so one deploy covers
  the schema change + downstream task-result persistence.
  Until then, heartbeats accumulate without harm (1.2 MB /
  week / agent; free tier 1 GB).

## TD-027: Redis-backed idempotency cache for multi-instance api

Discovered: 2026-04-24 (Week 3 Phase 3.1, Gate 3.1.A ADR
    "Idempotency — In-Memory LRU With Firestore Fallback")
Type: scalability
Priority: P3
Status: open
Trigger: when `operator-os-api` scales beyond a single Cloud
    Run instance (likely at >100 concurrent users).

### Description

`apps/api/src/services/idempotency-cache.ts` (Phase 3.1 c4)
is authoritative within a single Fastify instance. Two api
replicas don't share cache state, so a concurrent identical
submit routed to different replicas can briefly pass both
cache layers and produce two taskIds (last write wins at
Firestore).

Single-instance deploy today. When horizontal scaling lands,
the cache needs to move to a shared store (Memorystore /
Redis) so `(userId, idempotencyKey)` dedup is globally
authoritative.

### Risk if unaddressed

- Duplicate `taskId`s under concurrent-retry + multi-instance.
  User-visible symptom: the mobile client's "same idempotency
  key" retry sometimes returns a new taskId instead of the
  original. Rare — needs a truly concurrent submit from the
  same client across two replicas in the same second — but
  grows with fleet size.
- Zero risk at current deploy (single instance).

### Proposed fix

1. Add `ioredis` as a direct dependency of `apps/api`.
2. Reimplement `IdempotencyCache` as a Redis-backed variant
   keeping the same interface (`lookup` / `remember` / `size`).
   Dependency inversion — route handlers don't change.
3. Provision Memorystore (Redis) in the `operator-os-dev`
   project via a separate infrastructure PR. VPC Connector
   required for Cloud Run → Memorystore access.
4. Env additions: `REDIS_HOST`, `REDIS_PORT`. Wire through
   `packages/config/src/api.ts`.
5. Transaction pattern: `SET NX EX ttl` for first-write;
   subsequent reads via `GET` with TTL awareness. Cache
   holds `{taskId, status, createdAt}` JSON.
6. Deprecate the in-memory cache OR keep it as an L1 in
   front of Redis for latency — decide at implementation
   time based on measured Redis RTT.

### Related

- `apps/api/src/services/idempotency-cache.ts` — current
  implementation.
- ADR "Idempotency — In-Memory LRU With Firestore Fallback"
  (2026-04-24) — records why the current single-instance
  posture is acceptable MVP and what the migration will
  need.
- TD-011 (Cloud Run reserved env var pattern) — Memorystore
  env vars should follow the same discipline.

### History

- 2026-04-24: filed when Phase 3.1 c4 landed the in-memory
  LRU cache. Deferred until horizontal scaling is the
  operating constraint; today we're single-instance by
  design.

## TD-028: User-initiated task deletion (GDPR right to erasure)

Discovered: 2026-04-24 (Week 3 Phase 3.1, Gate 3.1.A Red
    Flag #1 privacy posture)
Type: missing-feature · privacy
Priority: P2
Status: open
Target: Week 4 or sooner if first GDPR request arrives.

### Description

Phase 3.1 lands 30-day automatic task retention via Firestore
TTL on `tasks.expireAt`. That bounds the privacy blast radius
nicely, but GDPR Article 17 (right to erasure) requires a
user-initiated deletion path that operates on demand — not
just time-bound auto-cleanup. A user asking "delete my task
with prompt X right now" has no endpoint today.

The 30-day retention policy is a good default; TD-028
addresses the 0-to-30-day window where the user wants their
data gone immediately.

### Risk if unaddressed

- GDPR non-compliance if we onboard EU users. Article 17 is
  not a 30-day-SLA right; it is an on-demand right.
- User trust — "I want my prompt gone now" is an
  operator-shell table-stakes feature.
- No current customer has requested it; risk is latent until
  that happens, at which point it needs to ship fast.

### Proposed fix

1. Add `DELETE /v1/tasks/:taskId` endpoint.
   - Auth: user guard (same as GET single).
   - Ownership check via the existing
     `getTask(taskId, userId)` accessor (returns undefined
     for not-yours → 404 enumeration-proof, matches the
     PATCH of spec §3.1.2).
2. Hard-delete the Firestore document. Rationale: user
   explicitly asked for erasure; keeping a "deleted" row
   contradicts the request. If we need ops analytics
   (task-count-by-user trends), append an `audit_deletions`
   row with only `{userId, deletedAt}` — no prompt, no
   output, no taskId.
3. Cascade:
   - Any `task_dispatch_attempts` rows for that taskId
     (Phase 3.2 will create this collection).
   - Any `cost_records` rows for that taskId — or keep
     (billing records are separate-interest; decide at
     implementation time).
4. Response: 204 No Content on success, 404 on not-found /
   not-yours.
5. Rate limit: same GET bucket (60/min).
6. Mobile UI: add swipe-to-delete on TaskStream history tab
   (Phase 3.3+ work).

Decision deferred to implementation time:
- Cost records: preserve (analytics / refunds) vs cascade?
  Leaning preserve.
- Dispatch attempts: cascade (no user value in retaining).
- Agent-side task queue (Phase 3.2): should an in-flight
  task be cancelled on delete? Yes — route issues WS
  `task-cancel` to the assigned agent.

### Related

- ADR "Task Lifecycle + Retention Posture (Option B —
  30 Days)" (2026-04-24) — records the 30-day auto-policy
  that TD-028 complements.
- `apps/api/src/routes/tasks.ts` — existing GET-single
  path is the template for the DELETE handler.
- `apps/api/src/integrations/firestore.ts` — needs a
  `deleteTask(taskId, userId)` accessor (not-yours → no-op
  + false return, not an error, so the route can 404).

### History

- 2026-04-24: filed when Gate 3.1.A approved Option B
  retention. Deferred because no user-initiated deletion
  need exists today; escalates to P1 the moment an EU user
  (or any user who asks) reports the need.

## TD-029: Apply TTL policy to `tasks.expireAt` post-first-write

Discovered: 2026-04-24 (Phase 3.1 post-merge Firestore setup
    by Akmal)
Type: deployment · privacy
Priority: P2
Status: open
Trigger: after the first successful POST /v1/tasks creates
    the `tasks` collection in Firestore, apply TTL manually
    via Firestore Console.

### Description

Phase 3.1 Firestore setup landed three composite indexes on
`tasks` — all Enabled:

- `tasks (userId ASC, createdAt DESC)`
- `tasks (userId ASC, status ASC, createdAt DESC)`
- `tasks (idempotencyKey ASC, userId ASC, createdAt DESC)`

The TTL policy on `tasks.expireAt` was NOT applicable at setup
time. Firestore Console TTL UI autocomplete only offers
collections that already exist, and `tasks` had zero documents
until the first POST /v1/tasks succeeds in production. Dropdown
offered only the pre-existing collections (`users`,
`refreshTokens`, `agentHeartbeats`, `costRecords`).

The write-time logic in `apps/api/src/routes/tasks.ts` already
sets `expireAt = createdAt + 30d` on every inserted task — the
data contract is honored. What is missing is the server-side
TTL policy that causes Firestore to actually garbage-collect
expired documents.

Absolute-timestamp convention (not duration-offset) is
preserved: TD-026 lesson applies — a Firestore TTL fires when
the named field has passed "now", so the field must be the
absolute expiry timestamp, never `createdAt`.

### Risk if unaddressed

- Unbounded growth of the `tasks` collection once users are
  active. At MVP submission rate (~1 task / user / min) and
  a 100-user beta, ~145k docs/day accumulate with no
  garbage collection.
- Free-tier Firestore headroom masks the symptom for weeks,
  but the stated privacy posture of "30-day retention"
  becomes false after day 30 — ADR "Task Lifecycle +
  Retention Posture (Option B — 30 Days)" becomes out of
  sync with reality.
- Zero risk before the first user-submitted task lands —
  collection does not yet exist.

### Proposed fix

1. After the first production POST /v1/tasks creates the
   `tasks` collection, open Firestore Console → TTL.
2. Select collection `tasks`, field `expireAt`.
3. Apply policy. Wait for "Serving" state (can take up to
   24h per Firestore docs).
4. Confirm with a smoke test: insert a task with
   `expireAt = now - 1h`, wait the cleanup window, verify
   the document was deleted. Optional — the policy is
   self-evident from the absence of 30+-day-old rows over
   time.

### Alternative (future improvement, not blocking)

- Automate via Terraform (`google_firestore_field` resource
  with `ttl_config`) so the policy is infrastructure-as-code
  alongside the index declarations. Would apply idempotently
  even when the collection is empty, since TF operates at
  the field-schema level, not the collection-exists level.
- Or run `gcloud firestore fields ttls update` as a one-shot
  post-first-write hook (Cloud Scheduler trigger or manual
  CI step).

### Related

- TD-026: exact same pattern for `agentHeartbeats` (expireAt
  = receivedAt + 7d, TTL deferred until that collection
  schema change lands).
- ADR "Task Lifecycle + Retention Posture (Option B — 30
  Days)" (2026-04-24) — records the 30-day auto-policy that
  this TTL enforces.
- `apps/api/src/routes/tasks.ts` — authoritative writer of
  `expireAt` at POST time.

### History

- 2026-04-24: filed when Akmal set up Firestore indexes for
  Phase 3.1 post-PR-#33-merge. Console TTL UI could not find
  the `tasks` collection because no documents existed yet.
  Deferred to post-first-write manual application.

## TD-030: Recurrent transient unreachability on `/v1/agent/heartbeat/agent`

Discovered: 2026-04-23 ~22:15 UTC (Phase 3.1 post-deploy
    sanity validation; Cloud Run revision
    `operator-os-api-00011-nvj`); second incident
    2026-04-24 ~12:00 UTC on `operator-os-api-00012-zrk`
    (Phase 3.2 merge, ~8 min post-deploy)
Type: observability · cloud-run-edge
Priority: P2
Status: open (recurrent; no action until third incident or
    user-facing impact)
Trigger for action:
- 3+ consecutive `curl` exit 56 (connection reset by peer) on
  the same endpoint,
- other endpoints on the same revision unaffected at the
  same time,
- zero Cloud Run application logs during the failure window.

Until that pattern repeats, no action.

### Description

During Phase 3.1 post-deploy sanity validation on 2026-04-23
at approximately 22:15 UTC, `POST /v1/agent/heartbeat/agent`
returned `curl` exit 56 ("Failure when receiving data from
the peer") on three consecutive attempts. All other endpoints
on the same revision (`operator-os-api-00011-nvj`) responded
cleanly within the same minute:

- `GET  /health`                           → 200
- `GET  /ready`                            → 503 (honest)
- `POST /v1/tasks` (no auth)               → 401
- `GET  /v1/tasks/<uuid>/stream`           → 501

On 2026-04-24 at approximately 06:00 UTC (rested morning
re-test), the same endpoint returned 401 normally across a
9-probe diagnostic battery. The anomaly could not be
reproduced.

Cloud Run application logs for revision 00011-nvj show **zero
entries** for the failing endpoint during the failure window
— no WARNING, no ERROR, no connection-close record, no
severity>=DEFAULT entry at all. Today's follow-up probes
appear in the logs within ~1s of `curl` completion. The
implication is that last night's three requests never
reached the Cloud Run container. Failure was at the edge
path (GFE → L7 load balancer → TLS terminator → service),
not in application code or middleware.

Classification E — transient resolved itself — at ~85%
confidence. ~10% residual risk of a recurrent edge-level
quirk under similar timing / load conditions; ~5% combined
on other categories. Code-level hypotheses (route order
regression, middleware glob) are ruled out by the diff —
`apps/api/src/app.ts` diff `02898c1..e953378` is a pure
additive insert of `registerTaskRoutes` between
`registerAgentWsRoute` and `registerInternalTasksRoutes`,
with no changes to middleware, plugins, or existing
registration order.

### Risk if unaddressed

- Low today. Single unreproduced incident with no
  user-visible impact (heartbeat is agent-side polling;
  retry is built into the agent client).
- Moderate on recurrence. Widespread heartbeat
  unreachability would break alert pipelines that depend on
  heartbeat liveness and would silently degrade agent-health
  telemetry.
- Documentation risk: without this TD filed, a future
  occurrence looks like a fresh mystery; with it, the
  first-responder has a diagnostic playbook and a known
  baseline (Classification E) to compare against.

### Incident log

**Incident 1 — 2026-04-23 ~22:15 UTC**
- Revision: `operator-os-api-00011-nvj`
- Timing: Phase 3.1 CD deploy, ~2h post-deploy
- Failures: 3 consecutive `curl` exit 56 on `POST /v1/agent/heartbeat/agent`
- Other endpoints in same window: `/health` 200, `/ready` 503, `/v1/tasks` 401, stream 501 — all expected
- Evidence: zero Cloud Run application logs for the endpoint during the failure window
- Resolution: **spontaneous** within ~8h (endpoint returned 401 normally the following morning; 9-probe diagnostic battery all green)

**Incident 2 — 2026-04-24 ~12:00 UTC**
- Revision: `operator-os-api-00012-zrk`
- Timing: Phase 3.2 CD deploy, ~8 min post-deploy
- Failures: 4 consecutive `curl` exit 56 on the same endpoint
- Other endpoints in same window: `/health` 200, `/ready` 503, `/v1/tasks` 401, `/v1/cost/estimate` 401, stream 501 — all expected
- Evidence: zero Cloud Run application logs for the endpoint during the failure window
- Code-diff ruling: `git diff 02898c1..751c9c3 -- apps/api/src/routes/agent.ts` is empty. Phase 3.2 did not modify the heartbeat route or any adjacent code path.
- Resolution: **pending** — passive observation via `apps/api/scripts/heartbeat-probe.sh`

### Updated hypothesis (post-incident 2)

*Superseded by the 2026-04-25 revision below — kept for
historical reference.*

- **H1 (~65%)** — Cloud Run edge routing cache / state inconsistency during or immediately after a revision swap, scoped to this one endpoint path. Pattern support: both incidents occurred minutes-to-hours of a fresh revision going live; both produced zero application logs; other endpoints on the same revision at the same time responded normally.
- **H2 (~20%)** — Network-path / TLS edge transient that varies per day. Pattern support: Phase 3.1 resolved spontaneously; weak time-of-day correlation; N=2 is too small to conclude.
- **H3 (~5%)** — Code regression. Pattern against: diff-empty between Phase 2 merge (`02898c1`) and Phase 3.2 merge (`751c9c3`) on the agent route file; other endpoints on the new revision respond normally.
- **H4 (~5%)** — Agent-side / client-local issue. Pattern against: same `curl` binary, same TLS session, same client box successfully probed other endpoints in the same minute.
- **H5 (~5%)** — Regional / project-wide Cloud Run anomaly. Pattern against: endpoint-specific scope; no other services in the project report similar behavior.

### Hypothesis revision 2026-04-25 (post-incident 2 + 5 fresh revisions observed)

Five new revisions deployed over the 24h after incident 2
(`00013-2p4`, `00014-wpd`, `00015-25w`, `00016-s2b`,
`00017-t59`). Heartbeat probed on the latest two: 3 of 3
returned 401 normally on `00017-t59` within ~2 min of
revision creation. **No new TD-030 incident.** This shifts
the hypothesis distribution materially.

- **H1 (~35%, was 65%)** — Cloud Run edge routing cache during revision swap. **WEAKENED.** If H1 were dominant, the post-deploy window of 5 fresh revisions in 24h should have produced more 000 incidents; only `00012-zrk` (incident 2) did. The mechanism may still exist but the trigger is rarer and not deterministic per-deploy.
- **H2 (~50%, was 20%)** — Network-path / TLS edge transient with day-of-week or load variance. **STRENGTHENED.** Both observed incidents occurred ~22:00 UTC during low-traffic windows. Could be Google edge-layer batching / cleanup / cert-rotation artifact that fires on a much longer-than-revision cadence.
- **H3 (~5%, unchanged)** — Code regression. Diff-empty evidence holds across all 5 fresh revisions; no code-path change to heartbeat handler in any of them.
- **H4 (~5%, unchanged)** — Agent-side / client-local. Pattern against unchanged.
- **H5 (~5%, unchanged)** — Regional / project-wide Cloud Run anomaly. Endpoint-specific scope unchanged.

**Action threshold revision:** file a Cloud Run support case
ONLY on incident #3 with a reproducible pattern. Two
incidents within 100+ revision-swap-class events does NOT
establish a strong reproducible pattern by Google's bar.
Continue passive monitoring via
`apps/api/scripts/heartbeat-probe.sh`.

### Action on recurrence

On a **third** incident OR on any user-facing impact:

1. **File a Cloud Run support case** with full evidence for all three incidents — timestamps, revisions, zero-app-logs proof, endpoint-specific pattern, regional + project scope. Request edge-path investigation (GFE / L7 LB / TLS terminator / instance-routing layer).
2. **Consider a route-layer workaround** — client-side retry on `curl` exit-56 / `ECONNRESET` in the desktop-agent's `AgentHeartbeatLoop` poster. The loop already has backoff + 401 refresh hooks; extend to also retry on mid-response connection drop.
3. **Escalate priority to P1** if a user reports impact (e.g. agent appearing offline in the UI despite being connected).

Until the third incident or a user-facing report, continue passive observation. `apps/api/scripts/heartbeat-probe.sh` is designed to be run every 15–30 min — it returns 401 when the endpoint has resolved, 000 when still in a failure window.

### Re-query playbook (unchanged — applies to every new failure window)

When a new failure window is observed, re-capture:

1. Exact timestamp range (UTC, to the second) and failing endpoint path(s).
2. Any concurrent successful probes / production traffic to the same revision for comparison.
3. Cloud Run logs for that window across all severities:

   ```bash
   export CLOUDSDK_PYTHON=/d/SDKs/GoogleCloudCLI/google-cloud-sdk/platform/bundledpython/python.exe
   gcloud logging read \
     'resource.type="cloud_run_revision"
      AND resource.labels.service_name="operator-os-api"
      AND resource.labels.revision_name="operator-os-api-<NN>-<suffix>"
      AND timestamp>="<start>" AND timestamp<="<end>"' \
     --project=operator-os-dev \
     --limit=200
   ```

4. If application logs are still empty during the window → append a new entry under "Incident log" + proceed per "Action on recurrence" step 1 if this is the third or later window.
5. If application logs appear → reclassify as C (handler-specific) or B (middleware glob) and diagnose in code.

### Stale close condition

If no recurrence within 90 days of filing (by ~2026-07-23),
close as "unable to reproduce, single incident, attributed
to Cloud Run edge transient." The evidence trail stays in
git history + `decisions.md` for archaeology.

### Evidence trail

- `decisions.md` entry `2026-04-24-0600 — Heartbeat transient
  diagnostic + classification` — full diagnostic session
  transcript.
- `decisions.md` entry `2026-04-23-2215 — Heartbeat 000×3
  transient (unresolved at time…)` — original incident
  capture.
- Cloud Run revision at time of incident:
  `operator-os-api-00011-nvj`.
- Last code change before the incident: PR #33 (merge commit
  `e953378`) — task submission + persistence, Phase 3.1.
- Code diff verification: `apps/api/src/app.ts` diff
  `02898c1..e953378` is purely additive — inserts
  `registerTaskRoutes` between `registerAgentWsRoute` and
  `registerInternalTasksRoutes`, no middleware or plugin
  changes, no reordering of existing route registrations.

### Related

- TD-021 (`gcloud builds submit` log-streaming hangs in the
  GitHub Actions runner) — same infrastructure family
  (Cloud Run + gcloud cosmetic / edge quirks), different
  surface. If both accumulate, it argues for a Cloud Run
  edge-reliability tracking umbrella issue.
- Phase 3.1 Gate 3.1.C `decisions.md` entry (2026-04-24-0100)
  — route-registration context at time of incident.

### History

- 2026-04-24: filed after a 9-probe diagnostic sprint
  (rested morning) confirmed Classification E at ~85%
  confidence. No regression, no rollback, no code fix
  needed today. Filed to preserve discipline: a future
  recurrence inherits a known playbook rather than a fresh
  mystery.
- 2026-04-24 ~12:00 UTC: **Incident 2** observed on Phase
  3.2 CD-deploy revision `operator-os-api-00012-zrk`.
  Trigger criteria met (4 × exit 56, zero app logs, other
  endpoints clean, diff-empty). Priority promoted **P3 →
  P2** — no longer a single incident; pattern established.
  Incident log + updated hypothesis + action-on-recurrence
  protocol added to this TD. `apps/api/scripts/
  heartbeat-probe.sh` added for passive monitoring.
  Support case deferred until a third incident.

## TD-031: Redis-backed round-robin cursor for multi-instance api

Discovered: 2026-04-24 (Phase 3.2 c9 — task-router in-memory cursor)
Type: scalability · correctness
Priority: P3
Status: open
Trigger: when `operator-os-api` runs on more than one Cloud Run
    instance (likely at >100 concurrent users).

### Description

`apps/api/src/services/task-router.ts` keeps its round-robin
cursor in a private `Map<bucketKey, lastIdx>`. Two api replicas
will each have their own cursor; the same capability bucket can
over-pick one agent because each replica's cursor advances
independently. Under single-instance deploy today this is a
non-issue; under multi-instance it becomes a fairness bug.

### Risk if unaddressed

- Agent load imbalance once api is horizontally scaled. Worst
  case: one agent receives ~2× the dispatch volume of its peers
  in a bucket until organic load rotates the cursors back into
  sync.
- Zero risk today (single-instance by design, ADR *Agent
  WebSocket Sessions Are In-Memory* covers the posture).

### Proposed fix

1. Provision a Memorystore (Redis) instance in the
   `operator-os-dev` project via a separate infra PR. VPC
   Connector required for Cloud Run → Memorystore.
2. Add `ioredis` as an `apps/api` dependency.
3. Reimplement `TaskRouter` cursor storage as a Redis HSET keyed
   by bucket, value = lastIdx. Interface (`findMatchingAgent`)
   stays identical; consumers do not change.
4. Env additions: `REDIS_HOST`, `REDIS_PORT`. Route through
   `packages/config/src/api.ts`.

### Related

- TD-027: same migration trigger for the idempotency cache. A
  single Memorystore instance can serve both the idempotency
  cache and the router cursor.
- ADR *Capability Matching — Subset Rule + In-Memory Round-Robin*
  (2026-04-24) records the deferral rationale.

### History

- 2026-04-24: filed when Phase 3.2 c9 landed the in-memory cursor.
  Deferred until horizontal scaling.

## TD-032: Pub/Sub dispatch monitoring + alerting

Discovered: 2026-04-24 (Phase 3.2 c3/c7 — dispatch topics landed
    without monitoring surface)
Type: observability
Priority: P3
Status: open
Trigger: before the first paying customer, or when dispatch
    exhaustion becomes invisible to ops.

### Description

Phase 3.2 ships `task-dispatch-${ENV}`, `task-dispatch-dlq-${ENV}`,
and the `task-dispatch-retry-${ENV}` Cloud Tasks queue without
a Cloud Monitoring dashboard or alert policies. Ops visibility
today is via `gcloud logging read` — sufficient for debugging but
not for trend detection (gradual drift of DLQ rate, sudden spike
in retry depth).

### Risk if unaddressed

- Silent failure modes: all agents disconnect during a regional
  issue; tasks pile up in retry queue; no page fires until a
  user complains.
- DLQ fills without a consumer reading it (Phase 3.2 logs DLQ
  entries but does not expose them in a UI).
- Hard to tell when it is time to act on TD-031/033 without
  fleet-level utilisation data.

### Proposed fix

1. Cloud Monitoring dashboard with:
   - Pub/Sub `task-dispatch-${ENV}` oldest-unacked-message-age
   - Pub/Sub `task-dispatch-dlq-${ENV}` message rate
   - Cloud Tasks `task-dispatch-retry-${ENV}` queue depth +
     dispatch rate
   - api log rate for `task_dispatch_receive_failed` +
     `task_dispatch_dlq_received`
2. Alert policies:
   - DLQ rate > 1/min for 5 minutes → page
   - Retry queue depth > 100 for 10 minutes → warn
   - Oldest-unacked-message-age > 60s for 5 minutes → warn
3. Terraform the above so future envs inherit for free.

### Related

- TD-021 (gcloud log-streaming hang): monitoring via Cloud
  Console instead of CLI would have made that cosmetic hang
  obvious faster.
- TD-033 (reliability scoring) — reliability input feeds from
  the same telemetry pipeline.

### History

- 2026-04-24: filed when Phase 3.2 dispatch infra landed without
  a monitoring surface. Deferred to the next ops hardening pass.

## TD-033: Agent reliability scoring (weighted capability match)

Discovered: 2026-04-24 (Phase 3.2 c9 — round-robin ignores agent
    reliability)
Type: scalability · correctness
Priority: P3
Status: open
Trigger: when a fleet includes agents with observably different
    reliability and flat round-robin produces visible complaints.

### Description

`TaskRouter.findMatchingAgent` treats every capability-matched
agent identically. A newly-connected, rarely-tested agent gets
the same rotation slot as a well-understood stable one. Under
the current single-agent Phase 3.2 demo this is fine; once a
fleet has >1 agent per capability bucket and observable failure
rates, equal treatment becomes wasteful.

### Risk if unaddressed

- User-visible dispatch to unreliable agents even when better
  options exist — task-rejected + re-queue latency counts
  against user wait time.
- Harder to onboard a new agent safely — once accepted it gets
  equal traffic immediately.

### Proposed fix

1. Persist per-agent telemetry in Firestore: task-accepted /
   task-rejected / task-completed / task-failed counters over
   a rolling window (30 days).
2. Compute a reliability score (decay-weighted acceptance +
   completion rate) at router initialisation and after each
   terminal task event.
3. Augment round-robin with reliability weighting: agents with
   score < threshold get routed half as often as their peers.
4. Keep the canonical bucket-key scheme for grouping.

### Related

- TD-031 (Redis round-robin) — reliability store needs a shared
  backing; roll into the Memorystore migration.
- TD-032 (dispatch monitoring) — telemetry pipeline feeding this
  score is the same one that feeds the monitoring dashboard.

### History

- 2026-04-24: filed when Phase 3.2 c9 chose flat round-robin.
  Deferred pending telemetry.

## TD-034: Cloud Tasks region unification (europe-west1 → europe-west4)

Discovered: 2026-04-24 (Phase 3.2 c1 — new retry queue pinned to
    europe-west4 per stop rule #11; legacy queues stay europe-west1)
Closed:     2026-04-25 (superseded — see "Closure" below)
Type: infrastructure
Priority: P3
Status: **CLOSED — superseded by architectural reality**
Trigger: N/A (closed)

### Description

`CLOUD_TASKS_LOCATION` is `europe-west1` and controls the
Phase 2 legacy queues (`commands`, `approvals`, `exports`).
Phase 3.2 introduced a new env var
`TASK_DISPATCH_RETRY_QUEUE_LOCATION` (default `europe-west4`) so
the new retry queue is co-located with the api (stop rule #11).
The result is two regions in one project — historical accident
compounded by a principled new choice.

### Risk if unaddressed

- Cross-region latency on legacy queue flows (marginal today,
  worse under load).
- Mental overhead for on-call: two regions to check when tracing
  a dispatch.
- Confusing for new engineers reading the config schema.

### Proposed fix

1. Recreate `commands`, `approvals`, `exports` queues in
   `europe-west4` via `gcloud tasks queues create`.
2. Double-dispatch window: api publishes to both regions for
   ~24h while we verify drain on europe-west1.
3. Drain europe-west1 queues (wait for all inflight tasks to
   finish).
4. Flip `CLOUD_TASKS_LOCATION` default to `europe-west4`.
5. Delete europe-west1 queues.

### Related

- ADR *Task Dispatch — Pub/Sub Push + Cloud Tasks Retry*
  (2026-04-24) — where the new europe-west4 retry queue was
  introduced.

### History

- 2026-04-24: filed at Phase 3.2 c1 when the region asymmetry
  landed. Deferred to the next infrastructure-touching PR.
- 2026-04-25: closed as superseded — see "Closure" below.

### Closure 2026-04-25

Resolution: **superseded.** Cloud Tasks does NOT support
`europe-west4` (the api's Cloud Run region). The discovery
landed during Phase 3.2 manual setup when
`gcloud tasks queues create --location=europe-west4` failed
with `Location 'europe-west4' is not a valid location for
Cloud Tasks.` See TD-039 for the process gap.

The TD's original goal — region uniformity for all Cloud
Tasks queues — was achieved by the inverse path: deploying
the NEW Phase 3.2 queue (`task-dispatch-retry-dev`) in
`europe-west1`, co-located with the existing legacy queues
(`commands`, `approvals`, `exports`). All Cloud Tasks
queues in the project now live in `europe-west1`. The api
remains in `europe-west4` (Cloud Run-only); a small
cross-region hop on each retry-task dispatch (~5–10ms) is
the cost of regional-uniformity-by-co-location.

Evidence:
- `gcloud tasks locations list --project=operator-os-dev`
  output (2026-04-24): EU regions are
  `europe-central2`, `europe-west1`, `europe-west2`,
  `europe-west3`, `europe-west6`. **No `europe-west4`.**
- `gcloud tasks queues describe task-dispatch-retry-dev
  --location=europe-west1` returns RUNNING.
- TD-039 documents the process gap (DP-1 region locked
  without service-availability check).
- Phase 3.2 manual setup chose `europe-west1` autonomously
  at Checkpoint 1; rationale captured in `decisions.md`
  entry 2026-04-25-0635.

Stop-rule revision: stop rule #11 was originally written
"Cloud Tasks queue must match europe-west4 api". The
revised effective rule, applied for the rest of the project:
"Cloud Tasks queue in the closest supported EU region to
the api (currently `europe-west1`)."

This closure is **actionable**, not stale — the situation
changed, the goal was met by a different mechanism, no work
remains. If `europe-west4` becomes a Cloud Tasks region in
the future, a new TD can re-open the unification question
on its merits at that time.

## TD-035: Internal routes path migration (`/internal/*` → `/v1/internal/*`)

Discovered: 2026-04-24 (Phase 3.2 c7 — new internal routes use the
    versioned /v1 prefix while Phase 2 /internal/tasks/{commands,
    approvals, exports} stayed unversioned)
Type: consistency
Priority: P3
Status: open
Trigger: next docs/refactor sweep that touches the legacy internal
    routes, or when the parallel conventions start confusing new
    engineers.

### Description

Phase 3.2 Gate 3.2.A decision DP-2 locked `/v1/internal/*` for
all NEW internal routes to match the rest of the API's `/v1/*`
versioning. Phase 2 `/internal/tasks/{commands,approvals,exports}`
kept their unversioned paths to avoid scope creep at merge time.
Result: two internal-path conventions coexist.

### Risk if unaddressed

- Confusion for on-call / new engineers reading the route
  registry.
- No breaking change risk (these are internal routes, not
  user-facing), but the inconsistency accumulates mental debt.

### Proposed fix

1. Move `commands`, `approvals`, `exports` handlers to
   `/v1/internal/tasks/{commands,approvals,exports}`.
2. Update the Cloud Tasks queue callers (in
   `apps/api/src/integrations/tasks.ts`) to the new paths.
3. Docs-only PR. No CD redeploy required (the Cloud Tasks
   target paths are written at enqueue time, so existing
   in-flight tasks still hit the old paths for ~a day; ship the
   new paths + keep the old handlers as aliases for a
   deprecation window).

### Related

- ADR *Task Dispatch — Pub/Sub Push + Cloud Tasks Retry*
  (2026-04-24) — where the `/v1/internal/*` convention was
  set for new routes.

### History

- 2026-04-24: filed at Phase 3.2 Gate 3.2.A when DP-2 was
  accepted. Deferred to a dedicated cleanup PR.

## TD-036: OIDC verification paths consolidation

Discovered: 2026-04-24 (Phase 3.2 c5 — new middleware file created
    instead of extending integrations/auth.ts per DP-3)
Type: code-health
Priority: P3
Status: open
Trigger: when the Phase 3.2 OIDC middleware has seen two months
    of production usage without regression, or when a third
    OIDC code path tempts someone to create another separate
    verifier.

### Description

The api now has two OIDC verifiers:

- `apps/api/src/integrations/auth.ts`
  `FirebaseAuthService.verifyGoogleIdToken` — serves user + agent
  auth (Firebase + Google OIDC fallback via OAuth2Client).
- `apps/api/src/middleware/google-oidc-verifier.ts` — Phase 3.2
  internal-route preHandler (pure Google OIDC, SA allowlist).

DP-3 (Gate 3.2.A, Akmal-approved) chose isolation over consolidation
for Phase 3.2 to avoid regression risk on Phase 1/2 callers. The
two paths share ~40 lines of verification logic (issuer check,
audience, email_verified, sub).

### Risk if unaddressed

- Drift: a security-critical change to one verifier (e.g. adding
  `aud: string[]` handling) may not land in the other.
- Test surface duplication — both code paths have their own
  mocks + coverage.

### Proposed fix

1. Extract shared verification primitives into
   `apps/api/src/middleware/oidc-primitives.ts` (`verifyClaims`,
   `extractBearer`).
2. Rewrite `FirebaseAuthService.verifyGoogleIdToken` and
   `GoogleOidcVerifier.verify` to delegate to the primitives.
3. Keep the two factory functions (user auth vs internal guard)
   as separate public APIs — they have different rejection
   semantics (IntegrationError vs OidcVerificationError).

### Related

- DP-3 (Gate 3.2.A, 2026-04-24) — the isolation decision.
- ADR *Internal Route Authentication — Google OIDC ID Token*
  (2026-04-24).

### History

- 2026-04-24: filed at Phase 3.2 Gate 3.2.A when DP-3 chose
  isolation. Deferred to a code-health sweep after the middleware
  has stabilised.

## TD-038: CD Deploy workflow path filter is too broad

Discovered: 2026-04-24 (Phase 3.2 closure follow-up — TD-030
    recurrence commit `666b576` triggered an unintended CD
    redeploy on a docs + `apps/api/scripts/*.sh` change)
Type: operational-hygiene · ci
Priority: P3
Status: open
Trigger for action: next infra / CI-cleanup PR, or next time
    someone bundles a non-container change with a container
    change and the resulting CD redeploy becomes inconvenient.

### Description

`.github/workflows/cd-deploy.yml` has two layers of path filters,
both of which currently include the whole `apps/api/**` tree:

1. Top-level workflow `paths:` — governs whether the workflow
   runs at all on a push to `phase3/live-deploy-and-vertex`.
2. Job-level `dorny/paths-filter@v3` inside `detect-changes`
   — sets `api_changed`, which gates whether `deploy-api`
   fires.

Both match `apps/api/scripts/*.sh`, `apps/api/README.md`, and
`apps/api/**/__tests__/**` even though none of those are
compiled into the Cloud Run container. A push that touches any
of them produces a cosmetic redeploy (new revision, byte-
identical to the prior one) with all the usual Cloud Build
cost and TD-030 post-deploy-window risk.

Concrete incident: commit `666b576` bundled
`docs/TECH_DEBT.md` edits + a new
`apps/api/scripts/heartbeat-probe.sh`. Intent was docs-only;
actual outcome was CD Deploy run `24910979376` firing on the
push (cancelled manually before a redeploy landed).

### Risk if unaddressed

- Cosmetic redeploys waste Cloud Build minutes and burn
  revision numbers.
- Each redeploy is a fresh post-deploy window that may exercise
  the TD-030 heartbeat pattern — noise in a signal we are
  trying to observe.
- Revision churn during a manual `gcloud run services update`
  can collide (409) with in-flight CD-driven revision
  creation, forcing retry dances.
- Path-filter ambiguity makes it harder to reason about
  "will this commit deploy?" from the diff alone — surprises
  the reviewer and the on-call.

### Proposed fix

Preferred — tighten the top-level `paths:` filter to list
only container inputs explicitly:

```yaml
on:
  push:
    branches:
      - phase3/live-deploy-and-vertex
    paths:
      - 'apps/api/src/**'
      - 'apps/api/package.json'
      - 'apps/api/tsconfig.json'
      - 'apps/api/Dockerfile'
      - 'apps/auth-gateway/src/**'
      - 'apps/auth-gateway/package.json'
      - 'apps/auth-gateway/tsconfig.json'
      - 'apps/auth-gateway/Dockerfile'
      - 'packages/contracts/src/**'
      - 'packages/config/src/**'
      - 'infra/cloudbuild/**'
      - 'infra/cloud-run/**'
```

And mirror the same discipline in the inner
`dorny/paths-filter@v3` step.

Alternative — negative-path exclusions (GitHub Actions path
filter supports `!` prefix):

```yaml
paths:
  - 'apps/api/**'
  - '!apps/api/scripts/**'
  - '!apps/api/README.md'
  - '!apps/api/**/__tests__/**'
  - '!apps/api/**/*.test.ts'
```

Both work; the explicit-positive list is more auditable and
matches how the Cloud Build context is assembled today.

### Stale close condition

When the PR landing the tighter filter is merged AND a
subsequent docs + `scripts/` commit has been verified to
NOT trigger CD, close as resolved.

### Evidence trail

- Incident commit: `666b576` (2026-04-24)
  — `docs/TECH_DEBT.md` + `apps/api/scripts/heartbeat-probe.sh`
- Triggered run: CD Deploy `24910979376` (cancelled by
  operator decision before revision creation).
- Historical contrast: Phase 3.1 docs-only commits `f4e1265`
  (TD-029) and `3d83326` (TD-030) — both under `docs/` only
  — correctly did NOT trigger CD.

### Related

- TD-021 — cosmetic CD hang. Different surface but same
  workflow file; a CI-cleanup PR can address both together.
- TD-030 — post-deploy heartbeat transient. Fewer cosmetic
  deploys = fewer uncontrolled TD-030 windows.

### History

- 2026-04-24: filed after the path-filter trap surfaced during
  Phase 3.2 closure follow-up. Awaiting an infra / CI-cleanup
  PR.
- 2026-04-24 (later): **severity escalation note.** The
  path-filter trap caused TWO cancelled-CD races in the same
  session (`666b576` → race-deployed `00013-2p4`; `2f033d5`
  → race-deployed `00015-25w`). `gh run cancel` does NOT
  reliably stop an in-flight Cloud Build job once it has
  passed the image-push step — the deploy step finishes
  even though GH Actions reports the run as `cancelled`.
  Combined with **TD-040** (cloudbuild `--set-env-vars`
  REPLACE semantics), the second race silently stripped all
  6 Phase 3.2 env vars from production
  (`00014-wpd → 00015-25w`). Priority unchanged at P3 for
  the filter-tightening fix, but the combined urgency with
  TD-040 means both should land in the same infra-cleanup
  pass — TD-040 alone is insufficient because the path
  filter still admits cosmetic deploys, and TD-038 alone is
  insufficient because the next legitimate code deploy
  would still strip env vars.

## TD-039: Pre-lock GCP service regional availability before DP decisions

Discovered: 2026-04-24 (Phase 3.2 manual setup — Cloud Tasks
    queue creation failed because `europe-west4` is not a
    Cloud Tasks location)
Type: process · planning-hygiene
Priority: P3
Status: open (process correction; decision already applied —
    region switched to `europe-west1`)
Trigger for action: next time a Decision Proposal locks a
    GCP region without verifying service availability.

### Description

Gate 3.2.A DP-1 locked `TASK_DISPATCH_RETRY_QUEUE_LOCATION =
europe-west4` to co-locate the new Cloud Tasks retry queue
with the api's Cloud Run region, honoring the then-stated
stop rule #11 ("Cloud Tasks queue must match europe-west4
api"). The decision was approved without a
`gcloud tasks locations list` check. Cloud Tasks does NOT
support `europe-west4` as a region. The manual queue
creation on 2026-04-24 failed with `Location
'europe-west4' is not a valid location for Cloud Tasks.`

The decision was corrected in-flight: the queue is now in
`europe-west1` (closest EU Cloud Tasks region, co-located
with the Phase 2 legacy queues). Knock-on effects:

- Stop rule #11 as originally written is physically
  impossible. Revised intent: "Cloud Tasks queue in the
  closest supported EU region to the api" — `europe-west1`
  meets that bar.
- **TD-034 becomes a no-op** — it tracked "migrate
  europe-west1 legacy queues to europe-west4 for uniformity
  with api". The unification target is impossible; but the
  NEW queue in europe-west1 achieves Cloud Tasks regional
  uniformity (all our queues in one region). TD-034 should
  be closed as "resolved by accident — europe-west4 not
  available for Cloud Tasks".

### Risk if unaddressed

- Current incident is contained: the manual correction
  happened within minutes; no production impact.
- Future risk: the next DP that locks a region / project /
  service tier without availability verification could bite
  in a less-recoverable way (e.g. at deploy time, after CI
  has already committed to a naming scheme that encodes the
  region).

### Proposed fix (process correction)

Adopt a pre-DP checklist for any directive that locks:

1. **Region / location**: run `gcloud <service> locations
   list` (or equivalent) BEFORE accepting the DP. Confirm the
   specific region supports the specific service.
2. **Service tier / quota**: run
   `gcloud services list --enabled` and check the project's
   quotas for the proposed usage pattern.
3. **Naming scheme that encodes GCP state**: verify the
   encoding is valid for EVERY env (dev / staging / prod)
   before committing.
4. **IAM preconditions**: check whether the DP implies new
   IAM bindings that require prior-permission grants on the
   invoking identity. Document in the pre-plan.

For this specific incident, the fix is already applied:
`create-cloud-tasks-queue.sh` default LOCATION changed to
`europe-west1`, `packages/config/src/api.ts` default
changed to match, config tests updated.

### Stale close condition

When the pre-DP availability-check checklist appears in the
project-level ADR process doc (or any equivalent written
artifact reviewers actually use), close TD-039.

### Evidence trail

- Gate 3.2.A DP-1 approval: Obsidian
  `decisions.md` entry `2026-04-24-0900` — DP-1 accepted
  without region availability verification.
- Manual setup failure: Akmal's PowerShell session reported
  `ERROR: Location 'europe-west4' is not a valid location
  for Cloud Tasks.`
- `gcloud tasks locations list` output at correction time —
  EU subset: `europe-central2`, `europe-west1`,
  `europe-west2`, `europe-west3`, `europe-west6`. No
  `europe-west4`, no `europe-north1`.

### Related

- **TD-034** — Cloud Tasks region unification. Invalidated
  by this finding; close as "impossible target, resolved by
  europe-west1 co-location". A follow-up edit here or to
  TD-034 itself.
- Stop rule #11 (Phase 3.2 kickoff) — revise to reference
  "closest supported EU Cloud Tasks region" rather than
  `europe-west4` specifically.

### History

- 2026-04-24: filed during Phase 3.2 manual setup when DP-1's
  europe-west4 assumption broke at `gcloud tasks queues
  create`. Region corrected to europe-west1 inline; TD
  captures the process gap (DP accepted without availability
  verification) so it does not recur.

## TD-040: `cloudbuild.yaml --set-env-vars` REPLACE clobbers post-merge env additions

Discovered: 2026-04-24 (Phase 3.2 manual setup — second
    cancelled-CD race redeployed `00015-25w` ~90s after the
    `gcloud run services update --update-env-vars` that
    placed Phase 3.2 vars on `00014-wpd`, and `00015-25w`
    came up with all 6 Phase 3.2 vars STRIPPED)
Type: deployment · regression-trap
Priority: **P1**
Status: open (production-impacting; reproduced today)
Trigger for action: NOW. This is structural and silent —
    every CD-driven deploy after an out-of-band env-var
    addition will revert that addition with no error.

### Description

`infra/cloudbuild/api.cloudbuild.yaml` and
`infra/cloudbuild/auth-gateway.cloudbuild.yaml` both invoke
`gcloud run deploy --set-env-vars="..."`. The
`--set-env-vars` flag has **REPLACE** semantics — it sets
the container's env-var list to exactly the supplied
key=value pairs and discards anything else previously set
on the service.

This means: any env var added out-of-band via
`gcloud run services update --update-env-vars` (the standard
ops pattern for adding configuration that doesn't belong in
the deploy YAML) survives until the next CD-driven deploy,
at which point it is silently dropped.

The Phase 3.2 incident on 2026-04-24:

1. Phase 3.2 deploy via PR #34 merge brought api code
   (`registerInternalPubsubRoutes` etc.) live on revision
   `00012-zrk`, but those routes are gated on
   `PUBSUB_PUSH_AUDIENCE`.
2. Manual `gcloud run services update --update-env-vars=...`
   added all 6 Phase 3.2 env vars to the service on revision
   `00014-wpd`.
3. ~90s later a cancelled-CD race (TD-038) deployed source
   commit `2f033d5` via Cloud Build, producing revision
   `00015-25w`. Cloud Build's deploy step issued
   `--set-env-vars=...` with only the 9 baseline vars,
   stripping all 6 Phase 3.2 additions.
4. `00015-25w` took 100% traffic. `/v1/internal/pubsub/*`
   routes silently un-registered (PUBSUB_PUSH_AUDIENCE
   absent ⇒ route registration skipped per the gated
   pattern in `app.ts`). Pub/Sub push messages would 404
   silently. The dispatch pipeline went **offline
   end-to-end** with no health-check failure — `/health`
   stayed 200, `/ready` stayed 503-honest, Phase 3.1 routes
   stayed up.

### Risk if unaddressed

- **Silent regression on every code deploy.** Any future
  env-var addition (Phase 3.3 needs at least one for the
  SSE-streaming endpoint URL; secrets rotation may add
  more) will be wiped by the next CD without warning.
- **No log signal.** `--set-env-vars` does not emit a
  warning when it removes a previously-set var. The drift
  is only visible by reading the new revision's env-var
  list and comparing against expectation.
- **Affects auth-gateway equally** — same pattern in
  `auth-gateway.cloudbuild.yaml`. Phase 1.5 + Phase 2 added
  several env vars there; if anyone has set additional
  Google client IDs or tweaked TTLs out-of-band, those are
  also at risk on the next auth-gateway redeploy.

### Proposed fix

**Option 1 (preferred, applied in this PR):** switch to
`--update-env-vars` in both files. Merge semantics: the
deploy's listed vars are upserted into the existing service
config; previously-set vars (including ops-set additions)
survive.

```diff
-          --set-env-vars="NODE_ENV=production,..."
+          --update-env-vars="NODE_ENV=production,..."
```

Applied to:

- `infra/cloudbuild/api.cloudbuild.yaml`
- `infra/cloudbuild/auth-gateway.cloudbuild.yaml`

**Option 2 (rejected):** keep `--set-env-vars` and embed
all env vars in the YAML. Drawback: every new env var
needs a cloudbuild.yaml change before it can be deployed,
including secrets / per-env tweaks that don't belong in
versioned config. Couples runtime config to CI YAML and
makes ops harder.

### Stale close condition

When the patched cloudbuild.yaml has been confirmed via at
least one CD redeploy + post-deploy env-var presence check
(out-of-band-set vars survive), close TD-040.

### Evidence trail

- Manual setup commit: `2f033d5` (Cloud Tasks region fix +
  TD-039) triggered CD run `24912309788` (cancelled but
  raced through deploy).
- Revision `00014-wpd` (manual env-var set): had all 6
  Phase 3.2 vars — verified via
  `gcloud run revisions describe --format='yaml(spec.containers[0].env)'`.
- Revision `00015-25w` (CD race-redeploy): has 0 of 6 Phase
  3.2 vars — verified the same way.
- Current `apps/api/src/app.ts` route-registration logic:
  `if (config.PUBSUB_PUSH_AUDIENCE) { registerInternalPubsubRoutes(...) }`
  — gating means absent env var ⇒ routes absent.
- Confirmation probe:
  `POST /v1/internal/pubsub/task-dispatch` → 404 on
  `00015-25w`; same call returned 401 on `00014-wpd`.

### Related

- **TD-038** (path-filter trap) — see its severity-escalation
  note. Both TDs together caused this incident; both should
  land in the same infra-cleanup pass.
- ADR *Task Dispatch — Pub/Sub Push + Cloud Tasks Retry*
  (2026-04-24) — defines the env vars that got stripped.
- TD-011 (Cloud Run reserved env-var pattern) — adjacent
  cloudbuild.yaml hardening; reserved-name handling in
  auth-gateway already documents the `PORT` carve-out.

### History

- 2026-04-24: filed when revision `00015-25w` was
  observed to have stripped the Phase 3.2 vars set on
  `00014-wpd`. Fix applied in the same docs-and-config
  commit (this entry's filing PR also patches both
  `cloudbuild.yaml` files); fix confirmation lands when the
  next legitimate code-touching CD redeploys without
  stripping.

## TD-041: Multi-instance event bus for SSE fan-out

Discovered: 2026-04-25 (Phase 3.3 c1 — DP-2 in-memory event
    bus shipped knowing it doesn't survive horizontal scale)
Type: scalability
Priority: P3
Status: open
Trigger: when api scales beyond 1 Cloud Run instance, OR when
    mobile users report stuck / dropped streams that correlate
    with the agent being on a different replica.

### Description

Phase 3.3 ships `taskEventBus` as an in-process
`Map<taskId, Set<subscriber>>` for the SSE fan-out. A single
api instance handles both the agent → bus publish (via the
agent-ws task callbacks) and the bus → SSE subscribe in the same
process — the in-memory bus is correct.

Multi-instance breaks this. If the agent's WebSocket is on
replica A and the user's SSE connection is on replica B, replica
B's bus never sees the agent's deltas. The mobile client would
hang on the post-status frame until the heartbeat keep-alive runs
out, then reconnect onto a random replica and either work (lucky
sticky-routing) or hang again.

### Risk if unaddressed

- The MVP runs on min-instances=0, max-instances=1 today, so
  the dispatch + SSE pair always lands on the same process.
  We're correct *because* we're single-instance.
- The first time we set max-instances > 1 (cost spike, latency
  push, regional spread), agent ↔ user routing breaks for the
  ~50% of cases where the two connections land on different
  replicas.
- Symptoms will look like flaky network: sometimes streams
  work, sometimes don't. Hard to debug without already
  suspecting the bus.

### Proposed fix

Replace the in-memory bus with a Pub/Sub or Redis layer:

1. **Redis Pub/Sub via Memorystore** (preferred). Each api
   instance subscribes to `taskId` topics dynamically; agent
   callbacks publish to those topics. Local SSE subscribers
   are still served by an in-process registry, but the
   registry is fed by both the local agent and remote
   instances via Redis. Cost: ~$25/month minimum.
2. **GCP Pub/Sub topics keyed by taskId**. Same pattern but
   higher latency (Pub/Sub end-to-end is 100-500ms). Probably
   too slow for live token streaming.
3. **Sticky session routing** (Cloud Run header-based). Hack:
   route the SSE GET to the same replica the agent's WS is on
   via a custom header. Doesn't actually solve the problem
   for new agent connections that race the SSE.

Option 1 lands when triggered.

### Stale close condition

When the bus has been migrated AND verified across at least
two-replica deployment, OR when the project is sunsetted
without ever scaling.

### Related

- TD-031 (Redis round-robin cursor for multi-instance) — same
  Redis migration trigger; both can land together.
- ADR *Mobile-To-Api Streaming — SSE* (Phase 3.3) — the
  Consequences section flags this as the load-bearing
  scalability constraint.

### History

- 2026-04-25: filed alongside Phase 3.3 c1 when the DP-2
  in-memory event bus was deliberately chosen for MVP simplicity
  knowing the multi-instance gap.

## TD-042: SSE Last-Event-ID replay caching

Discovered: 2026-04-25 (Phase 3.3 c3 — Firestore replay path
    is correct but unbounded in cost)
Type: cost / performance
Priority: P3
Status: open
Trigger: when Firestore read costs spike OR when p99 SSE
    reconnect latency exceeds 500ms.

### Description

The SSE handler in `apps/api/src/routes/tasks.ts` replays
`task.outputDeltas` slice-by-seq on every reconnect that carries
a `Last-Event-ID` header. Each reconnect = one Firestore
`getTask` read.

For a stable network this is fine — the connection lasts up to
the Cloud Run 60-min cap and reconnect is rare. For unstable
networks (mobile commute, radio handoff, app suspend/resume,
Wi-Fi drop) the same task can trigger 5-10 reconnects in a
single user session. Each reconnect re-reads the full
`outputDeltas` array — Firestore charges per-read regardless of
how much of the array we actually slice.

### Risk if unaddressed

- Firestore bill scales with reconnect frequency × delta count.
  A user with a 100-token answer and 5 reconnects pays for 5
  reads of a doc that may be 10-20 KB depending on prompt
  history.
- Cold-start latency on reconnect: Firestore network round-trip
  is 30-80ms p99. For tasks already mid-stream, that is wall
  time the user waits before seeing tokens resume.
- Heavy reconnect storms (mass mobile reconnect after server
  rotation, regional outage) amplify both effects in a thin
  window.

### Proposed fix

Add an LRU cache keyed by `taskId` carrying the last N deltas
(N = 200 or task-completion, whichever is smaller). Sit in
front of the Firestore replay path:

1. SSE handler subscribes → check cache → cache miss → fall
   back to Firestore (current behaviour) → populate cache.
2. Agent emit → `taskEventBus.publish` AND cache.append.
3. `closeTask` → cache eviction.

Single-instance: in-memory LRU with `quick-lru` or similar.
Multi-instance: Memorystore cache (folds in with TD-041's
Redis migration).

### Stale close condition

When the cache lands AND a 30-day window shows reduced Firestore
read rate per active stream, OR when usage doesn't trigger the
cost / latency thresholds for 90 days after MVP.

### Related

- TD-041 (multi-instance event bus) — natural pairing; both
  benefit from the same Redis investment.
- ADR *Mobile-To-Api Streaming — SSE* (Phase 3.3).

### History

- 2026-04-25: filed alongside Phase 3.3 c3 SSE handler.
  Deferred — current single-user MVP load doesn't justify the
  added complexity.

## TD-043: Mobile SSE polyfill consolidation

Discovered: 2026-04-25 (Phase 3.3 c14 — DP-1 added
    `@microsoft/fetch-event-source ^2.0.1`)
Type: dependency / cleanup
Priority: P3
Status: closed (superseded by TD-054 fix)
Trigger: when the React Native ecosystem adds native
    `EventSource` support with custom-header attachment, OR
    when `@microsoft/fetch-event-source` becomes unmaintained.

### Description

The standard `EventSource` API does not allow the client to
attach an `Authorization: Bearer ...` header. Phase 3.3 c14
adopted `@microsoft/fetch-event-source` as DP-1 to bridge that
gap — the library wraps the native `fetch` with the SSE
streaming protocol and accepts an arbitrary `headers` object.

This is one more dependency on the mobile critical path. The
library is well-maintained (Microsoft) and the API surface we
use is small, so the dependency is fine for MVP. But the
ecosystem is moving: Expo SDK and React Native both periodically
revisit `EventSource` support, and a future version may close
the header gap natively.

### Risk if unaddressed

- The dep stays in `apps/mobile/package.json` indefinitely.
  Low blast radius (~10 KB minified) but unnecessary if the
  platform catches up.
- `@microsoft/fetch-event-source` could go unmaintained
  upstream (the project is small + Microsoft-stewarded; not
  imminent). Migrating off would be an emergency item rather
  than a planned one.

### Proposed fix

Audit the mobile platform's `EventSource` shape every ~6
months. If `expo-fetch-event-source` lands or `EventSource` in
the RN core gains custom-header support, migrate
`apps/mobile/src/services/sse-client.ts` and remove the dep.
Behaviourally identical migration; the wrapper API surface
stays the same.

Alternative: keep `@microsoft/fetch-event-source` indefinitely.
The library is stable enough that "do nothing" is a defensible
plan as long as upstream stays maintained.

### Stale close condition

Migration lands, OR 2 calendar years pass without an
ecosystem change AND the dep stays maintained.

### Related

- DP-1 (initial dependency approval).
- ADR *Mobile-To-Api Streaming — SSE* (Phase 3.3) —
  Consequences section flags the dep as a known cost.

### History

- 2026-04-25: filed alongside Phase 3.3 c14 dep adoption.

## TD-044: Agent execution control hooks (cancel / pause / resume)

Discovered: 2026-04-25 (Phase 3.3 c7 — adapter intentionally
    leaves these out of MVP scope)
Type: feature gap
Priority: P3
Status: open
Trigger: real user feedback requesting any of: mid-stream
    cancellation, pause / resume of long-running tasks, admin
    priority interruption.

### Description

The Phase 3.3 task pipeline has the basic happy path:
submit → assign → execute → stream → complete or fail. There
is no path for the user (or operator admin) to ask the running
task to stop, pause, or hand off mid-stream. The closest thing
today is closing the SSE connection — which only severs the
read leg; the agent keeps spending tokens until the model
finishes.

The Phase 3.2 WS protocol has space for control frames
(`task-rejected` already covers "agent declines this work"),
but no `task-cancel-request`, `task-pause-request`, or
`task-priority-bump`.

### Risk if unaddressed

- Users have no abort affordance. A wrong-prompt task burns
  the full token budget before the user can stop it.
- Long-running agentic tasks (file edits, tool-use loops) have
  no graceful interruption; `kill` is the only option, which
  loses progress.
- Quotas / cost accounting can over-count when an
  ill-conceived task runs to completion vs. being cancelled
  early.

### Proposed fix

Extend the WS protocol with three new client→agent frame types:

- `task-cancel-request` — user pressed cancel; agent should
  finish current sentence then exit gracefully. Server logs
  partial output as `cancelled`.
- `task-pause-request` / `task-resume-request` — adjacent
  primitive; useful for human-in-the-loop review of a tool-use
  step before the agent commits. Optional in v1.
- `task-priority-bump` — admin-only override; not user-visible
  in MVP+1.

Agent-side handlers in `ClaudeCodeAgent.cancelTask` etc.
Adapter layer (Phase 3.3 c7 `task-executor-adapter.ts`)
forwards to those handlers. Server-side: the
`taskEventBus.closeTask` already handles the SSE side; add a
`status: 'cancelled'` frame so the client knows the difference
between "agent died" and "agent was told to stop."

### Stale close condition

When cancellation lands AND user feedback confirms the
affordance is sufficient. Pause/resume can land later as a
separate ticket.

### Related

- ADR *ClaudeCodeAgent Integration — Phase 1.4 + Thin
  Adapter* (Phase 3.3) — Consequences section notes this as
  the deferred control-plane work.
- Phase 3.2 `task-rejected` frame — sibling shape; would
  follow the same routing.

### History

- 2026-04-25: filed alongside Phase 3.3 c7 adapter. Deferred
  as post-MVP feature; MVP ships with happy-path-only
  execution.

## TD-046: Authenticated end-to-end smoke-test harness

Discovered: 2026-04-25 (Phase 3.3 MVP smoke test caught two
    latent prod bugs — see TD-046 / TD-047 / TD-048 sibling
    entries — that no prior test layer could detect)
Type: testing infrastructure
Priority: P2
Status: open
Trigger: every CD deploy of api + auth-gateway should run this
    before traffic-shifting to the new revision.

### Description

Phase 3.3 c18 added an E2E integration test that composes most
of the api-side layers, but it cuts two corners that hide whole
classes of production bug:

1. The Firestore repository is a **recording-fake** (in-memory
   Map). Real Firestore SDK semantics (e.g., undefined-field
   rejection) are never exercised.
2. The dispatch handler is invoked **directly**, bypassing the
   real Pub/Sub publish + push subscription round-trip. The
   real IAM bindings on the topics are never exercised.

Phase 3.3's first authenticated end-to-end POST in production
hit both seams immediately (TD-046 = `metadata: undefined`
silent reject; TD-047 = `pubsub.publisher` IAM gap). Neither
shows up in unit, integration, or sanity-probe layers.

A staging-or-production smoke test that authenticates as a
dev-minted user, submits a real task, watches the SSE stream,
and asserts a delta or two arrived would have caught both on
the first try.

### Risk if unaddressed

- Future feature work on the dispatch / streaming path lands
  with the same blind spot. Each new optional schema field is
  a new chance to silently brick production. Each new IAM
  permission is a new chance to silently break a downstream
  integration.
- Smoke debt compounds: by the time the next user-visible bug
  fires, the change-window will be much larger than today's
  one-line fix.

### Proposed fix

Single test file (e.g.
`apps/api/src/__tests__/smoke-prod.test.ts`) that:

1. Reads `OPERATOR_OS_SMOKE_TARGET=https://...` and
   `OPERATOR_OS_SMOKE_GATEWAY=https://...` from env. CI / staging
   sets these; localhost is the default.
2. Mints a user JWT via the dev-mint endpoint (TD-045 PR #36's
   gating: requires `AUTH_DEV_MINT_ENABLED=true` on the gateway).
3. POSTs `/v1/tasks` with a tiny prompt that the agent can echo
   without spending real Anthropic credit (use the echo-stub
   executor on the smoke-target agent).
4. GETs the SSE stream, asserts at least one `delta` and the
   `completed` frame arrive.
5. Disables `AUTH_DEV_MINT_ENABLED` on the way out.

CI hook: post-deploy verification step (after CD redeploys but
before declaring "deploy successful"). Failure aborts the
traffic shift.

### Stale close condition

When the harness lands AND has caught at least one real bug AND
is wired into the CD workflow as a gate.

### Related

- Sibling: TD-047 (IAM gaps) and TD-048 (POST swallow-and-log).
- PR introducing the dev mint enabling this harness:
  `feat(auth-gateway): dev mint endpoint for smoke testing` (#36).

### History

- 2026-04-25: filed when the Phase 3.3 first-prompt smoke test
  caught two prod bugs that all prior test layers missed.

## TD-047: Audit IAM bindings for the api + agent + dispatch surfaces

Discovered: 2026-04-25 (Phase 3.3 smoke test surfaced
    `pubsub.publisher` gap on cloudrun-runtime SA)
Type: ops / IAM
Priority: P2
Status: open
Trigger: now, while the audit context is fresh — and again
    before each future deploy that adds a new topic, queue, or
    storage bucket.

### Description

The Phase 3.3 smoke test caught one specific IAM gap (the api's
runtime SA had no `roles/pubsub.publisher` on
`task-dispatch-dev`). That gap was fixed in
`apps/api/scripts/iam/grant-pubsub-publisher.sh` and applied
out-of-band against operator-os-dev. But the discovery raises
the question: **what other IAM bindings is the project missing
because nothing has exercised them in production yet?**

Surfaces that should be audited:

1. **Pub/Sub topics + the runtime SA**:
   - `task-dispatch-dev`: ✅ bound (today)
   - `task-dispatch-dlq-dev`: ✅ bound (today)
   - other topics in the project (`agent-events`, `budget-events`,
     `session-events`, `trend-*`, `operator-alerts`): not
     currently used by Phase 3.3 but may need bindings if/when
     the api starts publishing to them. Probably none today;
     check.
2. **Cloud Tasks queues + the runtime SA**:
   - `task-dispatch-retry-${ENV}` queue (Phase 3.2 c5): the api
     `TaskRetryScheduler` calls `cloudtasks.tasks.create`, which
     requires `roles/cloudtasks.enqueuer` on the queue. If this
     was never bound, dispatch retries will silently fail the
     same way Pub/Sub publish did.
3. **Firestore + the runtime SA**:
   - api currently uses `roles/datastore.user` on the project
     (broad). Verify this binding still exists; verify scoping
     opportunity (collection-level if Firestore supports it).
4. **Secret Manager + the runtime SA**:
   - HS256 signing secret access. Current pattern: ADC-based
     access. Verify the binding exists.
5. **auth-gateway runtime SA** (separate from api's): may need
   distinct topic-publish bindings if it ever publishes events
   (e.g., user-created notifications).
6. **Both gateways' Firestore clients**: same Firestore-undefined
   pattern as TD-046 sibling — see
   `apps/auth-gateway/src/services/refresh-token-store.ts:225`
   and `users-repository.ts:175`. They `new Firestore({})`
   without `ignoreUndefinedProperties: true`. Doesn't bite today
   (records they write don't have leaky undefined fields) but
   matches the pattern that bit api.

### Risk if unaddressed

Same shape as TD-046's smoke gap: future deploys can land with
silent IAM holes that only surface when authenticated traffic
exercises the path. The blast radius is "the feature stops
working in production but unit tests are green and CI deploys
clean."

### Proposed fix

One audit pass:

```bash
# Print every IAM binding on the project + topics + queues.
gcloud projects get-iam-policy operator-os-dev
gcloud pubsub topics list --project=operator-os-dev | \
  while read t; do
    name=$(echo "$t" | awk -F/ '{print $NF}')
    echo "=== $name ==="
    gcloud pubsub topics get-iam-policy "$name" --project=operator-os-dev
  done
gcloud tasks queues list --project=operator-os-dev --location=europe-west4 | \
  while read q; do
    [ -n "$q" ] || continue
    name=$(echo "$q" | awk '{print $1}')
    echo "=== $name ==="
    gcloud tasks queues get-iam-policy "$name" --project=operator-os-dev --location=europe-west4
  done
```

Cross-reference each binding with what the runtime SAs need.
File any gaps as IAM-grant scripts under
`apps/api/scripts/iam/` and `apps/auth-gateway/scripts/iam/`.

Bonus: also harden the auth-gateway Firestore clients with the
same `ignoreUndefinedProperties: true` pattern as
TD-046's fix — defensive consistency.

### Stale close condition

When the audit script has run AND any gaps are filled AND the
audit script is checked into the repo for repeatable runs.

### Related

- TD-046 (smoke test harness) — same root concern, different
  axis.
- `apps/api/scripts/iam/grant-pubsub-publisher.sh` — first
  IAM-grant script in the new pattern.

### History

- 2026-04-25: filed alongside Phase 3.3 smoke test that caught
  the first IAM gap.

## TD-048: POST /v1/tasks swallow-and-log on Firestore write failure

Discovered: 2026-04-25 (smoke test exposed the false-positive 201)
Type: correctness
Priority: P2
Status: open
Trigger: now — this is a real user-facing correctness bug that
    only smoke-level testing surfaced.

### Description

`apps/api/src/routes/tasks.ts:264-273`:

```ts
try {
  await options.repository.recordTask(record);
} catch (err) {
  app.log.warn({ err, taskId }, 'recordTask threw; returning 503');
  reply.status(503);
  return apiError('firestore_unavailable', 'Task could not be durably recorded');
}
```

The handler appears to handle Firestore write failures correctly
(503 + structured error). HOWEVER, in production we observed:

- POST returned **201** with a taskId.
- Firestore log: `firestore write failed: Cannot use 'undefined'
  as a Firestore value`.
- GET on the taskId: 404. The task does not exist.

Hypothesis: the Firestore SDK's `set()` call may not throw
synchronously for some write-rejection modes — it may resolve
successfully on the wire (network OK, service OK) but log the
error elsewhere (driver-level) without surfacing it to the
caller's promise. Worth confirming by reading the
`@google-cloud/firestore` source for the
`ignoreUndefinedProperties: false` rejection path.

Either way, the handler trusts the SDK to throw on failure. If
the SDK ever returns a "successful but actually broken" promise,
the api hands the client a taskId for a record that doesn't
exist. The client then 404s on every GET / SSE / list. From the
user's perspective: silent data loss.

### Risk if unaddressed

Same shape as TD-046 (smoke harness gap). The Firestore-undefined
fix in TD-046's PR is sufficient for the specific symptom we hit,
but the antipattern remains: **a `try/catch` around an SDK call
isn't enough if the SDK can fail without throwing**. Any future
write that fails-but-doesn't-throw will recreate the false 201.

### Proposed fix

Two layers:

1. **Defense in depth in the POST handler** — after
   `recordTask`, optionally `getTask(taskId, userId)` to verify
   it exists. If not, treat as a 503 (same handling as the
   thrown branch). One extra read per POST; acceptable cost.
2. **OR, instrumentation only** — keep the current path, but
   add a metric / structured-log line `task_post_persistence_ok`
   whose absence-after-a-201 we can alert on. Lower-cost; later
   detection but at least we know it's happening.

Both have downsides; (1) doubles the Firestore round-trip, (2)
adds an alert that's only as good as the ops cadence reading it.
Pick (1) for correctness-first stance.

### Stale close condition

When the handler verifies persistence (or the SDK contract is
documented and verified to throw on every failure mode that
matters).

### Related

- TD-046 (smoke harness) — same root concern.
- TD-047 (IAM audit) — sibling discovered together.
- The Firestore-undefined fix in
  `fix/firestore-undefined-and-pubsub-iam` patches the immediate
  symptom; this TD covers the antipattern itself.

### History

- 2026-04-25: filed when the smoke test caught a 201 → 404
  inconsistency on a fresh production submit.

## TD-052: Mobile branding (icon, splash, color scheme)

Discovered: 2026-04-25 (Phase 3.4 Part 2 — first APK build skips
    branding to keep scope tight on the smoke test)
Type: design / polish
Priority: P2
Status: open
Trigger: before any external user (beta program / Play Store
    listing) sees the app.

### Description

Phase 3.4 first build deliberately skips icon + splash assets:
the `apps/mobile/` workspace has no `assets/` directory and the
`app.json` does not reference `icon` or `splash.image`. Expo
provides defaults (the Expo logo on launch, a generic app icon)
which is functional for smoke-testing the runtime path but not
appropriate for any user-facing distribution.

### Risk if unaddressed

- Default Expo branding visible on the launcher and the splash
  screen — confusing for non-developer users.
- No visual identity for the project; recognisability suffers
  when multiple Operator-OS-related artifacts (TestFlight
  builds, Play Store listing, marketing site) need consistent
  branding.

### Proposed fix

1. **Icon** — 1024×1024 PNG, `apps/mobile/assets/icon.png`.
   Reference in `app.json` → `expo.icon`. Expo auto-generates
   adaptive icon variants for Android.
2. **Adaptive icon (Android)** — 1024×1024 foreground PNG plus a
   solid background colour. Reference under
   `expo.android.adaptiveIcon.foregroundImage` and
   `backgroundColor`.
3. **Splash image** — 1242×2436 PNG (or the size Expo
   recommends), `apps/mobile/assets/splash.png`. Reference under
   `expo.splash.image`.
4. **Color scheme** — pick a primary palette consistent with
   `apps/mobile/src/theme/tokens.ts` (already has `colors.copperDeep`,
   `colors.canvas`, `colors.ink`). Apply to splash background and
   adaptive icon background.

### Stale close condition

Branding assets exist, are referenced from `app.json`, and pass
the next EAS build with no asset warnings.

### Related

- ADR *Mobile Auth For First APK Build — Real Google Sign-In
  (Phase 3.4)* — splash skip is a deliberate scope choice
  documented there.
- `apps/mobile/src/theme/tokens.ts` — existing colour palette to
  build the visual identity around.

### History

- 2026-04-25: filed alongside Phase 3.4 first APK build to
  document the deliberate scope skip.

## TD-053: Production OAuth client separate from dev-named client

Discovered: 2026-04-25 (Phase 3.4 Gate 1 — reuses the existing
    `operator-os-dev-identity-web` OAuth client for the first
    APK to avoid Console click-through cost; not the right
    name for production)
Type: ops / hygiene
Priority: P3
Status: open
Trigger: when Operator-OS leaves the dev/test phase — typically
    when (a) a new GCP project for prod (`operator-os-prod`?)
    is provisioned, OR (b) a Play Store listing is being
    prepared, OR (c) external beta users start.

### Description

Phase 3.4's first APK uses the OAuth Web Client ID
`1016254604177-rgvmifpm5sjr009nie8ga9psnoap69pg.apps.googleusercontent.com`
which is the existing client named
`operator-os-dev-identity-web` in the `operator-os-dev` project.
Functionally fine — it's a valid OAuth client and the gateway
already accepts it via `AUTH_ACCEPTED_GOOGLE_CLIENT_IDS`. But:

- The name `operator-os-dev-identity-web` carries the "-dev"
  suffix that we don't want surfacing in any production-side
  log or screen.
- The OAuth Consent Screen for that client is currently in
  "Testing" mode with a fixed test-user allowlist (Akmal's
  three Google accounts). Real users outside that allowlist
  would be blocked.
- Mixing a single OAuth client across dev / preview / production
  builds means revoking it on a security incident takes the dev
  flow down with it.

### Risk if unaddressed

- Beta users / first real users may hit the "test users only"
  Consent Screen barrier.
- Splitting OAuth clients later requires re-issuing existing
  builds, re-registering SHA-1s, and updating gateway env vars
  — a coordinated migration that's cheaper to do once early
  than later.

### Proposed fix

When the trigger condition fires:

1. In `operator-os-prod` (or whichever project hosts production):
   - Configure OAuth Consent Screen → publishing status "In
     production" (requires Google verification for some scopes;
     for our usage `openid profile email` is auto-approved).
   - Create a new OAuth Web Client ID named
     `operator-os-prod-identity-web`.
   - Create matching Android Client(s) for each release-signing
     SHA-1.
2. Add the new Web Client ID to the production gateway's
   `AUTH_ACCEPTED_GOOGLE_CLIENT_IDS` (CSV append).
3. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the new ID for the
   `production` build profile in `apps/mobile/eas.json`.
4. Keep the old dev client around for the dev / preview build
   profiles.

### Stale close condition

When the prod-named client lands AND the production build
profile uses it AND no production-bound build references the
dev-named client.

### Related

- ADR *Mobile Auth For First APK Build — Real Google Sign-In
  (Phase 3.4)* — explicitly chose to reuse the existing dev
  client for the first APK.
- TD-045 / PR #36 (dev mint endpoint) — alternative auth
  bypass; will likely stay around for smoke tests indefinitely.

### History

- 2026-04-25: filed alongside Phase 3.4 first APK to flag the
  dev-named client as a future cleanup item.

## TD-054: Mobile SSE consumer crashes on Response.body.getReader()

Discovered: 2026-04-25 (Phase 3.4 R23 end-to-end smoke test —
    mobile-submitted task `3e4482ad-c790-4137-9ed8-b573fc4b10b5`
    completed agent-side, but the streaming-output screen
    rendered the runtime error
    "Cannot read property 'getReader' of undefined")
Type: dependency / runtime crash
Priority: P1
Status: closed
Trigger: P1 — blocks the mobile streaming display; backend pipe
    is fully proven so this is the only mobile-side gap left
    before the manual smoke is fully green.

### Description

Phase 3.3 c14 picked `@microsoft/fetch-event-source ^2.0.1`
(see TD-043). The library is correct on web + Node but
internally calls `response.body.getReader()` on the `Response`
returned by the host's `fetch`. React Native's built-in
`fetch` (Hermes / iOS / Android) does NOT expose `Response.body`
as a `ReadableStream` — `body` is `undefined`. The first SSE
delta therefore throws inside the library, the catch surfaces
the error to the screen as a literal string, and no further
deltas render.

Repro is fully deterministic:

1. Backend confirmed working (curl-based: api SSE returns
   `delta`, `status`, `completed` events with correct payload).
2. Mobile POST /v1/tasks succeeds (taskId returned).
3. Mobile UI navigates to streaming-output screen.
4. SSE consumer crashes immediately with the getReader error.
5. Desktop agent processes the same task ID and logs
   `task settled / closeReason: completed`.

This is the same dep as TD-043 but TD-043 was an "audit-later"
hygiene item; TD-054 is the active runtime crash and supersedes
it for severity / urgency. TD-043 should close once TD-054
resolves (the dep gets removed, not just audited).

### Risk if unaddressed

- Phase 3.4 mobile smoke cannot fully close — the streaming
  output is the user-visible payoff of the whole pipeline.
- Any user who submits a task sees a raw JS error string and
  no agent reply. Looks broken even though the backend ran.
- Deferring further means later phases pile new mobile work
  on top of a known-broken streaming layer.

### Proposed fix

Swap `D:/operator-os-mobapp/src/services/sse-client.ts` from
`@microsoft/fetch-event-source` to `react-native-sse`
(native `EventSource` for RN, supports custom Authorization
headers, ~30 KB, MIT, well-maintained).

1. `npm install react-native-sse`.
2. Rewrite `sse-client.ts` keeping the exported
   `connectSse(options: SseClientOptions): SseConnection`
   contract byte-for-byte identical (every screen depends on
   the existing onMessage / onUnauthorized / onClose / onError /
   lastEventId shape).
3. Map react-native-sse events to the existing CloseReason
   union (`'server-end' | 'reauth-needed' | 'fatal' | 'aborted'`).
4. Update `sse-client.test.ts` — react-native-sse doesn't take
   a fetch override, so swap the test seam to a fake
   `EventSource` ctor injection. Keep coverage of: 401 →
   onUnauthorized=true → reauth-needed; 401 → onUnauthorized=false
   → fatal; clean server-end; client-aborted; lastEventId
   resume header.
5. `npm uninstall @microsoft/fetch-event-source`.
6. `npm run typecheck && npm test` (both must pass).
7. Trigger `eas build --platform android --profile preview`,
   `adb install -r` the resulting APK, run the manual smoke
   from the Tasks tab.

Estimated: 1-2 hours.

### Stale close condition

Streaming-output screen renders the agent reply correctly for
a real task, AND `@microsoft/fetch-event-source` is gone from
`package.json`. TD-043 closes alongside.

### Related

- TD-043 (the broader "audit-eventually" parent — supersedes).
- ADR *Mobile-To-Api Streaming — SSE* (Phase 3.3) —
  Consequences section flags the underlying RN limitation.
- Phase 3.4.1 carve-out (this TD is the carve-out).

### History

- 2026-04-25: filed at Phase 3.4 close after end-to-end smoke
  exposed the runtime crash.
- 2026-04-27: closed by `BusyaPrime/operator-os-mobapp@0708760`
  (`fix(sse): swap to react-native-sse from
  @microsoft/fetch-event-source`). 118/118 mobile tests pass on
  main. Mobile UI streams the agent reply end-to-end; the
  parent TD-043 ("audit @microsoft/fetch-event-source eventually")
  also closes since the dep is gone.

## TD-055: Rotate `ANTHROPIC_API_KEY` (transcript leak)

Discovered: 2026-04-25 (Phase 3.4 — the original API key
    `sk-ant-api03-wS5l9...` was pasted into a chat transcript
    by the user during smoke-test setup; the key is in the
    conversation log by definition)
Type: security / secrets-hygiene
Priority: P0
Status: open
Trigger: rotate before the next agent run that consumes the
    Anthropic API. The current key (`...AAA` suffix) was
    deployed for the Phase 3.4 smoke and is otherwise
    unrotated.

### Description

Per the global secrets-hygiene rule (note once, rotate, never
re-lecture), an API key that appears in any human-readable
transcript is compromised by definition — even if the
transcript stays private, it has crossed enough trust
boundaries that the assumption of secrecy no longer holds.
Akmal acknowledged the leak, generated a replacement key
(`sk-ant-api03-MLmsl...`, suffix `...AAA`), and verified it
works (`claude --bare -p "Say hi in 3 words"` returned
"Hi there, friend!"). The rotation of the leaked key was
deferred to "after smoke test"; smoke is now done.

### Risk if unaddressed

- The leaked key still exists on the Anthropic account and
  could be used by anyone with transcript access until it is
  explicitly deleted.
- The current desktop-agent `.env` carries the replacement
  key, which has NOT itself been pasted in any transcript —
  but a single misuse (a future paste, log dump, or screen
  share) would put us back here. Treating "rotate after
  every leak" as a habit is cheaper than tracking which key
  is which.

### Proposed fix

1. https://console.anthropic.com/settings/keys
2. Locate the leaked key (the `wS5l9` prefix one) and delete it.
3. (Optional but recommended) rotate the replacement key too,
   for clean state. Generate a new one, update
   `D:/Operator-OS-Dev/apps/desktop-agent/.env`, delete the
   replacement. End-state: exactly one current key, never
   shared.
4. Confirm `claude` CLI still works (`claude --bare -p "Say
   ok"` returns a sensible reply).

Estimated: 5 minutes.

### Stale close condition

The leaked key is removed from the Anthropic console AND a
fresh post-rotation key is in the agent `.env`.

### Related

- Global rule: secrets-hygiene (`note once, rotate, never
  re-lecture`).
- Phase 3.4 smoke-test transcript (the original leak event).

### History

- 2026-04-25: filed at Phase 3.4 close; the leaked key has
  not yet been deleted from the Anthropic console.

## TD-056: `/v1/agent/heartbeat` and `/v1/agent/commands` reject operator JWT

Discovered: 2026-04-25 (Phase 3.4 R23 — running the desktop
    agent with the operator HS256 JWT as
    `CONTROL_CHANNEL_TOKEN` produced a clean WS handshake and
    correct task execution, but the REST heartbeat and command-
    poll loops returned 401 on every tick)
Type: server / auth-policy
Priority: P3
Status: open
Trigger: nice-to-have — does not block any production path.
    Worth tackling when the agent's REST surface gets revisited
    (heartbeat-v3 or persistent command consumer landing).

### Description

`apps/api/src/integrations/auth.ts` exposes three Fastify
guards:

- `createOptionalGuard()` — accepts Firebase ID tokens only
  (used by `/v1/auth/session`, `/v1/operator/dashboard`).
- `createRequiredGuard()` — Firebase ID OR operator HS256
  access token (no Google OIDC).
- `createAgentGuard(audience)` — Firebase ID OR operator HS256
  OR Google OIDC ID token for the service URL.

The agent REST loops (`/v1/agent/heartbeat`, both shapes, and
`/v1/agent/commands`) all use `createAgentGuard(...)` per
`apps/api/src/app.ts:203,205`. So in theory an operator HS256
JWT should be accepted. In practice, with the operator JWT
the agent log shows:

    Agent request failed with status 401
    path: /v1/agent/heartbeat
    path: /v1/agent/commands

Either:

(a) the routes are wired to a different guard than agentGuard
    (mis-routing) and Phase 3.4 read the wrong file path; or
(b) the operator-access-token verifier rejects JWTs whose
    `aud` claim is `operator-os-api` but the audience check
    inside `OperatorAccessTokenVerifier.verify()` expects
    something else; or
(c) the agent's `DesktopApiClient` sends the token with a
    different `Authorization` casing / format than the WS
    handshake (less likely — both go through the same
    `Bearer ` template).

Phase 3.4 does not block on this because the WS path —
which is the only one task execution actually depends on —
accepts the same operator JWT cleanly (`control channel
welcomed sessionId 28d42751-…`). The REST 401 noise does not
prevent task assign / progress / completed / failed frames.

### Risk if unaddressed

- Heartbeat data does not reach the api when the agent is
  running on an operator JWT — observability gap for a single-
  user dev posture. Production runs the agent under a Google
  service identity (see TD-047), so this is dev-only noise.
- Future engineers debugging the agent's 401 logs may waste
  time on what is a known compatibility quirk rather than a
  real bug.

### Proposed fix

1. Read `apps/api/src/routes/agent.ts` carefully — confirm
   the heartbeat and commands routes use `routeOptions.preHandler`
   and `routeOptions` actually maps to `agentGuard` (sanity
   check; Phase 3.4 saw `agentGuard` registered in app.ts but
   did not chase the indirection to ground).
2. Add a unit test in `apps/api/src/routes/__tests__/agent.test.ts`
   that POSTs `/v1/agent/heartbeat` with a synthetic operator
   HS256 token and asserts 200, mirroring the working WS test.
3. If the test reproduces the 401, fix the guard wiring or
   the verifier's audience check so operator JWTs work
   uniformly across WS + REST.
4. If the test passes (i.e. Phase 3.4 saw a transient or env
   issue), close TD-056 with "stale on first review" and a
   short note in the History section.

Estimated: 1 hour (most of it in the routing audit).

### Stale close condition

A unit test demonstrates that operator HS256 JWTs round-trip
cleanly through `/v1/agent/heartbeat` AND `/v1/agent/commands`
in the same way they already work on `/v1/agent/ws`.

### Related

- TD-047 (audit IAM bindings for the api + agent surfaces).
- Phase 3.4 R23 closure report — the 401 noise was filed there
  as a non-blocking observation.

### History

- 2026-04-25: filed at Phase 3.4 close; observed in the
  desktop agent log during the end-to-end smoke. WS path
  works fine with the same JWT.

## TD-057: BigQuery audit pipeline for `agent_auth` events

Discovered: 2026-04-27 (Phase 4.0 Part 3 scoping — the ADR-025
    audit story specifies a BigQuery dataset
    `operator_os_dev_audit.agent_auth` that does not exist yet)
Type: ops / observability
Priority: P1
Status: open
Owner: Akmal Khujdarov
Target phase: Phase 4.0 (must close BEFORE Phase 4.0 closure
    per hard-mode condition — audit logs are a verification
    requirement)

### Description

ADR-025 D1 specifies that every agent auth event (login attempt,
login success, token rotation, revocation, anomaly) lands in a
BigQuery table for forensic queries and Cloud Monitoring
anomaly detection (geo-jumps, frequency spikes, etc.).

Phase 4.0 Part 3 ships the api-side audit emit interface
(`AuditWriter` with `record(event: AgentAuthEvent): Promise<void>`)
backed by a `LoggingAuditWriter` stub that writes structured
pino logs only. Phase 4.0 closure cannot complete without the
real BigQuery writer because we need to verify forensic queries
work end-to-end against real data — a stub log doesn't satisfy
the verification gate.

### Risk if unaddressed

- ADR-025 verification gate fails — no forensic trail for the
  first phishing or stolen-laptop incident, despite the design
  promising one.
- Cloud Monitoring anomaly alerts can't fire (no data source).
- Phase 4.0 closure report would carry an asterisk (auth shipped,
  audit deferred) — bad pattern at "production-grade" promise
  level.

### Acceptance criteria

1. Dataset `operator_os_dev_audit` exists in BigQuery,
   region matches the api's home region (`europe-west4`).
2. Table `agent_auth` exists with the columns specified in
   ADR-025 D1 audit section (timestamp, agent_id, event_type,
   ip, user_agent, success, latency_ms, error_code,
   metadata).
3. The api's runtime service account has
   `roles/bigquery.dataEditor` on the dataset (least
   privilege — write-only against this one dataset, not
   project-wide).
4. New `BigQueryAuditWriter` implementation in
   `apps/api/src/integrations/audit-log.ts` plugs into the
   `AuditWriter` interface that Part 3 ships. Default
   factory selection moves from `LoggingAuditWriter` to
   `BigQueryAuditWriter` when env var
   `AGENT_AUDIT_BACKEND=bigquery` is present.
5. Sample query in `docs/AGENT_AUDIT_QUERIES.md` confirms
   the write path produced data: e.g. "auth events for agent
   X in the last hour" returns the last test event.
6. Integration test using the `@google-cloud/bigquery` SDK's
   in-memory mock asserts the row shape matches the schema.

### Dependencies

- GCP project `operator-os-dev` (existing).
- IAM: ability to grant the api's runtime SA dataEditor on
  the new dataset.

### Estimated effort

- Dataset + table provisioning: 15 min via `bq mk`.
- IAM grant: 5 min.
- BigQueryAuditWriter implementation: 1 hour.
- Schema validation test + sample query doc: 30 min.
- Total: ~2 hours.

### Stale close condition

End-to-end test in Phase 4.0 Part 9 verifies that an auth
event triggered from the agent appears in
`operator_os_dev_audit.agent_auth` within 60 seconds, and a
sample forensic query (e.g. "find all 401s for agent X in the
last 24h") returns the expected rows.

### Related

- ADR-025 D1 (the audit requirement).
- Phase 4.0 Part 3 (the LoggingAuditWriter stub this TD
  replaces).

### History

- 2026-04-27: filed at Phase 4.0 Part 3 scoping.

## TD-058: Pub/Sub topic for `agent-status-changes` real-time mobile fan-out

Discovered: 2026-04-27 (Phase 4.0 Part 3 scoping — ADR-025 D2
    specifies a Pub/Sub topic the api publishes to and the
    mobile subscribes via SSE; the topic does not exist yet)
Type: ops / messaging infrastructure
Priority: P1
Status: open
Owner: Akmal Khujdarov
Target phase: Phase 4.0 (must close BEFORE Part 7 mobile UI
    work per hard-mode condition — the mobile real-time
    indicator depends on this topic)

### Description

ADR-025 D2 specifies that agent state transitions (online,
offline, degraded) publish to a Pub/Sub topic
`agent-status-changes` so the mobile app can subscribe via
SSE for sub-second status updates instead of polling
`GET /v1/agent/list` every 30 seconds.

Phase 4.0 Part 3 ships the api-side publish interface
(`AgentStatusEmitter` with
`emit(event: AgentStatusEvent): Promise<void>`) backed by a
`NoOpStatusEmitter` stub that writes a pino log only.
Mobile UI in Part 7 needs the real publisher to deliver the
"green dot updates within 1s" UX promise.

### Risk if unaddressed

- Mobile UI degrades to 30s polling for status — same as
  Phase 3 baseline. The "Always-On" UX promise of Phase 4.0
  doesn't land.
- The "agent went offline" alert path the user expects is
  delayed by up to 30s, plus device polling jitter.

### Acceptance criteria

1. Pub/Sub topic `agent-status-changes` exists in
   `operator-os-dev`.
2. Subscription `agent-status-changes-sse` (push delivery
   to the api's `/v1/internal/agent-status` endpoint OR
   pull-mode for the mobile-fanout SSE handler — design
   choice deferred to TD execution).
3. The api's runtime SA has `roles/pubsub.publisher` on
   the topic. The mobile-fanout component (a new SSE route
   on the api) has subscriber on the subscription.
4. New `PubSubStatusEmitter` plugs into the
   `AgentStatusEmitter` interface Part 3 ships.
5. New SSE route `GET /v1/agent/status-stream` (auth: user
   JWT) consumes the subscription and fans the events out
   to subscribed mobile clients per user.
6. Mobile-side store wires up the SSE consumer behind a
   feature flag; the polling path stays as the fallback
   when the SSE drops or the device is on a network that
   blocks long-lived connections.

### Dependencies

- GCP project `operator-os-dev` Pub/Sub API enabled (already
  is, per existing topics for tasks).
- IAM grants per acceptance criterion #3.

### Estimated effort

- Topic + subscription provisioning: 15 min.
- IAM grants: 10 min.
- PubSubStatusEmitter implementation: 1 hour.
- SSE fanout route: 1.5 hours.
- Mobile SSE consumer (Part 7 sub-task that depends on this
  TD): 1.5 hours.
- Total: ~4 hours, of which ~2 hours is server-side
  prerequisite for Part 7 mobile work.

### Stale close condition

Mobile UI shows an agent state change within 1 second of the
api processing the WS connect/disconnect event, observed in
a manual test where the agent is force-killed and the mobile
green dot flips to red within the SLO.

### Related

- ADR-025 D2 (the real-time fan-out requirement).
- Phase 4.0 Part 3 (the NoOpStatusEmitter stub this TD
  replaces).
- Phase 4.0 Part 7 (the mobile UI that depends on this).

### History

- 2026-04-27: filed at Phase 4.0 Part 3 scoping.

## TD-059: Signed self-update pipeline for the desktop agent

Discovered: 2026-04-27 (Phase 4.0 Part 3 scoping — ADR-025 D3
    specifies a signed self-update mechanism with Ed25519
    signature verification + post-swap health check + rollback;
    no signing key, no release pipeline, no artifact store
    exists yet)
Type: ops / release engineering
Priority: P2
Status: open
Owner: Akmal Khujdarov
Target phase: Phase 4.0.1 (can defer past Phase 4.0 closure
    per hard-mode classification — the gap is documented;
    Phase 4.0 ships with the route stubbed and the
    update-check loop disabled)

### Description

ADR-025 D3 specifies a self-update pipeline that:

- Generates a signed agent binary on each release
  (Ed25519 signature, private half offline).
- Bundles the public key in the agent itself.
- Has the agent fetch `GET /v1/agent/latest-version` daily.
- Downloads the new binary if a newer version is reported,
  verifies the signature, swaps, runs a health check, and
  rolls back on failure.

This is a multi-faceted release-engineering deliverable that
spans build infra, signing key management, artefact storage,
and the agent's update loop. Phase 4.0 Part 3 ships only the
api-side route stub:

```
GET /v1/agent/latest-version
=> {
  "version": "<current api version>",
  "downloadUrl": null,
  "signature": null,
  "releaseNotes": "Phase 4.0 ships with self-update disabled.
    See TD-059."
}
```

The agent's update loop (Phase 4.0 Part 6 wrapper script) is
gated on a non-null `downloadUrl`; with the stub returning
null, the loop is a no-op.

### Risk if unaddressed

- Agents in the field stay on the version they were
  installed at. New versions require manual re-install
  (re-run the install script on each machine).
- For the user's current single-machine posture this is
  acceptable. For any future multi-machine deploy, the
  manual update churn would be a real friction point.

### Acceptance criteria

1. Ed25519 keypair generated. Private key stored on Akmal's
   machine (encrypted backup); public key bundled in the
   agent source at `apps/desktop-agent/src/keys/update-public.pem`.
2. Release script `scripts/release-agent.sh` builds the
   agent's `dist/`, archives it, signs the archive with the
   private key, uploads the archive + signature to a GCS
   bucket `operator-os-agent-releases` with object versioning
   enabled.
3. `GET /v1/agent/latest-version` reads the bucket's
   "latest" pointer and returns the actual download URL +
   signature.
4. Agent's update loop verifies the signature against the
   bundled public key before swap.
5. Post-swap health check: agent process must respond 200
   to a localhost `/internal/health` (new port, new endpoint
   the agent exposes for self-test) within 30 seconds.
   Failure triggers automatic rollback to the previous
   binary.
6. End-to-end test on Akmal's machine: bump the release,
   verify the agent updates within 24h, runs health check,
   continues serving tasks across the version transition.

### Dependencies

- GCS bucket creation + IAM (the api's runtime SA needs
  `roles/storage.objectViewer` to read the latest pointer;
  the release script SA needs `roles/storage.objectAdmin`).
- Ed25519 tooling (`openssl` or `node:crypto.sign`).

### Estimated effort

- Keygen + key management policy doc: 30 min.
- Release script: 2 hours.
- Update-check loop in agent + signature verify + rollback:
  4 hours.
- End-to-end test: 1 hour.
- Total: ~7-8 hours (significant lift; justified deferral
  past Phase 4.0 closure).

### Stale close condition

A release is published; agents in the field auto-update
within 24h; the post-swap health check catches at least one
deliberately-bad release in a deployment dry-run; the
rollback works.

### Related

- ADR-025 D3 (the self-update spec).
- Phase 4.0 Part 3 stub: `GET /v1/agent/latest-version`.
- Phase 4.0 Part 6 stub: agent wrapper script's update-check
  step is a no-op until this TD lands.

### History

- 2026-04-27: filed at Phase 4.0 Part 3 scoping; deferral
  past Phase 4.0 closure approved by Akmal under hard-mode
  TD priority classification.

## TD-066: WS auth integration gap not surfaced by tests

Discovered: 2026-05-04 (Phase 4.0 Part 9 T1.4 — first real
    WS upgrade attempt against the deployed backend)
Type: process / test-strategy
Priority: P2 (process gap; functional fix lands separately
    via the WS-auth-fix hotfix PR)
Phase: post-Phase-4.0 audit follow-up
Status: open

### Description

Phase 4.0 Part 3 added `agentTokenGuard` middleware (validates
the per-machine opaque token via bcrypt + LRU cache) and wired
it into every new REST route under `/v1/agent/*`
(register / list / status / rotate-token / revoke). The WS
upgrade route at `/v1/agent/ws` is registered separately via
`registerAgentWsRoute` in `apps/api/src/app.ts` and was missed
in the wiring pass — it kept using the legacy Phase 3
`createAgentGuard` (validates user JWT / Firebase ID / Google
OIDC).

Result: the Phase 4.0 desktop agent registered correctly,
DPAPI-stored its opaque token correctly, attempted the WS
upgrade with `Authorization: Bearer <opaque-token>`, and got
401 — because the legacy guard tried to verify the opaque
token as a JWT.

### Why this slipped through

1. The Part 3.H integration test mounted the full `buildServer`
   but only exercised REST paths.
2. The WS-route unit tests injected their own `agentGuard`
   fake, bypassing the production wiring.
3. There was no "the WS upgrade rejects a Phase 3 JWT and
   accepts a Phase 4 opaque token" test pinning the wiring
   contract.
4. Code review on PR #38 didn't flag the asymmetry between
   how REST and WS routes consume their guards.

### Action items

1. Add a wiring-level integration test that mounts the full
   `buildServer` and exercises a WS upgrade with both an
   opaque token (must accept) and a stale Phase 3 JWT (must
   reject). Lives alongside `agent-registration.integration.test.ts`.
2. Audit every other Phase boundary for the same pattern
   ("middleware exists, wired into route subset, missed
   adjacent route"). Document findings.
3. Update the test-strategy doc with a "wiring contract"
   section: every middleware that exists must have at
   least one full-stack integration test pinning it to its
   intended routes.
4. Consider a periodic `grep` audit script in CI: every
   route file whose handlers reference `request.agent` (or
   `request.authSession`) must have a corresponding
   integration test. Tooling-level enforcement is the
   sustainable fix.

### Stale close condition

The four action items land + the audit produces no further
similar gaps + the wiring-contract section is in
`docs/TESTING.md` (or equivalent).

### Related

- ADR-025 amendment 5 (the WS auth wiring fix this TD
  triages).
- Part 9 T1.4 (where this surfaced).
- TD-067 (the elevation issue surfaced in the same
  Part 9 stretch — different defect class, separately
  filed).

### History

- 2026-05-04: Filed at Phase 4.0 Part 9 T1.4 surfacing.

## TD-067: Part 6 install requires elevation on locked-down Windows

Discovered: 2026-05-04 (Phase 4.0 Part 9 T1.2 — first real
    Scheduled Task install attempt on the dev machine)
Type: agent / install-script user experience
Priority: P1 (visible to every desktop-agent installer on
    a locked-down Windows account; blocks autostart)
Phase: Phase 4.0.1
Status: open

### Description

`scripts/install-agent-autostart.ps1` calls `schtasks /Create
/XML` to register the OperatorOS Agent Scheduled Task. The
XML uses `LogonType = InteractiveToken` and
`RunLevel = LeastPrivilege` per ADR-025 D3, so the resulting
task runs as the user (not SYSTEM) at user logon — no admin
needed at runtime.

But the `/Create` operation itself fails with HRESULT
0x80070005 (Access Denied) on accounts where the local
security policy denies non-admin users the right to create
scheduled tasks at all. `Register-ScheduledTask` (the modern
PowerShell cmdlet path) hits the same wall — the underlying
Task Scheduler 2.0 COM API enforces the same access check.

Empirically observed on the Akmal dev account on Windows 11
with default settings. Other accounts on the same machine
may behave differently depending on group-policy / local
policy configuration.

### Mitigations available

The Phase 4.0 Part 6 patch (commit abe0aab on PR #43) added
a `<UserId>` element to the Principal block. That fixes a
related-but-distinct schtasks-XML rejection mode. It does NOT
fix the broader "user can't create tasks at all" wall —
that's this TD.

Options for the fix:

1. **Detect-and-elevate** — the install script probes its
   privilege state at start, and if task-creation rights
   are absent, re-launches itself elevated via
   `Start-Process -Verb RunAs`. UAC prompt is shown; user
   consents once per install. The elevated child process
   completes the task creation; the parent exits.

2. **Document admin-run requirement** — `docs/AGENT_SETUP.md`
   gets a clear "if step 2 fails with Access Denied, right-
   click PowerShell → Run as Administrator and re-run".
   Lower-effort fix, but every user hits the wall once.

3. **Startup folder fallback** — if `schtasks` fails, the
   script falls back to dropping a shortcut into
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`
   that triggers `start-agent.ps1` at logon. Doesn't get
   `RestartOnFailure` semantics; pure best-effort.

Recommended: option 1 + 2 as the primary path. Fall-back to
Startup folder is a stretch goal — its semantics differ
enough from the Scheduled Task that mixing them in one
install script adds more confusion than value.

### Estimated effort

- Detect-and-elevate logic: 30 min.
- Documentation update: 15 min.
- Manual smoke test: 30 min (need at least two test
  accounts — admin and non-admin — to exercise both paths).
- Total: ~1.5 hours.

### Stale close condition

A fresh non-admin Windows install runs through the install
flow, gets the UAC prompt, accepts, and ends up with a
running OperatorOS Agent Scheduled Task. Plus the AGENT_SETUP
doc reflects the actual user-facing flow.

### Related

- Phase 4.0 Part 6 (the install script that needs the fix).
- ADR-025 D3 amendment 4 (sets the design constraints —
  LeastPrivilege, no admin at runtime).
- Part 9 T1.2 (where this surfaced).
- TD-066 (the WS auth gap surfaced in the same Part 9
  stretch; different defect class).

### History

- 2026-05-04: Filed at Phase 4.0 Part 9 T1.2 surfacing.
  Workaround for the Part 9 verification: run agent
  directly via `node dist/main.js` (bypasses the autostart
  layer entirely; the WS-connection path is what Part 9
  actually validates).

## TD-068: markOnline / markOffline never invoked from WS lifecycle

Discovered: 2026-05-09 (Phase 4.0 Part 9 T1.4 verification of
    PR #44 — first real WS welcome against fixed backend)
Type: api / Phase 4.0 closure blocker
Priority: P1 (blocks Part 7 mobile agent-status UX +
    downstream TD-058 Pub/Sub fan-out)
Phase: Phase 4.0 closure
Status: open

### Description

`AgentRepository.markOnline()` and `markOffline()` are
defined on the interface (and implemented on
`FirestoreAgentRepository` per the per-method shape declared
during Part 3) but never invoked from the WS lifecycle.

Empirical grep against the deployed source:

```
grep -rn 'markOnline\|markOffline' \
    apps/api/src/routes/agent-ws.ts \
    apps/api/src/services/agent-session-registry.ts
# → zero matches
```

The WS welcome handler attaches the session to the in-memory
`agentSessionRegistry` but never propagates the state
transition to Firestore.

### Symptom (verified live, 2026-05-09 T1.4)

After PR #44 deployed at 100% traffic, the agent
`412eaea5-94b4-4777-ae45-d5d4bbb8074d` opened a real WS
session (`c37b30a6-baa0-4425-8c6b-3cbe3d27d689`, log
timestamp 1778321176272) and held it for 90+ seconds with
continuous emit observed. Throughout the session, the user-
JWT-protected status endpoint (`GET /v1/agent/:id/status`)
returned:

```json
{
  "agentId": "412eaea5-94b4-4777-ae45-d5d4bbb8074d",
  "onlineState": "offline",
  "lastHeartbeatAt": null,
  "lastConnectAt": null,
  "lastDisconnectAt": null,
  ...
}
```

The status projection reads from Firestore. Because the WS
handler never writes `lastConnectAt` / `lastHeartbeatAt`, the
Firestore record stays in its post-register-only state and
the projection reports the agent as offline regardless of
actual WS connectivity.

### Acceptance criteria

1. On WS welcome-frame ack: invoke
   `agentRepository.markOnline(agentId, { sessionId,
   connectedAt: now })`. Idempotent at the data layer
   (re-welcomes don't break the state).
2. On WS ping/pong: bump `lastHeartbeatAt` to the timestamp
   of the latest received pong (or sent ping — whichever the
   data model defines as "alive proof"). Throttled to one
   write per ~30s so a busy session doesn't flood Firestore.
3. On WS close (any close-code, any disconnect category):
   invoke `markOffline(agentId, { lastDisconnectAt: now,
   reason: closeCode + categoriser-output })`.
4. The status endpoint reflects actual WS state within 5
   seconds of any state transition (welcome / disconnect),
   subject to Firestore propagation latency.
5. Cross-instance state propagation is **out of scope** for
   this TD — that's TD-058's Pub/Sub fan-out, which depends
   on this TD's writes existing in the first place.

### Implementation sketch (not blocking on user direction)

The cleanest seam is to extend `agentSessionRegistry` (the
in-memory map already wired into the WS handler) with two
side effects on `register()` / `evict()`:

- After `register()` succeeds, call `markOnline` (fire-and-
  forget with a single pino warn on failure — never block
  the WS loop).
- After `evict()` (any reason), call `markOffline` similarly.

Heartbeat updates from ping/pong should land via a separate
throttled write — possibly a small per-agent debouncer in
the registry.

The agent record's repository interface already accepts
these methods; the wiring is the missing piece, not new
storage shape.

### Estimated effort

- Wire markOnline/markOffline into agentSessionRegistry: 30 min.
- Heartbeat throttled write: 30 min.
- Tests (pin the wiring contract per TD-066 prevention
  pattern): 30 min.
- Total: ~90 minutes.

### Stale close condition

The grep above returns non-zero matches in the WS path AND
a real WS session causes the status endpoint to flip to
`onlineState: "online"` within 5 seconds. Plus the four
acceptance criteria above each have a passing test.

### Related

- TD-058 (Pub/Sub `agent-status-changes` fan-out) — depends
  on this TD's writes existing. Without TD-068, TD-058 has
  nothing to fan out.
- TD-066 (test-strategy "wiring contract" gap) — the
  recurrence-prevention plan from TD-066 would have caught
  this gap at PR #38 review.
- ADR-025 D2 — the design statement that requires online
  state to derive from WS lifecycle.
- ADR-025 amendment 5 — fixed the WS auth wiring; this TD
  is the next-layer wiring gap exposed once auth started
  working.
- Part 9 T1.4 (where this surfaced — 2026-05-09).

### History

- 2026-05-09: filed at Phase 4.0 Part 9 T1.4 surfacing,
  immediately after PR #44 deploy made WS welcome reachable.
  Workaround for ongoing Part 9 testing: judge T-PASS on
  agent-side log evidence (sessionId in `control channel
  welcomed` line); status endpoint cannot be trusted as a
  Phase 4.0 health signal until this TD lands.

## TD-069: WS reconnect amplification — client-side self-perpetuating kick-loop

Discovered: 2026-05-09 (Phase 4.0 Part 9 T3 setup, ~30 min
    after PR #44 deployed at 100% traffic; surfaced by an
    8-agent Opus 4.7 parallel investigation reading the
    deployed Cloud Run logs and the dist binary)
Type: agent / Phase 4.0 functional blocker
Priority: P0 (Phase 4.0 cannot deliver value until this
    lands — no agent can sustain a WS session past 5 min
    today)
Phase: Phase 4.0 closure (must fix before declaring Phase
    4.0 functional)
Status: open

### Description

The desktop agent's `ControlChannelWs` has two compounding
leaks in its connection lifecycle. Together they produce a
self-perpetuating kick-loop that's indistinguishable from
"normal" Phase 5 reconnect behaviour to a casual log
observer (a fresh welcome arrives every 1.8 seconds), but
NO welcomed session survives long enough to do useful work.

### Two converging defects

**Defect A — `#connect()` doesn't close prior socket.**
`apps/desktop-agent/src/providers/control-channel-ws.ts`
around line 151-161:

```ts
#connect(): void {
  // ...
  const socket = factory(this.#opts.url, {...});
  this.#socket = socket;   // ← overwrites unconditionally
}
```

If `#connect()` is ever invoked while `this.#socket` is
still pointing at a prior socket (in-flight handshake,
race with reconnect timer, or any reason), the prior is
leaked and TWO concurrent WS connections from the same
process target the server with the same agentId.

**Defect B — close handler doesn't scope to active socket.**
Same file, lines 196-206:

```ts
socket.on('close', (code) => {
  this.#socket = undefined;
  this.#sessionId = undefined;
  if (!this.#shuttingDown) this.#scheduleReconnect();
});
```

The handler is attached on every socket the agent ever
created. It does NOT check whether the closing socket is
still `this.#socket`. So a STALE socket's close event:
- nukes `this.#socket` even though it now points at a
  newer, healthy socket
- triggers `#scheduleReconnect()` which makes ANOTHER
  connection on top of the still-alive newer one

### How the loop self-perpetuates

Once any single overlap event creates two concurrent
sockets:

1. Conn A welcomed (sessionId Sa registered in registry)
2. Conn B arrives at server → `register()` kicks A with
   close 4004 'duplicate-agent', registers Sb
3. A's 4004 close arrives at agent → A's close-handler
   fires → `#scheduleReconnect()` — ALSO nukes
   `this.#socket` even if it now points at B
4. ~1s later: Conn C arrives → kicks Sb, registers Sc
5. B's 4004 close → fires another reconnect → Conn D
6. Pattern locks at ~1.8s cycle forever

`#reconnectAttempt` is reset to 0 on every welcome
(line 244), so the exponential backoff never grows past
~1s — the loop is self-perpetuating AND tight.

### What initiates the first overlap (the trigger)

Verified by reality-checker agent reading both
`/tmp/agent-direct-fixed.log` (T1.4 evidence) and
`/tmp/agent-t3.log` (T3 evidence) end-to-end:

- T1.4 first welcome at 2026-05-09T10:06:13Z, session
  c37b30a6-... held for **5.04 minutes** (303.0 sec) before
  close code **1006** (TCP-level abnormal close, no close
  frame). Cloud Run idle-timeout signature.
- 5 more cycles, all ~5 min, all 1006.
- At min 30.685 of the log (after the 6th 1006), the FIRST
  4004 fires and the kick-loop begins. From that point
  forward, NO session lives more than 2.21 seconds.

Likely overlap-trigger: token-refresh-during-reconnect
(agent's local OAuth token logged `expiresInSeconds:
-1330656` = expired 15 days ago, refresh on every CLI
spawn) OR Cloud Run autoscaler routing producing a brief
two-instance window during the 5-min-cycle reconnect.

### Server-side context (NOT the bug)

8-agent fleet investigation confirmed the server's
`agentSessionRegistry` semantics are **correct as designed**:

- Per-instance in-memory map, single-source-of-truth per
  Cloud Run instance.
- "Newer register wins, kick prior with 4004" is the
  documented Phase 3.2 + ADR-025 contract.
- TD-058 (Pub/Sub fan-out) handles cross-instance state for
  MOBILE visibility, not for cross-instance registry
  coordination.
- ADR-025 sunset trigger for the per-instance registry is
  >1000 agents/instance. We're at 1 agent.

The bug is purely client-side. The server is doing exactly
what it was specified to do.

### Acceptance criteria (3 layers)

#### Client fix (primary, blocking) — defect A + B

```ts
// Defect A fix in #connect():
if (this.#socket !== undefined) {
  this.#socket.removeAllListeners();
  try { this.#socket.terminate(); } catch (_) { /* logged */ }
  this.#socket = undefined;
}
// then construct + assign new socket as before

// Defect B fix in the close handler:
const ownedSocket = socket; // capture at attach time
socket.on('close', (code) => {
  if (this.#socket !== ownedSocket) {
    // stale socket's close — ignore
    return;
  }
  this.#socket = undefined;
  this.#sessionId = undefined;
  if (!this.#shuttingDown) this.#scheduleReconnect();
});
```

#### Client fix (defense in depth)

- On `close(4004)` specifically: back off harder (5-10s
  base) before reconnecting. The current 1s base is what
  makes the loop tight.
- Wire the existing `ConnectionStateMachine` (Phase 4.0
  Part 5.A, source on `feat/phase-4.0-part-5-reconnection`
  branch) into `ControlChannelWs` so reconnect is gated
  on `state.canTransitionTo('CONNECTING')`.

#### Server-side defense (orthogonal, not strictly needed
once client fixed)

Per Threat Detection agent's Fix A: change registry
eviction policy from "newer wins" to "prior-alive wins":

```ts
// in agent-session-registry.ts register():
const priorIsAlive =
  prior.socket.readyState === prior.socket.OPEN &&
  Date.now() - Date.parse(prior.lastActivityAt) < pongTimeoutMs;
if (priorIsAlive) {
  return { kind: 'rejected', reason: 'duplicate-agent-prior-alive' };
}
// else evict prior, admit new
```

Combined with a new close code (e.g. 4009) so client can
distinguish "you got kicked because someone else showed
up" from "you got rejected because someone else is already
here" — and the agent backs off correspondingly.

#### Tests

- Add `agent-ws.test.ts` test that exercises overlap:
  open WS A, while A is open mid-handshake open WS B with
  same agentId, assert exactly one is welcomed and the
  other is rejected. This is the heisenbug the existing
  test suite explicitly avoided (line 218-228 acknowledges
  the avoidance).
- Add client-side test with a fake WS factory that can
  produce two parallel sockets and assert the second one
  isn't created without the first being closed.

### Estimated effort

- Client fix (defects A + B): 30 min code, 30 min tests.
- Defense in depth (state-machine wiring + 4004 backoff):
  60 min.
- Server-side eviction policy change: 60 min code + tests.
- Total: 3 hours for the full fix; 1 hour for the minimal
  client-only fix.

### Workaround for ongoing Part 9 testing

None. The kick-loop is permanent once triggered, and the
trigger fires within ~30 minutes of any agent process
start. T3 / T6 / T2 / T5 / T4 cannot be exercised against
the current build.

Phase 4.0 closure is BLOCKED on this TD.

### Stale close condition

A single agent process can hold one continuous WS session
for ≥ 30 minutes against the deployed backend with zero
4004 close events in its log, AND the existing
agent-ws.test.ts test suite has a passing test pinning
the overlap-rejection contract.

### Related

- ADR-025 D2 (the design statement; this TD doesn't
  violate it, just exposes a client implementation gap).
- Phase 4.0 Part 5.A (`ConnectionStateMachine`) — should
  have prevented this; needs to be wired into
  ControlChannelWs.
- TD-058 (Pub/Sub fan-out) — orthogonal; doesn't fix
  this.
- TD-066 (test-strategy wiring-contract gap) — the
  overlap test was explicitly avoided in
  agent-ws.test.ts:218-228 with a comment acknowledging
  the heisenbug. That comment is the contract that
  TD-066's process improvement would catch.
- TD-068 (markOnline wiring) — orthogonal; this TD's fix
  doesn't depend on or affect TD-068.
- PR #44 (the WS auth fix that surfaced this — by
  making the WS path actually carry real traffic for the
  first time, the client's overlap leak became
  observable).
- 8-agent Opus 4.7 parallel investigation, 2026-05-09
  (Backend Architect, Code Reviewer, SRE, silent-failure-
  hunter, Software Architect, Threat Detection Engineer,
  Reality Checker, general-purpose code-tracer).

### History

- 2026-05-09: filed after the 8-agent fleet investigation
  consolidated into a coherent root cause. Phase 4.0
  closure paused pending direction.

