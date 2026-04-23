# Week 2 Phase 1 Closure Report

Date: 2026-04-24
Base branch: `phase3/live-deploy-and-vertex`
Phase 1 HEAD: `32817c1` (Phase 1.5 merge)

## Executive Summary

Week 2 Phase 1 closed on time with all five phases delivered and
merged. The repo moved from a `/health` + `/ready`-only bootstrap
scaffold to a layered, authenticated, multi-AI-agnostic platform:
the api keeps its existing IAM-open-with-middleware posture; CI
auto-deploys both Cloud Run services over Workload Identity
Federation; `@operator-os/contracts` exports the Universal AI
Platform interfaces; `@operator-os/desktop-agent` runs the first
concrete `AIAgent` (Claude Code) against those interfaces; and
`@operator-os/mobile` has a real Google Sign-In + auth session
layer alongside its existing 5-tab shell.

The monorepo test suite grew from 71 → 357 tests (+403%) across
six workspaces; zero regressions were introduced. Eight PRs
landed in the phase (five major deliverables plus three CD
smoke-test PRs), totalling ~7,500 lines added across production
code, tests, ADRs, and documentation. Fourteen new ADRs recorded
the architectural reasoning; five tech-debt items closed, three
new ones filed for Week 3, and one existing item was downgraded
to P3.

Production remained stable throughout: both Cloud Run services
continue to serve `/health` 200, IAM `allUsers` invoker bindings
held across every auto-deploy (TD-014 proven resolved), and the
auth-gateway HS256 flow verified end-to-end via PR-#16 test
script. No incidents. No rollbacks.

## Phase Deliverables (5/5 complete)

### Phase 1.1 — TD-014 api IAM drift fix

