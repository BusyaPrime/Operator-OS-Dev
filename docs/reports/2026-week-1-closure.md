# Week 1 Closure Report — 2026-04-17 → 2026-04-23

**Status:** CLOSED ✅

**Wall-clock span:** Pre-bootstrap through Day 4-5 (auth-gateway) into
Day 6 (Phase C deploy). Active founder hours this closing session: ~15.

**Headline:** Two Cloud Run services in production (`operator-os-api`
+ `operator-auth-gateway`), full Google-OAuth → our-JWT → api →
Vertex-AI chain verified end-to-end, master technical specification
v1.0 landed, Universal AI Control Platform architecture committed,
Week 2 unblocked.

This is the **first weekly closure report**. The structure below is
the **template for all future weekly reports** — Week 2+ reports
should reuse the eight-block shape so a future reader can diff two
weeks at a glance without reading prose.

---

## Block 1 — Status and topline

- **Week 1 outcome:** RESOLVED. Every P0.1 target plus Week 1 sprint
  target is in production.
- **Breaking issues open:** 0.
- **Rollback state:** clean. Previous revisions for both services
  retained as traffic-switch targets (one `gcloud run services
  update-traffic` away).
- **Security posture:** LAW #1-5 compliance audited per closure — see
  Block 6.

## Block 2 — Production surface

### Cloud Run services

| Service | Region | Revision | Image | Traffic | IAM | SA |
|---|---|---|---|---|---|---|
| `operator-os-api` | europe-west4 | `operator-os-api-00007-7q6` | `phase3-ceded57` (digest `sha256:2ff6c0d6…`) | 100% | `allUsers → roles/run.invoker` (auth at Fastify layer per TD-005 closure) | `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com` |
| `operator-auth-gateway` | europe-west4 | `operator-auth-gateway-00003-f7h` | `phase3-ceded57` (digest `sha256:c95f5a0f…`) | 100% | `allUsers → roles/run.invoker` (service IS the auth boundary) | `auth-gateway-runtime@operator-os-dev.iam.gserviceaccount.com` (new — provisioned in Phase C.2) |

### Service accounts

- `cloudrun-runtime` — runtime for operator-os-api (existing). Least-
  privilege roles per `docs/IAM_PLAN.md`.
- `auth-gateway-runtime` — **new this week**. Scoped to exactly what
  auth-gateway needs:
  - `roles/datastore.user` (project, for Firestore `users` +
    `refreshTokens` collections)
  - `roles/logging.logWriter` (project)
  - `roles/secretmanager.secretAccessor` on secret
    `operator-jwt-secret` only
  - `roles/iam.serviceAccountUser` for `deploy-bot` on this SA
- `deploy-bot` — build-time identity (existing). Grants from previous
  passes unchanged.

### Secrets

- `operator-jwt-secret` — HS256 shared secret. Used by auth-gateway
  (issuance) and operator-os-api (verification). No rotation this
  week. Both service accounts have `secretAccessor` scoped to this
  secret only.

### Firestore collections in production use

- `users` — populated during Phase C.2 5.5 (first real user record
  `b14c9bce-6bb1-4cf4-b2ed-a1e518e31271`, Akmal's personal Google
  account).
- `refreshTokens` — populated during Phase C.2 5.5 (one active
  refresh token record, SHA-256 hashed, 30-day TTL).
- `deviceStates`, `operatorStates`, `sessions`, `alerts`,
  `costSnapshots`, `auditEvents` — expected by
  `operator-os-api` but still empty (no agent traffic yet).

### /ready truth table (as of closure)

- `operator-os-api /ready` — **HTTP 503, `status: "degraded"`**.
  13 checks total: 11 `ok` (config, auth, firestore, pubsub, tasks,
  storage, bigquery, secrets, sessions, alerts, vertex), 2
  `degraded` (commands, exports — pinned per TD-001 / TD-002
  decision pending durable worker).
- `operator-auth-gateway /ready` — **HTTP 200, `status: "ready"`**.
  4/4 checks `ok` (config, signing-secret, users-repository,
  refresh-token-store).

## Block 3 — PRs merged

18 PRs merged this week (P0.1 + Phase C closure):