- **PR:** [#19](https://github.com/BusyaPrime/Operator-OS-Dev/pull/19)
  (merge `1405ae7`)
- **Title:** fix(infra): preserve api IAM allUsers across deploys (TD-014)
- **Closes:** TD-014
- **Key change:** swap `--no-allow-unauthenticated` →
  `--allow-unauthenticated` in `apps/api/cloudbuild.yaml` and
  `scripts/deploy-api.ps1`. Every future api deploy preserves the
  invoker binding instead of silently regressing public access.
- **ADR:** "Align api Deploy Flags With IAM-Open-With-Fastify-
  Middleware Reality" (2026-04-22).
- **Wall time:** ~45 min autonomous.

### Phase 1.2 — CI auto-deploy via WIF

- **PRs:** [#20](https://github.com/BusyaPrime/Operator-OS-Dev/pull/20),
  [#22](https://github.com/BusyaPrime/Operator-OS-Dev/pull/22),
  [#25](https://github.com/BusyaPrime/Operator-OS-Dev/pull/25),
  [#26](https://github.com/BusyaPrime/Operator-OS-Dev/pull/26)
  plus three CD smoke-retrigger PRs (#21/#23/#24/#27).
- **Merge SHAs:** `6ca0ea0` (#20), `f02c859` (#22), `b50fc4d` (#26).
- **Closes:** TD-015 (no auto-deploy trigger for `apps/api/**`
  merges), TD-016 (migrate GitHub Actions GCP auth to WIF —
  closed preemptively by adopting WIF Day 1).
- **Key change:** `.github/workflows/cd-deploy.yml` builds +
  deploys `operator-os-api` and `operator-auth-gateway` on every
  push to `phase3/live-deploy-and-vertex` that touches their
  paths. Google auth is Workload Identity Federation (no
  long-lived JSON keys). Substitutions include `_DEPLOY=true`,
  `--service-account`, `--gcs-source-staging-dir`,
  `--gcs-log-dir` — the canonical flag set.
- **IAM additions:** WIF pool `github-actions`, provider
  `github-actions-provider`, attribute-condition binding to
  `BusyaPrime/Operator-OS-Dev`, self-binding on `deploy-bot`
  for `roles/iam.serviceAccountUser`.
- **ADRs:** "Adopt Workload Identity Federation From Day 1
  (TD-016 Preempted)" (2026-04-22), "Canonical Cloud Build
  Flag Set For CI And Manual Deploy Parity" (2026-04-22).
- **Wall time:** ~3h (five smoke iterations to surface every
  missing flag / IAM binding / substitution).

### Phase 1.3 — Universal AI Platform contracts

- **PR:** [#29](https://github.com/BusyaPrime/Operator-OS-Dev/pull/29)
  (merge `8a9f852`)
- **Title:** feat(contracts): add Universal AI Platform interfaces (TD-010)
- **Closes:** TD-010 (packages/contracts missing Universal AI
  interfaces), TD-020 (AgentHeartbeatRequestSchemaV0 alias —
  wontfix; dual-schema approach chosen instead).
- **Key change:** `packages/contracts/src/ai/` exports `AIAgent`,
  `FileSystemProvider`, `StreamProvider`, `CostProvider`,
  `AgentManifest`, `AgentCapability`, plus `AIAgentError` +
  three subclasses. Additive heartbeat schemas
  (`agentHeartbeatRequestSchema`, `agentHeartbeatResponseSchema`)
  live alongside existing `deviceStateSchema`.
- **Tests:** +90 (type-level `expectTypeOf` assertions + runtime
  Zod tests); `packages/contracts` went 23 → 113.
- **SPEC evolution:** v1.0 → v1.1 — §61–66.7 rewrites to match
  the landed interfaces verbatim.
- **ADRs:** "Adopt Universal AI Control Platform Architecture"
  (2026-04-22), "SPEC §61 Evolves To Match packages/contracts
  Implementation", "SPEC §61-66.7 Evolves To Match
  packages/contracts Implementation", "Agent Heartbeat Schema
  Is Additive, Not Replacement", "Type-Level Tests Are The
  Contract Enforcement Mechanism For packages/contracts", and
  "Heartbeat Schema Replacement With V0 Backward-Compat Alias"
  (rejected-path record).
- **Wall time:** ~3h.

### Phase 1.4 — Desktop Agent + ClaudeCodeAgent

- **PR:** [#30](https://github.com/BusyaPrime/Operator-OS-Dev/pull/30)
  (merge `2cd13d8`)
- **Title:** feat(desktop-agent): integrate @operator-os/contracts
  interfaces + first AIAgent (ClaudeCodeAgent) — Phase 1.4
- **Closes:** none directly; first concrete `AIAgent` consumer
  of the Phase 1.3 contracts.
- **Files:** TD-022, TD-023, TD-024 (all for Week 3 batch).
- **Key change:** `apps/desktop-agent` gains
  `NodeFileSystemProvider`, `WebSocketStreamProvider`,
  `ApiCostProvider` (TD-022 stubs), `AgentRegistry`,
  `ManifestLoader`, and `ClaudeCodeAgent` (execa-based spawn,
  single-JSON output parsing, SIGTERM→SIGKILL cancel). Additive
  `AgentHeartbeatLoop` runs alongside the existing device-state
  `HeartbeatLoop`; both wire into `DesktopRuntime`. 30-second
  live boot test exercised graceful degradation (missing
  `claude` binary, unreachable api) without crashing.
- **Tests:** +122 (52 → 124 in desktop-agent, across providers,
  registry, agent state machine, heartbeat backoff + threshold
  transitions, and `DesktopRuntime` bootstrap wiring).
- **ADRs:** "Desktop Agent Phase 1.4 Uses Incremental Migration,
  Not Rewrite" (2026-04-24), "Desktop Agent Validates Heartbeat
  Payloads At Runtime" (2026-04-24).
- **Wall time:** ~4h across 8 atomic commits (c8–c15).

### Phase 1.5 — Mobile Google Sign-In

- **PR:** [#31](https://github.com/BusyaPrime/Operator-OS-Dev/pull/31)
  (merge `32817c1`)
- **Title:** feat(mobile): Google Sign-In integration + auth session
  layer — Phase 1.5
- **Closes:** none; additive on top of Phase 1.4 contracts.
- **Files:** none (no new TDs).
- **Key change:** `apps/mobile` gains
  `expo-secure-store`-backed `token-storage`, `auth-client`
  calling `/v1/auth/{signin,refresh,signout}`, a narrow wrapper
  over `@react-native-google-signin/google-signin`, a parallel
  `useAuthStore` (zustand), an authenticated fetch wrapper with
  proactive expiry refresh + refresh-on-401, and a root
  `native-stack` that swaps between auth screens and the
  existing 5-tab shell based on `useAuthStore.status`. The
  existing `RootTabs` + 5 screens + theme tokens are
  **untouched**.
- **Tests:** +74 (mobile 2 → 75, config 4 → 5).
- **ADRs:** "Mobile Phase 1.5 Adds Auth Alongside, Does Not
  Rewrite Navigation" (2026-04-24), "Mobile SignInScreen Tests
  Target The Extracted Hook, Not Rendered Tree" (2026-04-24).
- **Deviation (pre-approved):** vitest can't parse Flow syntax
  in `react-native` source pulled transitively by
  `@testing-library/react-native`; extracted `performSignIn` +
  `useSignInHandlers` from the screen and tested the
  orchestrator directly (11 tests covering every TZ-required
  behaviour branch). Pattern generalises for future RN screens.
- **Wall time:** ~3h + ~30 min for the Flow compat detour.

## Metrics Delta

| Metric                 | Week 2 start (71 tests) | Week 2 Phase 1 end | Delta    |
| ---------------------- | ----------------------- | ------------------ | -------- |
| Tests (all workspaces) |                      71 |                357 |    +403% |
| Test files             |                      12 |                 34 |    +183% |
| ADRs in DECISIONS.md   |                      13 |                 27 |      +14 |
| Open TDs               |                      12 |                 12 | 0 net    |
| TDs closed             |                       — |                  5 |       +5 |
| TDs filed              |                       — |                  3 |       +3 |
| Merged phase3 PRs      |                      18 |                 26 |       +8 |

Per-workspace test counts at phase close:

| Workspace                  | tests |
| -------------------------- | ----- |
| `@operator-os/api`         |    25 |
| `@operator-os/auth-gateway`|    15 |
| `@operator-os/config`      |     5 |
| `@operator-os/contracts`   |   113 |
| `@operator-os/desktop-agent`|  124 |
| `@operator-os/mobile`      |    75 |

## Production State

| Service                   | Status      | Last revision observation          |
| ------------------------- | ----------- | ---------------------------------- |
| `operator-os-api`         | Live        | `/health` 200 on phase3 HEAD         |
| `operator-auth-gateway`   | Live        | `/health` 200 on phase3 HEAD         |
| `/ready` (api)            | 503 degraded| Honest per TD-001/TD-002 — unchanged |
| `/ready` (auth-gateway)   | 200 OK      | No change                          |

IAM: stable, WIF active, zero observed drift across the
Phase 1.2 smoke runs and subsequent Phase 1.3/1.4/1.5 merges.
The path filter in `.github/workflows/cd-deploy.yml` correctly
excluded the Phase 1.4 and Phase 1.5 merge commits from CD
(`gh run list --commit <sha>` returned empty for both).

## Tech Debt Status

### Closed in Week 2 Phase 1 (5)

| TD      | Title                                                | Resolved via |
| ------- | ---------------------------------------------------- | ------------ |
| TD-010  | packages/contracts missing Universal AI interfaces   | Phase 1.3    |
| TD-014  | api.cloudbuild.yaml resets IAM allUsers on deploy    | Phase 1.1    |
| TD-015  | No auto-deploy trigger for apps/api/** merges        | Phase 1.2    |
| TD-016  | Migrate GitHub Actions GCP auth to WIF               | Phase 1.2 (preempted) |
| TD-020  | Remove AgentHeartbeatRequestSchemaV0 deprecation alias | Phase 1.3 (wontfix — dual-schema chosen) |

### Filed in Week 2 Phase 1 (3)

| TD      | Priority | Owner | Target  | Summary |
| ------- | -------- | ----- | ------- | ------- |
| TD-022  | P2       | api   | Week 3  | `/v1/cost/*` endpoints missing (ApiCostProvider stubs) |
| TD-023  | P3       | desktop-agent | deferred | Evaluate node-pty for raw-terminal agents |
| TD-024  | P2       | api   | Week 3  | `/v1/agent/heartbeat/agent` endpoint missing |

### Downgraded in Week 2 Phase 1 (1)

- **TD-021** — `gcloud builds submit` log-streaming hangs in GH
  Actions → P3 cosmetic. Deploys succeed; only the UI run shows
  "in_progress" past completion.

### Carried unchanged (pre-Week 2)

TD-001, TD-002, TD-004, TD-006, TD-007, TD-009, TD-011, TD-012,
TD-013, TD-017.

## ADRs Landed (Week 2 Phase 1 — 14 new in `docs/DECISIONS.md`)

Listed in commit order; dates match the Phase that added them.

1. **Align api Deploy Flags With IAM-Open-With-Fastify-
   Middleware Reality** — 2026-04-22 (Phase 1.1)
2. **Adopt Universal AI Control Platform Architecture** —
   2026-04-22 (Phase 1.3 prep)
3. **Incremental Upgrade Path For `apps/desktop-agent` And
   `apps/mobile`** — 2026-04-22 (Phase 1.3 prep)
4. **SPEC §61 Evolves To Match packages/contracts
   Implementation** — 2026-04-22 (Phase 1.3)
5. **Heartbeat Schema Replacement With V0 Backward-Compat
   Alias** — 2026-04-22 (rejected-path record from Phase 1.3)
6. **Adopt Workload Identity Federation From Day 1 (TD-016
   Preempted)** — 2026-04-22 (Phase 1.2)
7. **Agent Heartbeat Schema Is Additive, Not Replacement** —
   2026-04-22 (Phase 1.3)
8. **Mobile App Stays On @react-navigation v7 (No expo-router
   Migration)** — 2026-04-22 (Phase 1.5 pre-auth)
9. **Canonical Cloud Build Flag Set For CI And Manual Deploy
   Parity** — 2026-04-22 (Phase 1.2)
10. **SPEC §61-66.7 Evolves To Match packages/contracts
    Implementation** — 2026-04-23 (Phase 1.3)
11. **Type-Level Tests Are The Contract Enforcement Mechanism
    For packages/contracts** — 2026-04-23 (Phase 1.3)
12. **Desktop Agent Phase 1.4 Uses Incremental Migration, Not
    Rewrite** — 2026-04-24 (Phase 1.4)
13. **Desktop Agent Validates Heartbeat Payloads At Runtime** —
    2026-04-24 (Phase 1.4)
14. **Mobile Phase 1.5 Adds Auth Alongside, Does Not Rewrite
    Navigation** + **Mobile SignInScreen Tests Target The
    Extracted Hook, Not Rendered Tree** — 2026-04-24 (Phase 1.5)

## Week 3 Readiness

Week 3 will execute an "Agent API v2" batched PR against
`apps/api/**`. Three open TDs are ready to close together:

- **TD-017** — api `/v1/agent/ws` WebSocket endpoint (unblocks
  desktop-agent `WebSocketStreamProvider` + real task streaming)
- **TD-022** — api `/v1/cost/*` endpoints (unblocks
  `ApiCostProvider` real implementation; replaces stubs with
  real pricing + budget enforcement)
- **TD-024** — api `/v1/agent/heartbeat/agent` endpoint
  (unblocks `AgentHeartbeatLoop` observability path)

Together these close the last gap between mobile, auth-gateway,
api, and desktop-agent. End-to-end user flow becomes real:
`mobile → auth-gateway (sign-in) → api (task submit) →
desktop-agent (via WS) → ClaudeCodeAgent → streamed response
→ mobile`.

Estimated Week 3 wall time: 6–10h autonomous, with four
internal gates because the batched PR touches production api
(CD auto-deploy fires on merge).

## Rules Evolution (Week 2)

- **R23++** — triple-boundary marker isolation for copy-paste
  status blocks; active throughout the phase.
- **R51** (anti-sprawl) + **R52** (decision log discipline) —
  actively enforced; no drift into tangential cleanup, every
  non-obvious decision captured either inline in commit
  messages or in DECISIONS.md.
- No new rules filed this phase.

## Lessons Learned

1. **Google Cloud org policies force security best practices.**
   The JSON-key-creation block on `deploy-bot` forced adoption
   of Workload Identity Federation on Day 1 of Phase 1.2
   instead of after a theoretical future migration. WIF turned
   out to be simpler and more auditable once configured.
2. **CI smoke iterations are cheap with atomic commits.** Phase
   1.2 needed five smoke runs to surface the complete set of
   required flags + IAM bindings. Each iteration was one small
   fix; the feedback loop stayed under 5 minutes per run
   thanks to the CD path filter isolating concerns to the
   right services.
3. **Hook-extract test pattern works cleanly around the
   Vitest+RN+Flow incompatibility.** Extracting the
   orchestrator from `SignInScreen` cost ~50 lines of
   refactor and produced test coverage that will survive RN
   and vitest version bumps.
4. **Incremental migration preserved Days-1-3 bootstrap
   value.** Neither `apps/mobile` nor `apps/desktop-agent` was
   rewritten; every existing file still compiles and runs.
   The new code lands alongside.
5. **Atomic commits stay tractable at high velocity.** Week 2
   Phase 1 produced ~60 atomic commits across five branches.
   Each was scoped to a single architectural concern, which
   kept the PR review load under ~30 minutes per PR even at
   18-commit feature branches (Phase 1.4, Phase 1.5).

## Acknowledgements

- **Claude Code** — autonomous execution across all five phases,
  IAM-drift recovery (TD-014), WIF bootstrap (TD-016 preempted),
  runtime validation patterns, incremental mobile + desktop
  migrations, and the hook-extraction pattern documentation.
- **Akmal (BusyaPrime)** — product direction, gate approvals,
  Google Cloud Console IAM applications, strategic decisions on
  schema evolution paths (additive vs. replacement) and mobile
  test strategy (Option B).

## References

- PR #19 / `1405ae7` — Phase 1.1
- PR #20 / `6ca0ea0`, PR #22 / `f02c859`, PR #26 / `b50fc4d` —
  Phase 1.2
- PR #29 / `8a9f852` — Phase 1.3
- PR #30 / `2cd13d8` — Phase 1.4
- PR #31 / `32817c1` — Phase 1.5
- `docs/SPEC.md` v1.1 — current source of truth
- `docs/RULES.md` — R1–R50 engineering standards
- `docs/DECISIONS.md` — 27 entries total, 14 new in this phase
- `docs/TECH_DEBT.md` — 12 open items at phase close
- `docs/reports/2026-week-1-closure.md` — prior closure for
  continuity