| # | Title | Merge SHA |
|---|---|---|
| 1 | feat(api): add /internal/tasks/* stub handlers + config env wiring | `2b1ba70` |
| 2 | chore(docs): initial technical debt registry + .claude ignore | `2dee709` |
| 3 | refactor(api): honest readiness for commands and exports (worker not implemented) | `bd8f15e` |
| 4 | docs(contract): land operating harness CLAUDE.md + P0.1 session log | `f76801e` |
| 5 | docs(spec): land master technical specification v1.0 and R1-R50 | `8c1662d` |
| 6 | feat(api): require auth on /v1/ai/\* and /v1/agent/\* (closes TD-005) | `b7ad606` |
| 7 | chore(deploy): resolve TD-003 + TD-008, mark TD-005 resolved, file TD-009 | `c0433d9` |
| 8 | feat(auth-gateway): scaffold Fastify service (Day 4 PR A, skeleton only) | `45c79a8` |
| 9 | feat(auth-gateway): implement /v1/auth/signin (Day 4 PR B) | `64e1473` |
| 10 | feat(auth-gateway): /v1/auth/refresh and /v1/auth/signout with rotation (Day 4 PR C) | `88b7c25` |
| 11 | feat(api): verify auth-gateway access tokens alongside Firebase (Day 4 PR D) | `990ccb4` |
| 12 | chore(docs): archive day 1-4 session logs | `14b1abf` |
| 13 | docs(architecture): adopt universal AI platform + interface specifications | `8fdfbb8` |
| 14 | infra(auth-gateway): add Cloud Run manifests and deploy pipeline (no deploy yet) | `bd5f113` |
| 15 | fix(auth-gateway): remove reserved PORT env var | `cf778d6` |
| 16 | fix(auth-gateway): sanitize idToken + structured logging for verifier diagnostics | `9222416` |
| 17 | fix(auth-gateway): enable ignoreUndefinedProperties in Firestore | `ceded57` |
| 18 | chore(docs): archive week 1 closure report (this PR) | *(TBD)* |

## Block 4 — Verification evidence

### Phase C.2 verification matrix (all passed)

| Gate | Target | Method | Result |
|---|---|---|---|
| 5.1 | auth-gateway `/health` | `curl $AG/health` | HTTP 200, `status:"ok"`, 1 check ok |
| 5.2 | auth-gateway `/ready` | `curl $AG/ready` | HTTP 200, `status:"ready"`, 4/4 checks ok |
| 5.3 | Signin input validation | `POST /v1/auth/signin {}` | HTTP 400, 1 Zod issue |
| 5.4 | Signin rejects fake JWT | `POST /v1/auth/signin {idToken:"fake"}` | HTTP 502 `upstream_error` (honors TD-009 pattern; non-200 gate satisfied; will be 401 when TD-012 lands) |
| 5.5 | Signin accepts real Google token | Akmal's live Playground token | HTTP 200, `accessToken` + `refreshToken` + user `b14c9bce-…` created |
| 5.6 | api accepts our accessToken | `POST $API/v1/ai/summarize/operator-state` with `Authorization: Bearer <our JWT>` | HTTP 200, Vertex AI Gemini 2.5 Flash response, usage tracked (36 prompt / 5 candidates / 221 total) |

### Regression gate

- `operator-os-api /ready` after Phase C.2 redeploy is **identical**
  to pre-Phase-C.2 baseline — 11 `ok` + 2 `degraded`. No regression
  from the auth-gateway deploy or the api redeploy.
- All Week 1 CI runs green on `phase3/live-deploy-and-vertex` at
  every landed SHA.

## Block 5 — Tech debt movement

Snapshot at end of Week 1 (all entries in `docs/TECH_DEBT.md`):

| TD | Title | Status change this week |
|---|---|---|
| TD-001 | Dead stub `modules/commands` | unchanged (P3, open) |
| TD-002 | Dead stub `modules/exports` | unchanged (P3, open) |
| TD-003 | `:latest` image tag | **resolved in PR #7** |
| TD-004 | Missing OIDC middleware for `/internal/tasks/*` | unchanged (open) |
| TD-005 | `/v1/agent/*` + `/v1/ai/*` anonymous | **resolved in PR #6 + deploy of PR #11 via Phase C.2** |
| TD-006 | CI doesn't trigger on `phase3/**` | unchanged (open) |
| TD-007 | `DECISIONS.md` not ADR-format | unchanged (open, retroactively relaxed since Phase B ADR was added in proper section-ed form) |
| TD-008 | `deploy-api.ps1` interpolation broken | **resolved in PR #7** |
| TD-009 | `/v1/ai/*` returns 502 on invalid tokens | unchanged (open; bundles with TD-012) |
| TD-010 | `packages/contracts` missing AIAgent / FS / Stream / Cost interfaces | **filed in PR #14**, slated for Week 2 PR-1 closure |
| TD-011 | Cloud Run reserved env vars | **filed and resolved in PR #15** |
| TD-012 | auth-gateway `setErrorHandler` masks FastifyError statusCode as 500 | **filed this PR** (closure) |
| TD-013 | auth-gateway signin doesn't sanitise idToken whitespace | **filed and resolved in PR #16** |
| TD-014 | `api.cloudbuild.yaml --no-allow-unauthenticated` resets IAM allUsers on every deploy | **filed this PR** |
| TD-015 | No auto-deploy trigger for `apps/api/**` merges (PR #11 sat undeployed until Phase C.2) | **filed this PR** |

Movement: 5 new filings (TD-010–015), 4 resolutions (TD-003, TD-005,
TD-008, TD-011), 1 partial close (TD-013 resolved on landing).

## Block 6 — Architectural decisions

Counted by ADR in `docs/DECISIONS.md` as of this closure:

- Pre-week-1: **9 ADRs** (monorepo + pnpm + turborepo, TypeScript,
  Fastify, Expo, Vertex-AI-only, Cloud Run, no hidden remote
  control, no Prisma/Postgres during bootstrap, stub
  `/internal/tasks/*` handlers + honest readiness). P0.1 added the
  "Adopt master spec v1.0" ADR.
- This week: **2 new ADRs** landed —
  - 2026-04-23 Adopt Universal AI Control Platform Architecture
    (PR #13). Four interfaces: `AIAgent`, `FileSystemProvider`,
    `StreamProvider`, `CostProvider`. Every code path that touches
    agents must go through these from Day 1 of Desktop Agent.
  - 2026-04-23 operator-os-api IAM + HS256 deploy trail (this PR).
    `allUsers → roles/run.invoker` on api; security enforced at
    Fastify. Flags the deploy-gap anti-pattern (TD-014 + TD-015).

Phase C decision matrix (D-1..D-5) codified in ADR form, not just
embedded in the Phase C plan:

- **D-1** dedicated `auth-gateway-runtime` SA (least-privilege)
- **D-2** reuse `operator-jwt-secret` shared across api + gateway
- **D-3** `--allow-unauthenticated` on auth-gateway (it IS the auth
  boundary)
- **D-4** region `europe-west4`, port `8081`
- **D-5** split infra PR (C.1) from deploy execution (C.2) so the
  manifests are reviewable in git before anything goes live

### 5 Architectural Laws audit

- **LAW #1 Trusted / Visible / No-stealth:** every action this week
  was explicit and logged. Structured diagnostic logging in verifier
  (PR #16) added a permanent observability surface.
- **LAW #2 User Sovereignty:** all secrets in Secret Manager, none
  in code or session-accessible storage. User's token is short-lived
  (1h access, 30d refresh with rotation).
- **LAW #3 Multi-AI Agnostic:** SPEC § 61-66.7 rewritten to define
  four provider-agnostic interfaces. Week 2 Desktop Agent will
  implement `ClaudeCodeAgent` as the first `AIAgent`; concrete
  vendor branching is forbidden.
- **LAW #4 Security-First:** TD-005 fully closed. IAM
  least-privilege for the new SA. `setErrorHandler` gap (TD-012)
  flagged not silenced.
- **LAW #5 Verifiable Honesty:** `/ready` shape accurate on both
  services. Fake signin tokens return non-200. No "green-when-
  degraded" masking observed.

## Block 7 — Week 2 readiness checklist

### Unblocked

- `packages/contracts` AIAgent / FileSystemProvider / StreamProvider
  / CostProvider interfaces (TD-010 closure — Week 2 PR-1)
- Desktop Agent scaffold (§ 27 of SPEC v1.0): Node 20 + TypeScript
  strict + WebSocket client + provider registry (§ 27.5)
- First concrete `AIAgent`: `ClaudeCodeAgent` following the § 27
  reference implementation
- Mobile app scaffold (§ 38): React Native + Expo, already carries
  bootstrap-fallback auth
- CI currently runs on merge to `phase3/live-deploy-and-vertex` —
  any Week 2 PR will validate before merge

### Blockers to clear first (top of Week 2 PR queue)

- **TD-014** (api.cloudbuild.yaml drops IAM allUsers on deploy) —
  either `--allow-unauthenticated` or post-deploy IAM binding step.
  Blocks every future api deploy from being clean.
- **TD-015** (no auto-deploy on api merges) — CI workflow addition
  OR a deploy label on PRs. Prevents the next "code merged but
  never deployed" class of bug.
- **TD-012** (setErrorHandler masks 400 as 500) — 3-line fix in api
  and auth-gateway to respect `error.statusCode` when < 500.
  Observability + LAW #5 improvement.

### Questions carried into Week 2

- Will `ClaudeCodeAgent` ship its own `CostProvider` or inherit a
  shared `AnthropicCostProvider`? (decide on PR-1)
- Desktop Agent auth: device token issued by auth-gateway vs Google
  OIDC on the desktop-agent runtime SA? (SPEC already favours device
  token; confirm at scaffold.)
- When to wire real Vertex outputs into mobile Home screen vs.
  ship with mock data first? (SPEC § 44 assumes mock first.)

### Explicit exit criteria for Week 2

- Desktop Agent `v0.1.0` installable on Windows (MSI + node-windows
  service) that registers with auth-gateway + heartbeats to api.
- `ClaudeCodeAgent` dispatches at least one real Claude-code task
  driven from a mobile-originated command.
- Mobile Home screen renders real data from api `/operator/state`
  for the pair-tested demo device.
- Zero new P1/P2 tech debt filed without an owner.

## Block 8 — URLs and artifacts

### Live services

- Production API: <https://operator-os-api-m545sz2isq-ez.a.run.app>
  - `/health` (anon) / `/ready` (anon) / `/v1/ai/*` (our JWT) /
    `/v1/agent/*` (our JWT or Google OIDC)
- Auth Gateway: <https://operator-auth-gateway-m545sz2isq-ez.a.run.app>
  - `/health` (anon) / `/ready` (anon) / `/v1/auth/signin` /
    `/v1/auth/refresh` / `/v1/auth/signout`

### GitHub

- Repo: <https://github.com/BusyaPrime/Operator-OS-Dev>
- Base branch (active): `phase3/live-deploy-and-vertex`
- All Phase A-C PRs: <https://github.com/BusyaPrime/Operator-OS-Dev/pulls?q=is%3Apr+milestone%3Aphase-c>
  (when milestone is applied)

### Key files for onboarding a Week 2 collaborator

- `CLAUDE.md` — operator harness (how Claude Code agents behave here)
- `docs/SPEC.md` — master technical specification v1.0 (product law)
- `docs/RULES.md` — R1-R50 engineering standards
- `docs/DECISIONS.md` — ADR ledger (now at 11 entries)
- `docs/TECH_DEBT.md` — TD-001 through TD-015
- `docs/IAM_PLAN.md` — least-privilege map (add auth-gateway-runtime
  entry in Week 2)
- `docs/sessions/` — per-session R24 logs for history
- `docs/reports/` — weekly closure reports (this file is the
  template for Week 2+)

### Dashboards

- Cloud Run console for both services:
  `console.cloud.google.com/run?project=operator-os-dev`
- Cloud Build history:
  `console.cloud.google.com/cloud-build/builds?project=operator-os-dev`
- Secret Manager:
  `console.cloud.google.com/security/secret-manager?project=operator-os-dev`

---

## Template note for Week 2+ authors

When writing the next weekly closure:

1. Copy this file, rename `2026-week-N-closure.md`, update dates.
2. Keep all 8 blocks — diffability across weeks is the whole point.
3. Block 2 should always be **the reality on the floor**, not
   intent: actual revisions, actual IAM, actual /ready shape on
   day of closure.
4. Block 5 TD movement is the single best trailing indicator of
   hygiene — filing new debt is fine, carrying old debt forward
   silently is not.
5. Block 7 is a contract with next week, not a wish list — every
   "Unblocked" item should be gated by a specific PR or artifact.
6. If a week missed its exit criteria, Block 1 says FAILED or
   PARTIAL with the specific miss named — not optimism.
7. Commit the report in the same PR as the session logs it
   summarises so git history carries both together.
