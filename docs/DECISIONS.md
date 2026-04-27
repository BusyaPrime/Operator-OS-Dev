# Decisions

## Monorepo With pnpm And Turborepo

Decision:

- use a single monorepo with `pnpm` workspaces and `turborepo`

Why:

- shared contracts and config packages are first-class requirements
- API, mobile, and desktop runtime need coordinated versioning
- bootstrap needs one place for CI and deployment foundations

## TypeScript As The Default Language

Decision:

- use TypeScript across backend, mobile, desktop, and shared packages where practical

Why:

- shared contracts remain type-safe across all runtimes
- bootstrap can move faster with one primary language toolchain

## Fastify For The API

Decision:

- use Fastify, not NestJS or a heavier framework

Why:

- good Cloud Run fit
- small surface area for a control-plane API
- strong TypeScript support

## Expo For Mobile

Decision:

- use Expo + React Native + TypeScript

Why:

- fastest path to a mobile-first operator shell
- clean upgrade path to native capabilities later if needed

## Vertex AI Only

Decision:

- keep runtime AI features on Vertex AI / Gemini only

Why:

- aligns with the GCP-first platform decision
- allows ADC and service-account based auth
- avoids mixed-provider runtime complexity during bootstrap

## Cloud Run First

Decision:

- target Cloud Run for the backend runtime

Why:

- it matches the required hosting model
- it avoids premature GKE complexity
- it fits a stateless Fastify API bootstrap well

## No Hidden Remote Control

Decision:

- enforce an explicit trusted control model

Why:

- it is central to the product definition
- it keeps architecture aligned with user-visible approval flows
- it avoids drifting into spyware-like behavior

## No Prisma/Postgres During Bootstrap

Decision:

- do not add a relational persistence layer yet

Why:

- the project already has Firestore and other managed GCP primitives available
- bootstrap should focus on contracts, orchestration, and deployment shape first

## Stub `/internal/tasks/*` Handlers + Honest Readiness Until A Durable Worker Exists

Decision made: 2026-04-22 during P0.1 (PR #1 + PR #3).

Decision:

- add Fastify stub handlers under `/internal/tasks/commands`,
  `/internal/tasks/approvals`, `/internal/tasks/exports` that accept
  Cloud Tasks deliveries, validate payloads via Zod, log
  `task_received`, and return HTTP 204 without running any real work.
- set `TASKS_TARGET_BASE_URL` to the deployed Cloud Run service URL so
  Cloud Tasks enqueue succeeds and `TasksQueueClient.describeReadiness()`
  reports `ok`.
- pin `CommandsService.describeReadiness()` and
  `ExportsService.describeReadiness()` to `degraded` with an explicit
  worker-pending message, independent of tasks queue state, until a
  real consumer exists.

Why:

- before this pass, `TASKS_TARGET_BASE_URL` was empty, so `tasks` was
  reported as `not_configured` and `/ready` returned `503`. The obvious
  fix was to set the env var, but Cloud Tasks would then start
  dispatching to `/internal/tasks/*` paths that did not exist, which
  Cloud Tasks would treat as 404 and retry up to `maxAttempts=100`
  with exponential backoff. That produces log spam and self-directed
  load on the revision.
- adding the handlers removes the 404 retry storm, but now the pipeline
  looks healthy while no durable work actually happens. Reporting
  `commands=ok` and `exports=ok` in that state would be a LAW #5
  violation: readiness must reflect real delivery, not transport
  configuration.
- honest `degraded` signals to any monitor or dashboard that the
  system is live-ready for intake but not end-to-end for dispatch.

Alternatives considered:

- leave `TASKS_TARGET_BASE_URL` empty. Rejected: keeps `/ready=503`
  for the wrong reason and blocks downstream work.
- set `TASKS_TARGET_BASE_URL` and let `commands=ok` bubble up.
  Rejected: false health signal (LAW #5 violation).
- build a real worker consumer now. Rejected: scope creep. The consumer
  is a separate, larger piece of work that belongs in its own pass.

Consequences:

- `/ready` remains HTTP 503 in production until a durable worker
  consumer lands. The body now calls out `commands` and `exports` as
  `degraded: durable worker consumer is not implemented yet`, which is
  the accurate state.
- The next meaningful milestone is wiring a durable consumer (Pub/Sub
  subscriber or a dedicated worker service) that drains the queue and
  persists terminal state. When that lands, flip the two
  `describeReadiness()` implementations back to `'ok'` (and only then).

## Stub `/internal/tasks/*` Handlers And Honest Readiness Until A Durable Worker Exists

Date: 2026-04-22
Status: accepted

Decision:

- Keep `/internal/tasks/commands`, `/internal/tasks/approvals`, and
  `/internal/tasks/exports` as stub handlers that Zod-validate the
  queue payload, log a `task_received` event, and return 204.
- Pin `CommandsService.describeReadiness()` and
  `ExportsService.describeReadiness()` to `degraded` with explicit
  worker-pending messages, regardless of whether the Cloud Tasks
  transport is configured.
- Flip both back to `ok` only when a real durable worker consumer
  drains the queues into Firestore / agent delivery.

Why:

- Without the stub handlers, setting `TASKS_TARGET_BASE_URL` to the
  service URL would cause Cloud Tasks to 404-retry against missing
  routes (`maxAttempts=100`, `maxBackoff=3600s`), producing log spam
  and self-directed load on the running revision.
- Before this decision, commands/exports readiness inherited the
  tasks queue status. Once the env was configured, readiness read
  `ok` for both services even though no consumer existed - an
  actively misleading signal to any external monitor.
- LAW #5 (verifiable honesty) outranks a visually green `/ready`.
  The readiness endpoint must describe what the system can actually
  deliver, not just what it is configured to attempt.

Consequences:

- `/ready` will stay at HTTP 503 until the durable worker ships.
  External health dashboards must interpret `commands=degraded` and
  `exports=degraded` with the worker-pending message as the expected
  state, not a failure.
- When the consumer lands, the change is small: replace the pinned
  `degraded` with a proper status based on consumer health.

## Adopt Master Technical Specification v1.0 As Source Of Truth

Date: 2026-04-22
Status: accepted

Decision:

- Land `docs/SPEC.md` as the canonical source of truth for all
  Operator-OS product work: vision, architecture, five architectural
  laws, backend/desktop/mobile specs, AI router, orchestration,
  security, observability, cost intelligence, 6-week sprint plan,
  R1-R50 operational rules.
- Extract R1-R50 from SPEC Book XV into a standalone `docs/RULES.md`
  for fast reference.
- Keep the repo root `CLAUDE.md` scoped to the Claude Code operating
  harness (language, git workflow, commit style, communication,
  autonomy boundaries) and have it point at SPEC and RULES for the
  product standards.
- Establish an explicit source-of-truth hierarchy:
  session instruction > SPEC.md > RULES.md > CLAUDE.md > other docs.

Why:

- Through P0.1 the repo accumulated rules in several places: the
  original `CLAUDE.md` R1-R20, Akmal's later R21-R24 reminders, and
  the 6-week execution plan with its own R1-R50. Duplication was
  guaranteed to drift.
- The sprint plan requires up to five parallel Claude Code sessions
  (backend, desktop-agent, mobile, infra, launch). Each session
  needs the same rulebook without pulling in the full narrative.
- A single canonical SPEC lets future team members, code reviewers,
  and Claude agents resolve every ambiguity to one document.

Alternatives considered:

- **Monolithic CLAUDE.md.** Rejected: file grows to thousands of
  lines, unclear scope, every worktree reads everything.
- **Renumber SPEC rules to avoid overlap with the old R1-R20.**
  Rejected: the sprint plan already numbers them R1-R50; renumbering
  creates its own drift risk.
- **Keep the old R1-R20 verbatim and append R21-R70.** Rejected:
  same drift problem; new rules already cover the old ones' intent.

Consequences:

- PRs are reviewed against `docs/RULES.md`. CLAUDE.md reviewers look
  at operating-harness behaviour (language, commit style, git
  safety), not product standards.
- Source-spec corrections against the Akmal paste: the Anthropic
  model list in SPEC § 63 is `Claude Opus 4.7, Sonnet 4.6, Haiku
  4.5`. Any other factual diffs (GPT-5, Gemini 3, domain names,
  pricing) are verified build-time when each integration lands.
- Docs navigation (`docs/README.md`) updated to lead with SPEC and
  RULES, then living-state docs, then the P0.1 and earlier archive.
- Extended 2026-04-23: Universal AI Control Platform architecture
  layered on top of SPEC v1.0 — see the next ADR. LAW #3 now resolves
  to four provider-agnostic interfaces rather than a single
  `AIProvider` completion shape.

## Adopt Universal AI Control Platform Architecture

Date: 2026-04-23
Status: accepted

Decision:

- Operator-OS is a Universal AI Control Platform, not a Claude Code
  remote. Claude Code is the Phase 1 MVP proof; in-scope agents
  already include Codex, Cursor CLI, ChatGPT desktop, Gemini CLI,
  Copilot Workspace, local models (Ollama, LM Studio), and future AI
  tools we do not yet know about.
- From Day 1 of Desktop Agent implementation, **all** agent
  execution, file access, output streaming, and cost tracking go
  through provider-agnostic interfaces. No concrete agent class
  (e.g. `ClaudeCodeAgent`) may be referenced from Desktop Agent
  core, the backend command dispatcher, the mobile UI, or the
  conductor.
- The four mandatory interfaces are:
  - `AIAgent` — any AI coding/task agent (lifecycle + execute +
    stream + cancel + status + resourceUsage)
  - `FileSystemProvider` — any file access (local FS, SSH, cloud,
    sandboxed workspace, …)
  - `StreamProvider` — any output streaming transport (subprocess
    PTY, SSE, WebSocket, queue fan-out, …)
  - `CostProvider` — vendor-specific usage + pricing surface
- `ClaudeCodeAgent` is the first `AIAgent` implementation. Week 2
  Desktop Agent ships with it as the only concrete agent, but the
  spec (§ 27) and core code reference the interface, not the class.
- Concrete agents are installed as plugins via a provider registry
  (§ 27.5). Users can `operator-agent install claude-code`,
  `operator-agent install codex`, `operator-agent install ollama`,
  etc. The set of installed providers is discoverable at runtime.

Why:

- Without this line in the sand now, Week 2 Desktop Agent would
  hardcode Claude Code specifics (command shape, output parsing,
  quota API, pricing table) straight into the command dispatcher
  and the subprocess executor. Phase 2+ multi-AI support would then
  require a major refactor of code paths that had already shipped
  to users — exponential debt cost.
- The five Architectural Laws require this: LAW #3 (Multi-AI
  Agnostic) is explicit about no vendor lock-in and portable
  context; implementation proves the law only if the code enforces
  it. Interfaces are how you enforce it.
- Test ergonomics: mock providers are trivial to build against
  narrow interfaces; integration tests can run without real API
  keys or PTY subprocesses.
- Open-source / ecosystem path: third parties can contribute
  providers without touching core (important when new AI tools
  appear between sprints).

Alternatives considered:

- **Hardcode Claude Code in Week 2, refactor in Phase 2.** Rejected.
  The refactor touches Desktop Agent core, backend command dispatch,
  cost tracking, and the conductor — all code paths that are in
  production by the time Phase 2 starts. Cost of the refactor grows
  with every feature added on top of the hardcoded surface.
- **Defer multi-AI to Phase 3.** Rejected. The *architecture* must
  support multi-AI from Day 1 even if only one concrete agent ships
  in Phase 1. This is the standard "interface-first, implementation-
  later" move; it costs little upfront and saves a lot later.
- **Abstract via configuration instead of interfaces.** Rejected.
  Config-driven agent dispatch (pick agent by string key, call
  shell command from config) gives up type safety, makes debugging
  subprocess failures painful, and makes capability discovery
  (vision? long context? tool use?) impossible without parsing
  string docs. Interfaces win on every axis that matters.

Consequences:

- SPEC.md changes (this PR): § 4 LAW #3 expanded to name the four
  interfaces; § 27 Desktop Agent Mission and architecture diagram
  reference `AIAgent`, not `ClaudeCodeExecutor`; § 27.5 Provider
  Registry added; § 61 Multi-AI Router rewritten to lead with the
  four interfaces; § 62-66 re-framed as agent implementations
  grouped by vendor; § 66.5-66.7 added for Cursor CLI, Copilot
  Workspace, and the Custom Agent open standard.
- Week 2 work now starts from an interface skeleton: `packages/
  contracts` exports `AIAgent`, `FileSystemProvider`,
  `StreamProvider`, `CostProvider` type declarations; Desktop Agent
  imports these and implements `ClaudeCodeAgent` against them.
- Provider-specific features that genuinely do not generalise
  (Claude's thinking mode, Gemini's 1M context, Codex's code-
  interpreter sandbox) are exposed via a `capabilities` flag on the
  interface. Core code must not branch on vendor string; it must
  branch on capability.
- Slight upfront complexity in Week 2 is accepted as the price. If
  a feature is provably Claude-only for all time (very rare), it
  may bypass the interface — but only after an ADR justifying it.

References:

- SPEC § 4 LAW #3 Multi-AI Agnostic (expanded this pass)
- SPEC § 27, § 27.5 Desktop Agent + Provider Registry (updated /
  added this pass)
- SPEC § 61-66.7 AI Provider Abstraction (rewritten this pass)

## operator-os-api: allUsers Invoker + HS256 Verifier Over Firebase

Date: 2026-04-23
Status: accepted

Decision:

- `operator-os-api` IAM policy includes `allUsers → roles/run.invoker`.
  Cloud Run is no longer the primary auth boundary for this service.
- Security is enforced at the Fastify middleware layer via
  `FirebaseAuthService.createRequiredGuard()` for `/v1/ai/*` and
  `createAgentGuard(agentAudience)` for `/v1/agent/*` (TD-005
  closure from PR #6 + PR #11).
- Inbound bearer tokens are verified along three paths in a fixed
  order: (1) Firebase ID token via `firebase-admin.auth().verifyIdToken`,
  (2) our auth-gateway-issued HS256 JWT via `jose.jwtVerify` against
  `AUTH_ACCESS_TOKEN_ISSUER = operator-auth-gateway` and
  `AUTH_ACCESS_TOKEN_AUDIENCE = operator-os-api`, (3) Google OIDC
  ID token with audience = service URL (agent routes only). First
  path to validate wins; missing or all-rejected token → HTTP 401
  with a JSON error body from our handler.

Why:

- Mobile and web clients hold our HS256 JWT, not a GCP service-
  account identity. Without `allUsers → run.invoker`, the Cloud
  Run frontend returns an HTML 401 and the mobile client never
  reaches our Fastify logic — the response shape is unusable, and
  the user sees a different (wrong) error than they should.
- Keeping security in Fastify keeps the policy in code under
  review rather than distributed across IAM, and gives a single
  clear error taxonomy for clients.
- The three-path verifier lets the same service accept (a) Firebase
  sessions from legacy / bootstrap paths, (b) HS256 tokens from our
  own auth-gateway, and (c) Google OIDC identity tokens from
  desktop-agent and Cloud-Tasks service-to-service calls, without
  branching at the route level.

Alternatives considered:

- **Keep `--no-allow-unauthenticated`, issue GCP service-account
  OIDC tokens to mobile clients.** Rejected. Requires distributing
  GCP service-account credentials to every user device — breaks
  LAW #2 (User Sovereignty) and the Secret-Manager hygiene we've
  committed to.
- **Keep Firebase Admin as the sole verifier.** Rejected because
  auth-gateway issues HS256 JWTs that Firebase Admin cannot verify
  (`"no 'kid' claim"` — Phase C.2 iteration 3 surfaced exactly
  this).
- **Drop Firebase support entirely, HS256-only.** Rejected *for
  now*. Firebase support stays in the guard as a backwards-
  compat path for existing Firebase-session code in the mobile
  scaffold; scheduled for removal as a clean-up PR once mobile is
  fully migrated to auth-gateway tokens.

Consequences:

- The api is publicly reachable at the Cloud Run layer. Cloud
  Armor + rate limiting become the defensive layer at the edge —
  not yet deployed; tracked as a Week 2+ item.
- Every api deploy currently resets the IAM policy back to
  `--no-allow-unauthenticated` because `infra/cloudbuild/api.cloudbuild.yaml`
  carries that flag. This is a known trap — see TD-014 in
  `docs/TECH_DEBT.md`. Until the cloudbuild is updated, every
  api deploy must be followed by a manual
  `gcloud run services add-iam-policy-binding ... --member=allUsers
  --role=roles/run.invoker`.
- `operator-os-api` deploy-gap (PR #11 code merged but the image
  was never rebuilt) was the proximate cause of Phase C.2
  iteration 3. Tracked as TD-015: there is no CI trigger that
  automatically rebuilds api on every merge to
  `phase3/live-deploy-and-vertex` that touches `apps/api/**`.
  Week 2 closes that gap.

References:

- PR #6: `b7ad606` (TD-005 closure + initial required-auth guards)
- PR #11: `990ccb4` (HS256 verifier wired into
  `FirebaseAuthService.createRequiredGuard` + `createAgentGuard`)
- `docs/sessions/2026-04-23-phase-c2-auth-gateway-deploy.md`
  (full walk-through of the IAM-reset and deploy-gap discoveries)
- `docs/TECH_DEBT.md` TD-014 (IAM reset), TD-015 (deploy gap)

## Align api Deploy Flags With IAM-Open-With-Fastify-Middleware Reality

Date: 2026-04-24
Status: accepted

Decision:

- Both `infra/cloudbuild/api.cloudbuild.yaml` (CI deploy path) and
  `infra/scripts/deploy-api.ps1` (imperative deploy path) now
  pass `--allow-unauthenticated` to `gcloud run deploy` for
  `operator-os-api`. This makes the deploy config carry the same
  IAM intent that the earlier *operator-os-api: allUsers Invoker
  + HS256 Verifier Over Firebase* ADR committed to.
- Mechanical consequence: every successful future deploy of the
  api service preserves the `allUsers → roles/run.invoker`
  binding rather than silently resetting it.

Why:

- The previous state had the cloudbuild and the deploy script
  explicitly passing `--no-allow-unauthenticated`, which forces
  `gcloud run deploy` to replace the service IAM policy with the
  authenticated-only default on every successful deploy. Observed
  during Phase C.2 step 11: the api redeploy silently dropped the
  `allUsers` binding and `/health` started returning HTML 401
  from Google Frontend until the binding was manually re-applied.
- Operational manifestation: every future api deploy was a 1-2
  minute IAM-outage trap. For a single-founder team this is a
  material reliability issue because an outage during demo / user
  onboarding would be wrongly attributed to our Fastify layer.
- LAW #5 (Verifiable Honesty) at the operational layer: the
  cloudbuild YAML is the canonical statement of "how we deploy";
  it must reflect the real IAM intent, not a contradictory one.

Alternatives considered:

- **Post-deploy `add-iam-policy-binding` step in the
  cloudbuild.** Kept `--no-allow-unauthenticated` as a "safe
  default" and explicitly re-granted `allUsers → run.invoker`
  after the deploy. Rejected: two-step IAM transitions create a
  visible outage window, even if short; mis-written step (typo,
  wrong member) produces a silent-forever-unauthenticated service.
- **Revert the IAM-open ADR and keep `--no-allow-unauthenticated`.**
  Would require every mobile / desktop client to authenticate to
  GCP with a service account identity before reaching our Fastify
  auth. Breaks LAW #2 (User Sovereignty) and doubles credential
  distribution surface. Same reasoning as the original ADR —
  rejected for the same reasons.
- **Keep cloudbuild `--no-allow-unauthenticated` + have CI
  workflow re-apply IAM after deploy as a separate step.**
  Structurally identical to the post-deploy option above but with
  the step in GitHub Actions rather than Cloud Build. Same race
  window. Rejected.

Consequences:

- `operator-os-api` is publicly reachable at the Cloud Run
  frontend. All HTTP-level defense now lives in Fastify: HS256
  JWT verification, Google OIDC fallback, Firebase ID token
  legacy path, 401 on unknown tokens, route-specific guards.
- Unauthenticated calls still consume a minimal amount of
  compute (body-parsing + middleware overhead) before Fastify's
  401. Cloud Run `min-instances=0` + `max-instances` cap
  prevents runaway cost. Cloud Armor + per-user rate limiting
  are tracked as a Week 2+ security sprint item.
- DDoS surface at the Cloud Run edge is slightly wider but
  symmetric with how `operator-auth-gateway` already operates
  (the auth-gateway IS the auth boundary and has been
  `--allow-unauthenticated` since Phase C.1).
- TD-014 is resolved by this PR. Verification will follow once
  CI auto-deploy (TD-015 / PR #20) lands: one merge to
  `apps/api/**` on `phase3/live-deploy-and-vertex` should
  auto-deploy a fresh revision AND keep the IAM policy
  unchanged. Until TD-015 ships, manual deploy via
  `deploy-api.ps1` is the verification vehicle.

References:

- Previous ADR: *operator-os-api: allUsers Invoker + HS256
  Verifier Over Firebase* (2026-04-23) — establishes the
  "security at Fastify layer" intent that this ADR brings the
  cloudbuild config into alignment with.
- `docs/TECH_DEBT.md` TD-014 (filing + resolution).
- `infra/cloudbuild/auth-gateway.cloudbuild.yaml` (the positive
  example — had `--allow-unauthenticated` from Phase C.1
  because auth-gateway is the auth boundary; api now matches).

## Incremental Upgrade Path For apps/desktop-agent And apps/mobile

Date: 2026-04-24
Status: accepted

Decision:

- Both `apps/desktop-agent` and `apps/mobile` retain their Day 1-3
  bootstrap code as the starting point for Week 2 work. No wipe,
  no greenfield rescaffold.
- Week 2 Phase 1.4 / 1.5 proceeds by incremental adaptation:
  surgical edits per module, preserving passing tests, migrating
  file-by-file to the target shape described in the Week 2 TZ
  (Part 4.1 layout for desktop-agent, Part 5.1 layout for mobile).
- Before any edit to an existing file, Claude Code reads the
  current content and flags material conflicts with the TZ design
  to Akmal; each conflict is resolved (refactor or TZ-adjust)
  before the edit proceeds.

Why:

- `apps/desktop-agent` already contains 13 TypeScript modules
  (runtime, heartbeat-loop, command-poller, api-client,
  safe-command-executor, session-manager, export-manager,
  device-state, notifier, config, logger, main, index) plus a
  passing runtime test. `apps/mobile` has a functional Expo RN
  scaffold with 5 screens (home / devices / sessions / costs /
  settings), navigation, Zustand store, API client, auth-session
  service, theme tokens, mocks, and a passing operator-store
  test. All of that was written through Day 1-3 bootstrap PRs
  and validated by CI.
- Discarding that work to start from a TZ-literal blank layout
  would throw away proven integrations (the existing api-client
  already talks to operator-os-api, the existing heartbeat-loop
  already exists with a real cadence) and re-open every
  regression risk we've already closed.
- The TZ describes a *target* shape. It was written without
  knowing about the existing scaffolds (Week 1 closed with the
  Desktop Agent section deferred, so the TZ author did not have
  the bootstrap files in context). The correct move is to treat
  the TZ as a north star, not as a mandate to delete.

Alternatives considered:

- **Greenfield rescaffold (TZ-literal).** Rejected. Deletes ~18
  files of proven code and 3 passing tests. High regression
  surface; no benefit that incremental migration cannot also
  deliver.
- **Freeze existing code and build TZ scaffold alongside as v2.**
  Rejected. Would leave `apps/desktop-agent` with two parallel
  runtime layers, confusing for a new engineer reading the code
  3 months from now. The incremental path produces one coherent
  result.

Consequences:

- PR #22 (Desktop Agent) structure differs slightly from TZ Part
  4.10 deliverables list. Commit boundaries will follow the
  existing module boundaries rather than the TZ's idealized
  module layout. The end state still matches TZ Part 4.1 target
  once all migrations land, but by a gentler path.
- Every edit to an existing file starts with a read + summary
  step. Marginal cost, material value: prevents accidental
  overwrite of bootstrap logic that the TZ author did not see.
- If any existing file is found to materially conflict with a TZ
  requirement (e.g. heartbeat payload shape), Claude Code
  surfaces the conflict to Akmal before the edit rather than
  resolving unilaterally.

References:

- TZ Week 2 Phase 1 spec, Parts 4 and 5.
- Bootstrap commits in phase2/integrations-and-runtime and
  phase3/live-deploy-and-vertex history touching
  `apps/desktop-agent/**` and `apps/mobile/**` for full context.

## SPEC §61 Evolves To Match packages/contracts Implementation

Date: 2026-04-24
Status: accepted

Decision:

- `packages/contracts` Week 2 Phase 1.3 (PR #21 for TD-010) lands
  the Universal AI Platform interfaces in the shape described by
  the Week 2 TZ Part 3.3, NOT the shape originally committed to
  `docs/SPEC.md` §61 in PR #13.
- `docs/SPEC.md` §61-66.7 is updated in the same PR (#21) to
  reflect the refined shape, with a traceability note
  *"2026-04-24: SPEC §61 refined to match packages/contracts
  implementation — see DECISIONS.md for the evolution ADR"*.
- The original SPEC §61 shape from PR #13 is preserved in git
  history (nothing lost); no rollback needed.

Why:

- PR #13 SPEC §61 was written in Phase B as a design artefact
  before any concrete implementation pressure. It defined an
  `AIAgent` with plain fields (`id`, `vendor`, `capabilities[]`)
  and method-based streaming (`stream(task): AsyncIterable`).
  Valid as a first sketch.
- The Week 2 TZ Part 3.3 evolved the design after implementation
  practice. Notable improvements:
  1. Structured `identity` / `runtime` / `manifest` triplets
     instead of flat fields. Identity stays stable across
     restarts; runtime carries process-level state; manifest is
     the declarative contract for registration. Cleanly
     separated concerns.
  2. `AIAgent` owns its providers (`fs`, `stream`, `cost` as
     readonly fields). Dependency inversion at the agent
     boundary, so each agent can ship its own
     `FileSystemProvider` / `StreamProvider` / `CostProvider`
     specialisation (e.g. Cursor CLI's scoped-sandbox fs vs
     ClaudeCodeAgent's local-fs).
  3. `stop(reason)` takes an enum reason so auto-update /
     user-quit / error paths are distinguishable at the call
     site. `shutdown()` without a reason lost that information.
  4. `executeTask(input) → TaskHandle` with polling model
     replaces `execute(task) → AgentResult` + separate
     `stream(task)`. The task handle carries status transitions
     and usage, so long-running tasks don't need a parallel
     streaming API.
  5. `listCapabilities()` returns a `readonly AgentCapability[]`
     (narrowed union type) rather than a generic `Capability[]`,
     unlocking compile-time exhaustiveness checks.
- The CLAUDE.md source-of-truth hierarchy is:
  session instruction > SPEC > RULES > CLAUDE. A live TZ
  instruction therefore outranks a SPEC section, as expected.
  Updating SPEC keeps the two in sync so future readers don't
  see a contradiction.

Alternatives considered:

- **Keep SPEC §61 as-is, land contracts in a different shape.**
  Rejected: creates a documented-vs-implemented drift that
  violates LAW #5 at the doc layer.
- **Land contracts in SPEC §61 shape, ignore TZ.** Rejected:
  TZ is more mature and carries more implementation experience;
  session instruction outranks SPEC per the hierarchy.
- **Land contracts now, defer SPEC update to Week 3.**
  Rejected: the drift would be load-bearing for exactly the
  period when Desktop Agent implementation is reading SPEC for
  guidance. Best to land together.

Consequences:

- PR #21 grows by ~200-400 lines of SPEC edits beyond the
  contracts code itself. One-time cost; worth the consistency.
- Future agents (CodexAgent, CursorCLIAgent, OllamaAgent etc.)
  implement the TZ shape directly, no reconciliation step.
- The TD-010 `contracts` test suite uses the TZ shape (per TZ
  Part 3.5 type-level tests). Those tests are the authoritative
  compile-time enforcement; the SPEC becomes the authoritative
  narrative.

References:

- SPEC §61-66.7 (current, PR #13 shape — to be updated in PR #21).
- TZ Week 2 Phase 1.3 Part 3.3 (target shape — to be landed in
  packages/contracts via PR #21).
- PR #13 merge SHA `8fdfbb8` for historical tracking of original
  shape.

## Heartbeat Schema Replacement With V0 Backward-Compat Alias

Date: 2026-04-24
Status: accepted

Decision:

- The agent heartbeat payload schema in `@operator-os/contracts`
  is replaced with the shape described in Week 2 TZ Part 4.4.
  Field set: `agentId`, `providerId`, `providerVersion`,
  `platform`, `hostname`, `state`, `uptimeSeconds`,
  `activeTaskCount`, `systemLoad`, `healthChecks`, `timestamp`.
- The existing heartbeat schema is preserved as
  `AgentHeartbeatRequestSchemaV0` with a `@deprecated` JSDoc tag
  so callers that have not yet migrated get a compile-time
  warning.
- The canonical name `AgentHeartbeatRequestSchema` points at
  the new shape. All callsites are migrated in the same PR that
  lands the new schema (grep-driven refactor).
- If the existing schema carries fields the TZ design does not
  list, those fields are preserved as *optional* in the new
  schema. No silent data loss; the superset wins.
- TD-020 (new) tracks the removal of the V0 alias after two
  minor versions or at the next contracts-package major bump,
  whichever comes first. The deprecation is not permanent.

Why:

- The existing schema was written during Day 1-3 bootstrap when
  the client of `/v1/agent/heartbeat` was loosely modelled as a
  "device", not as a concrete agent with capabilities. The TZ
  design formalises the agent-centric model (providerId,
  providerVersion, activeTaskCount) that matches the actual
  Desktop Agent runtime.
- A straight replacement without an alias would break any
  external caller that has already built against the existing
  schema (mobile scaffold or test code). A deprecation window
  costs almost nothing (a re-export + JSDoc line) and buys
  migration time.
- LAW #5 again: the schema evolution should be visible in
  contracts so downstream compile errors guide callers to the
  new shape, rather than runtime mismatch surprises.

Alternatives considered:

- **Straight replacement with no alias.** Rejected. Breaks any
  caller who committed against the old schema on
  `phase3/live-deploy-and-vertex` tip.
- **Add new schema under a different name (no canonical
  reassignment).** Rejected. Leaves two equivalent-looking
  schemas, confusing for readers and for Zod validation
  boundaries.
- **Version both schemas forever (V0 permanent).** Rejected.
  Defeats the point of evolving the design; TD-020 closure
  removes V0 once callers have migrated.

Consequences:

- PR #21 (TD-010) OR a sibling PR carries the schema migration
  as an atomic commit: rename old → V0 with @deprecated, export
  new canonical, refactor all callsites.
- Existing tests that assert heartbeat shape get updated to new
  fields. Where the old schema had a field the TZ missed, the
  new schema carries it as optional and a test documents the
  preservation.
- TD-020 is filed in `docs/TECH_DEBT.md` immediately alongside
  the schema change so the V0 deprecation is tracked, not
  orphaned.

References:

- TZ Week 2 Phase 1.4 Part 4.4 (target heartbeat schema).
- Existing `AgentHeartbeatRequestSchema` location TBD pending
  research (see `ls apps/desktop-agent` + contracts grep — will
  be attached to the research report before PR #21 starts).
- `docs/TECH_DEBT.md` TD-020 (alias removal tracker — filed with
  this ADR landing).

**Superseded** (2026-04-24): after pre-Phase-1.3 research, the
existing repo carries no `AgentHeartbeatRequestSchema` — the api
uses `deviceStateSchema` (a device-centric shape) directly as its
heartbeat payload, and `deviceStateSchema` is also used in the
operator-state model and messaging contracts. There is no schema
to "replace", so the V0-alias framing does not apply. See the
replacement ADR *Agent Heartbeat Schema Is Additive, Not
Replacement* (2026-04-24) for the revised direction. TD-020 is
closed as wontfix — the alias it tracked is not needed.

## Adopt Workload Identity Federation From Day 1 (TD-016 Preempted)

Date: 2026-04-24
Status: accepted

Decision:

- GitHub Actions authenticates to Google Cloud via Workload
  Identity Federation (WIF) + OIDC. No long-lived JSON service-
  account keys are ever created, stored, or rotated.
- Federation pool: `github-actions-pool` (global).
- Federation provider: `github-actions-provider`. Issuer:
  `https://token.actions.githubusercontent.com`. Attribute
  mapping: `google.subject=assertion.sub`,
  `attribute.actor=assertion.actor`,
  `attribute.repository=assertion.repository`,
  `attribute.repository_owner=assertion.repository_owner`.
  Attribute condition: `assertion.repository_owner == 'BusyaPrime'`
  — any non-BusyaPrime fork attempting to exchange a GitHub OIDC
  token for GCP credentials is rejected at the STS layer.
- Service account `deploy-bot@operator-os-dev.iam.gserviceaccount.com`
  has `roles/iam.workloadIdentityUser` for the pool's
  principalSet `attribute.repository/BusyaPrime/Operator-OS-Dev`.
- GitHub repo carries three Actions secrets (public by design —
  none of them are credentials):
  - `GCP_PROJECT_ID` — the project id string.
  - `GCP_WORKLOAD_IDENTITY_PROVIDER` — full resource name of the
    pool provider. Looks like a GCP resource path; exchangeable
    only when the workflow has the right OIDC attributes.
  - `GCP_SERVICE_ACCOUNT` — the deploy-bot email to impersonate
    after the OIDC exchange.

Why:

- `constraints/iam.disableServiceAccountKeyCreation` is set at
  the organisation level in `operator-os-dev`. Attempting
  `gcloud iam service-accounts keys create` returns
  `FAILED_PRECONDITION: Key creation is not allowed on this
  service account.` Waiving the policy would add a standing
  exception for every CI workflow.
- Waiving vs adopting: WIF is Google's 2026 recommended best
  practice for external CI/CD. No long-lived credentials means
  no rotation process, no stolen-key incident recovery path, no
  key in a GitHub Secrets store that a rogue workflow might
  exfiltrate. The OIDC token minted per-job is short-lived and
  scoped to the specific GitHub Actions run.
- Audit trail: every federated token exchange shows up in Cloud
  Audit Logs with the full GitHub Actions assertion claims
  (workflow name, repository, actor, ref). Post-hoc forensics
  are strictly better than "someone had the JSON key".
- TD-016 was filed in Week 1 closure as the "future WIF
  migration" item. By adopting WIF from Day 1, TD-016 is closed
  preemptively with zero migration cost — we never had a JSON
  key to migrate *from*.

Alternatives considered:

- **Waive the org policy and use JSON keys.** Rejected. Keys
  have real rotation cost (operator time, possibly downtime),
  sit in GitHub Secrets forever by default, and are the #1
  credential-theft class in external CI/CD. The policy exists
  for exactly this reason.
- **Self-hosted GitHub runner in GCP with metadata-server auth.**
  Rejected for scope. Self-hosted runners add an ops burden
  (VM lifecycle, patching, scaling) that the scope of one
  founder does not support. WIF on GitHub-hosted runners is
  the same security posture without the ops cost.
- **Delay CI auto-deploy, stay manual.** Rejected. TD-015 was
  filed because manual deploy caused PR #11 to sit undeployed
  for 24+ hours in Week 1. Keeping deploys manual preserves the
  exact class of bug that TD-015 was filed to prevent.

Consequences:

- `.github/workflows/cd-deploy.yml` uses
  `google-github-actions/auth@v2` with
  `workload_identity_provider` + `service_account` inputs. The
  previous TZ Part 2.3 reference to `GCP_SA_KEY` is void; no
  such secret exists in the repo.
- Future repositories (if a second repo ever needs to deploy to
  the same GCP project) add an entry to the pool's principalSet
  rather than provisioning a new SA key. Scales cleanly.
- The attribute condition `repository_owner == 'BusyaPrime'`
  means GitHub forks cannot abuse the provider. If a fork is
  ever created (e.g. for a contributor), either (a) their fork
  can't run the CD workflow at all, or (b) a new principalSet
  is added explicitly. Default-deny.
- TD-016 is closed as *resolved / preempted* rather than as
  *wontfix*. The migration path it described was executed in
  advance; the debt never accrued.

References:

- TD-015 closure via PR #20 (this workflow).
- TD-016 preemptive closure (this ADR + TECH_DEBT.md update).
- GitHub Actions OIDC docs:
  https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
- Google WIF docs:
  https://cloud.google.com/iam/docs/workload-identity-federation-with-other-providers
- `.github/workflows/cd-deploy.yml` (the workflow that uses WIF).

## Agent Heartbeat Schema Is Additive, Not Replacement

Date: 2026-04-24
Status: accepted (supersedes 2026-04-24 *Heartbeat Schema
  Replacement With V0 Backward-Compat Alias*)

Decision:

- `@operator-os/contracts` gains a new, agent-centric
  `AgentHeartbeatRequestSchema` (plus matching
  `AgentHeartbeatResponseSchema`) in a new file
  `packages/contracts/src/agent/heartbeat.ts`.
- `deviceStateSchema` (in `packages/contracts/src/operator.ts`)
  is **not** touched, not aliased, not deprecated.
- The two schemas coexist: `deviceStateSchema` remains the
  device-centric shape used by the operator-state model and
  mobile dashboard; `AgentHeartbeatRequestSchema` is the new
  agent-process telemetry shape used by the Desktop Agent
  runtime.

Why:

- Pre-Phase-1.3 research (direct file reads + grep) confirmed:
  - No `AgentHeartbeatRequestSchema` exists in the repo today.
  - The previous ADR (earlier on 2026-04-24) framed the change
    as a replacement with a V0 alias. With nothing to replace,
    that framing produced a TD (TD-020) that tracked an alias
    that wouldn't exist.
  - `deviceStateSchema` is used by three distinct consumers
    (operator dashboard, messaging contracts, index.test)
    outside the heartbeat path. Collapsing it into an agent
    heartbeat shape would force the operator-state model to
    carry agent-process fields it doesn't need, or fork the
    shape anyway.
- Device state and agent heartbeat are semantically different
  concerns: device state describes *the mobile client's
  environment* (battery, network, locale, foreground state),
  while agent heartbeat describes *an AI worker process's
  runtime* (active task count, model capability status, system
  load, provider version). Future agents (desktop worker, edge
  agent, cloud agent) will each have their own heartbeat
  shape; device is one of many, not the canonical.
- Additive design satisfies LAW #5 (Verifiable Honesty) at the
  contract layer: the name of each schema describes exactly
  what it models, with no misleading shared surface.

Alternatives considered:

- **Replacement with V0 alias** (the superseded ADR). Rejected
  because there is nothing to alias *from*; the research
  revealed the old ADR was based on a false premise.
- **Unify** into a single HeartbeatSchema with an agent-or-
  device discriminator. Rejected. Breaks the separation of
  concerns, forces every consumer to care about fields that
  belong to a different domain, and creates one large schema
  with Zod `z.discriminatedUnion` or similar — fine in
  isolation, bad as a platform-wide convention.

Consequences:

- PR #21 (TD-010 contracts) lands both the four AI Platform
  interfaces (AIAgent, FileSystemProvider, StreamProvider,
  CostProvider) and the new agent heartbeat schemas as sibling
  additions under `packages/contracts/src/agent/` and
  `packages/contracts/src/ai/`.
- The existing `POST /v1/agent/heartbeat` endpoint on
  operator-os-api continues to accept `deviceStateSchema`
  bodies. A new endpoint or content-negotiation path for the
  agent-centric shape lands when the Desktop Agent integration
  test (Week 3 gated on TD-017 api-side WebSocket) is planned.
  Until then, Desktop Agent internally builds and logs the new
  shape but wire-sends the DeviceState shape to the existing
  endpoint — no behavioural change for the api side.
- TD-020 scope collapses. Original scope (remove V0 alias) does
  not apply. Entry closed as wontfix with a forward pointer to
  this ADR.

References:

- Superseded ADR: *Heartbeat Schema Replacement With V0
  Backward-Compat Alias* (2026-04-24, marked superseded
  in-place).
- Week 2 TZ Phase 1.4 Part 4.4 (new schema spec).
- `packages/contracts/src/operator.ts` (existing
  `deviceStateSchema` definition at line ~155; unchanged by
  this ADR).

## Mobile App Stays On @react-navigation v7 (No expo-router Migration)

Date: 2026-04-24
Status: accepted

Decision:

- `apps/mobile` stays on `@react-navigation/bottom-tabs` v7 +
  `@react-navigation/native` v7 as its navigation library. The
  Week 2 TZ Part 5.1 reference to `expo-router` v3 is treated
  as aspirational only and overridden by this ADR.
- All Week 2+ mobile features (Google Sign-In gate, auth flow,
  task screens, agent dashboard) are added **inside** the
  existing `@react-navigation` hierarchy, not in a new router
  tree.

Why:

- `apps/mobile` already boots, renders five tabs (home, devices,
  sessions, costs, settings), carries components + theme
  tokens + a Zustand store + API client + a passing Vitest
  suite. All of that was written with `@react-navigation`. A
  switch to `expo-router` would require rewriting the
  navigation tree, migrating all screen definitions, and
  refactoring existing deep links and state wiring.
- `@react-navigation` v7 is production-proven (Meta, Shopify,
  DoorDash all ship on it). `expo-router` is newer and gives
  you file-system routing on top of React Navigation; it's not
  a different navigation engine, just a thinner convention
  over the same primitives. There's no user-visible benefit to
  migrating during a scoping sprint.
- The TZ was written without visibility into the existing
  mobile scaffold (the Week 2 TZ author did not read
  `apps/mobile/App.tsx` or `apps/mobile/src/navigation/` before
  specifying `expo-router` as the framework). Overriding here
  is consistent with the earlier ADR *Incremental Upgrade Path
  For apps/desktop-agent And apps/mobile* — TZ is a north
  star, not a delete-and-rewrite mandate.

Alternatives considered:

- **Migrate to expo-router (TZ-literal).** Rejected. 2-3 days
  of navigation refactor for no user benefit. Every screen
  file moves; every deep link re-validated; every test
  reconsidered; and the end result is the same 5 tabs with
  the same 5 screens behind them.
- **Keep navigation code frozen, spin up expo-router in
  parallel as v2.** Rejected for the same reasons as the
  parallel-scaffold option in the incremental-upgrade ADR —
  two mental models, confusion for future readers, no
  benefit.

Consequences:

- Week 2 TZ Part 5.1 target structure (`app/(auth)/signin.tsx`
  etc.) is void. Actual structure uses the existing
  `src/navigation/root-tabs.tsx` + screen files under
  `src/screens/`, extended with a sign-in screen and an auth
  gate.
- Google Sign-In integration (`@react-native-google-signin/
  google-signin`) and secure storage
  (`expo-secure-store`) land as dependencies; the sign-in
  screen is gated by a top-level `AuthProvider` component that
  wraps `RootTabs`. Not-authenticated → render sign-in; signed
  in → render the existing tab navigator.
- Zustand store pattern is kept (already established for
  operator-store). New `auth-store` slice lives alongside,
  following the same conventions.
- When `expo-router` matures enough to justify migration
  (e.g. deep file-system routing becomes load-bearing for SEO
  on a future web build), a dedicated ADR + migration PR
  revisits this decision. For Week 2 scope, decision stands.

References:

- Week 2 TZ Part 5.1 (treated as aspirational after this ADR).
- Earlier ADR *Incremental Upgrade Path For apps/desktop-agent
  And apps/mobile* (2026-04-24) — the same spirit applies to
  navigation-framework choice specifically.
- `apps/mobile/App.tsx` + `apps/mobile/src/navigation/root-tabs.tsx`
  (existing navigation wiring to extend, not replace).

## Canonical Cloud Build Flag Set For CI And Manual Deploy Parity

Date: 2026-04-24
Status: accepted

Decision:

- Every `gcloud builds submit` invocation that builds and
  deploys `operator-os-api` or `operator-os-auth-gateway` —
  whether from CI (`.github/workflows/cd-deploy.yml`) or from
  the manual scripts (`infra/scripts/deploy-api.ps1`,
  `infra/scripts/deploy-auth-gateway.ps1`) — must pass the same
  three flags:
  - `--service-account=projects/operator-os-dev/serviceAccounts/deploy-bot@operator-os-dev.iam.gserviceaccount.com`
  - `--gcs-source-staging-dir=gs://operator-os-dev-artifacts/cloud-build/source`
  - `--gcs-log-dir=gs://operator-os-dev-artifacts/cloud-build/logs`
- CI may reference the SA and project via secrets
  (`${{ secrets.GCP_PROJECT_ID }}`, `${{ secrets.GCP_SERVICE_ACCOUNT }}`);
  manual scripts reference them as script parameters with the
  same defaults.

Why:

- The first CD auto-deploy attempt (PR #20 workflow + PR #21
  smoke trigger) failed at `Submit Cloud Build` with
  `Permission 'storage.objects.get' denied` attributed to
  `1016254604177-compute@developer.gserviceaccount.com` — the
  default Compute Engine SA. Root cause: without
  `--service-account`, Cloud Build dispatches the source-
  upload and step-execution under that default SA, which was
  never granted Storage access to `operator-os-dev-artifacts`
  (only `deploy-bot` has the binding). The manual scripts
  have passed the right SA since first use; the CI workflow
  inadvertently dropped it.
- Without `--gcs-source-staging-dir`, `gcloud` auto-creates a
  staging bucket named `<project-id>_cloudbuild` on first use
  with default-restrictive IAM. The pre-created
  `operator-os-dev-artifacts` bucket already has the right
  bindings; using it avoids a dormant second staging bucket
  with an ambiguous ownership model.
- Without `--gcs-log-dir`, build logs end up in auto-created
  ephemeral buckets that the ops runbook in
  `docs/DEPLOY.md` does not reference. Pinning the log path
  makes post-mortem log retrieval deterministic.
- Parity between CI and manual deploys means any ops action
  that works from one surface works from the other. Reduces
  cognitive load: "I know how to redeploy api manually, so I
  know what CI is doing too."

Alternatives considered:

- **Grant the default Compute SA Storage access to the
  artifacts bucket.** Rejected. Widens the default SA's blast
  radius and normalizes using it for CI — the exact anti-
  pattern the `deploy-bot` least-privilege posture exists to
  prevent.
- **Use a different staging bucket per environment.**
  Rejected for now. One bucket per project is sufficient at
  current scale; adding per-env buckets is unnecessary
  complexity before there's a second environment to justify
  it.
- **Omit `--gcs-log-dir` and let Cloud Build default.**
  Rejected. Log locations drifting per-run makes incident
  review slow. Pinning aligns with the "predictable ops
  surface" LAW #5 posture.

Consequences:

- CI and manual deploys produce indistinguishable builds (same
  SA, same staging, same log retention). Any future deploy-
  path divergence surfaces as a policy violation by this ADR
  rather than a silent drift.
- When a new service is added (conductor, streamer, etc.), its
  cloudbuild + CI job must also carry these three flags. A
  short comment pointing at this ADR in each new
  `infra/cloudbuild/*.cloudbuild.yaml` file documents the
  requirement at the call site.
- The PR #20 CD workflow is amended in PR #22 (same day) to
  add the missing flags. PR #21 (first smoke test) becomes
  half-landed — it triggered the CD run but the run failed.
  A second smoke commit after PR #22 merges completes the
  verification.

References:

- Failed CD run: GitHub Actions run `24794863892`, both
  `deploy-api` and `deploy-auth-gateway` jobs failed at
  `Submit Cloud Build` step.
- Manual script precedent:
  `infra/scripts/deploy-api.ps1` lines ~40-49 and
  `infra/scripts/deploy-auth-gateway.ps1` lines ~45-55 — both
  have passed the three flags since first use.
- PR #20 — workflow landing without the flags (the bug).
- PR #22 — workflow amended to add the flags (this ADR's
  implementation commit).

## SPEC §61-66.7 Evolves To Match packages/contracts Implementation

Date: 2026-04-24
Status: accepted (supersedes nothing; refines the earlier
  "SPEC §61 Evolves To Match packages/contracts Implementation"
  ADR by attaching implementation-landed evidence)

Decision:

- `packages/contracts/src/ai/` lands in Week 2 Phase 1.3 (PR
  for TD-010) as the source of truth for the four Universal AI
  Platform interfaces: `AIAgent`, `FileSystemProvider`,
  `StreamProvider`, `CostProvider`.
- `docs/SPEC.md` §61-66.7 is updated in the same PR so the TS
  code blocks in the spec match the landed package exactly.
- The SPEC header version is bumped `1.0 → 1.1` with a
  provenance line; no other semantic changes land on the
  narrative.
- Per-agent entries in §63-66.7 (ClaudeCodeAgent, CodexAgent,
  CursorCLIAgent, …) retain their literal provider ids and
  capability lists — those data points remain accurate. Only
  the structural template in §62 (the headers the per-agent
  entries follow) is refreshed to name `providerId` instead of
  `id + vendor`.
- §27 Desktop Agent `ClaudeCodeAgent` reference implementation
  is rewritten to implement the v1.1 `AIAgent` shape end-to-end
  so a reader can see a concrete composition against the new
  contracts package, not against the PR #13 sketch.

Why (shape rationale):

Implementation practice revealed gaps in the PR #13 sketch that
the TZ Part 3.3 version repairs:

1. **Flat vs structured identity.** PR #13 AIAgent had flat
   `id`, `vendor`, `capabilities[]`. v1.1 groups them: stable
   fields in `identity` (persistent UUID, providerId,
   providerVersion, displayName, hostname, platform, arch),
   process-scoped state in `runtime` (pid, startedAt,
   uptimeSeconds), declarative description in `manifest`. The
   three triplets separate concerns that the flat model
   collapsed.
2. **Provider DI as fields.** v1.1 makes `fs`, `stream`, `cost`
   readonly fields on `AIAgent`. Concrete agents ship
   specialised providers (Cursor CLI scoped-sandbox FS, Ollama
   zero-cost CostProvider, etc.) and the registry decides
   which at construction time. PR #13 had no DI surface — the
   agent carried capability flags but not the providers it used.
3. **Execution model: polling `AIAgentTaskHandle`.** v1.1 returns
   a task handle with `status` transitions
   (pending/running/completed/failed/cancelled). PR #13 used
   `execute(task): Promise<AgentResult>` + a separate
   `stream(task): AsyncIterable<OutputChunk>`. Polling handles
   + a separate `StreamProvider` is a cleaner factorisation
   for long-running tasks; streaming is a concern owned by the
   StreamProvider, not hard-coded into the agent.
4. **`stop(reason)` enum.** v1.1 makes the stop reason
   explicit: `"user" | "shutdown" | "error"`. Distinct code
   paths (auto-update vs user quit vs crashloop handling) are
   visible at the call site. PR #13's `shutdown()` lost that.
5. **Narrowed Capability union.** v1.1 uses `AgentCapability`
   (narrow union) directly rather than `Capability[]`. Callers
   get exhaustiveness checks in switch statements on
   capabilities.
6. **FileSystemProviderScope.** v1.1 puts scope (`allowedRoots`,
   `readOnly`, size caps) on the provider explicitly, with
   `isPathAllowed` + `assertPathAllowed` as first-class methods.
   PR #13 had `rootPath` implicit and no size-cap surface.
7. **Discriminated-union `StreamEvent`.** v1.1 stream transports
   a discriminated union (token / delta / tool-call / progress
   / error / completion) rather than `OutputChunk`s with
   `stream: "stdout" | "stderr" | "meta"`. The new shape lets
   the backend and mobile UI do exhaustive switches with
   compile-time safety.
8. **Cost estimate / enforce / record split.** v1.1 separates
   `estimateCost(request)` (used before task dispatch by the
   router for cost-optimal routing), `enforceBudget(userId,
   estimatedCostUsd)` (throws `BudgetExceededError` if the ask
   would blow the budget), and `recordUsage(record)` (after
   task completion, idempotent on taskId+model). PR #13 had
   only `recordUsage` + `estimate` + `getPricing`, no budget
   enforcement surface.

Source-of-truth hierarchy (unchanged from earlier):
session instruction > SPEC > RULES > CLAUDE.md > other docs.
A live TZ / session instruction can evolve the SPEC, as this
ADR records.

Alternatives considered:

- **Implement to PR #13 shape and accept drift.** Rejected
  earlier (in the same-day "SPEC §61 Evolves" ADR) and rejected
  again: drift violates LAW #5 at the doc layer and creates
  two contracts of record where consumers must guess which is
  authoritative.
- **Keep v1.0 SPEC visible and overlay v1.1 in a separate
  document.** Rejected. Doubles the maintenance surface; a
  future editor would have to remember to cross-update both.
  Single source of truth wins.
- **Full rewrite of SPEC §61-66.7 + §27 including the prose.**
  Rejected as scope creep. The v1.0 prose is well-written; only
  the TS code blocks and the immediate explanatory sentences
  (field names) needed to change.

Consequences:

- PR landing the contracts package also carries ~480 lines of
  SPEC edit (insert + delete, not pure insert). The diff is
  larger than a typical docs PR but delivers a single coherent
  evolution.
- Future agents (CodexAgent, CursorCLIAgent, OllamaAgent,
  GeminiCLIAgent, LMStudioAgent, ChatGPTDesktopAgent,
  CopilotWorkspaceAgent, CustomAgent) implement the v1.1 shape
  directly — no reconciliation step, no second migration pass.
- The six `.test.ts` files under
  `packages/contracts/src/ai/__tests__/` are the compile-time
  enforcement mechanism for the SPEC. Any attempt to drift the
  contracts package away from SPEC (or vice versa) surfaces as
  a CI failure. See the sibling ADR "Type-Level Tests Are The
  Contract Enforcement Mechanism For packages/contracts".

References:

- Earlier same-day ADR *SPEC §61 Evolves To Match
  packages/contracts Implementation* (intent-only; this ADR
  adds landed-implementation evidence).
- Week 2 TZ Phase 1.3 Part 3.3 (target shapes source).
- `packages/contracts/src/ai/ai-agent.ts` + sibling files
  (source of truth).
- PR #13 SHA `8fdfbb8` (historical record of the v1.0 shape).

## Type-Level Tests Are The Contract Enforcement Mechanism For packages/contracts

Date: 2026-04-24
Status: accepted

Decision:

- Every exported interface in `packages/contracts/src/ai/` has
  a corresponding test file under
  `packages/contracts/src/ai/__tests__/` with `expectTypeOf`
  assertions exercising the interface's full shape: every
  property type, every method signature, every discriminated-
  union variant, every narrow-union member.
- Each exported error class gets runtime tests verifying
  `instanceof`, the stable error `code` string, the `retriable`
  flag default, the `details` object shape, and the class
  `name` for ergonomic error-boundary handling.
- Test file naming: `<interface-module>.test.ts` (not
  `.test-d.ts`). Vitest's default include glob
  (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) matches `.test.ts` but
  not `.test-d.ts`; the `expectTypeOf` assertions run fine from
  regular `.test.ts` files.
- Tests live alongside the source (`__tests__/` subdir) rather
  than in a separate `test/` tree so that moving an interface
  file is a one-operation refactor.

Why:

- **Compile-time contract enforcement.** Runtime tests cannot
  catch "a field's type changed from `readonly string[]` to
  `string[]`", or "a method's return type changed from
  `Promise<Handle>` to `Handle`", or "the narrow-union
  `AIAgentState` gained a new variant nobody updated the
  switch for". Type-level tests do. CI fails before the bad
  change lands in a consuming package.
- **No runtime cost.** `expectTypeOf` produces zero JavaScript
  output. The assertions run at `tsc` time via type narrowing.
  Test runtime is ms.
- **Drift detection for SPEC.** The SPEC §61-66.7 TS code
  blocks are expected to match
  `packages/contracts/src/ai/*.ts`. If a maintainer changes
  one side without the other, the `.test.ts` files around the
  changed interface stop compiling and CI catches the drift.
- **Discoverability.** A new contributor reading
  `ai-agent.test.ts` sees the full contract shape in one file
  of assertions — better onboarding than reading 20 scattered
  usage sites.

Coverage target: 100% property coverage on every exported
interface — every property and method signature gets at least
one assertion. Discriminated unions get full-variant coverage
(all 6 variants of `StreamEvent`, both members of
`encoding: "utf-8" | "base64"`, all 4 `AIAgentState` states,
etc.). Error classes: full constructor path coverage including
default-retriable, `details` shape, `cause` propagation,
`name`.

Alternatives considered:

- **Use `tsd` instead of vitest `expectTypeOf`.** Rejected. The
  repo already runs vitest across every workspace; adding a
  second type-test runner doubles CI time and splits the
  "where does a test live" mental model. vitest's
  `expectTypeOf` covers the same surface with zero extra
  tooling.
- **Runtime-only testing of interfaces via sample
  implementations.** Rejected. Interfaces have no runtime
  representation; the only way to guarantee they mean what they
  say is compile-time assertion. Runtime mocks testing behaviour
  is an orthogonal and complementary kind of test — lives in
  consuming packages (apps/desktop-agent, apps/api), not in
  `packages/contracts`.
- **Only test surface on PR review (human eyeballs).**
  Rejected. Drifts slip in when reviewers aren't watching for
  them. A CI gate is mechanical and reliable.

Consequences:

- PR landing the AI contracts carries 90 new tests (across 6
  files) on top of the 23 existing contract tests, bringing
  `packages/contracts` to 113 tests and the repo total from
  71 → 161.
- Every future field addition to an AI interface gets a
  corresponding `expectTypeOf` line in the associated test
  file. Convention is owned by whoever touches the interface;
  reviewers check for it.
- When TD-010 closes and TD-020 stays wontfix, the pattern
  extends to any future agent-related interface (e.g. future
  `AgentRegistry`, `TaskDispatcher` shapes): new interface
  file `foo.ts` lands with a sibling `__tests__/foo.test.ts`.
- The pattern is specific to `packages/contracts`. Apps that
  consume contracts (api, auth-gateway, desktop-agent, mobile)
  use regular behavioural tests — type-level enforcement
  belongs upstream at the contract layer where it prevents
  wrong types from ever reaching consumers.

References:

- `packages/contracts/src/ai/__tests__/` (the 6 test files
  landed alongside the interfaces).
- Vitest `expectTypeOf` docs:
  https://vitest.dev/api/expect-typeof.html
- Sibling ADR *SPEC §61-66.7 Evolves To Match
  packages/contracts Implementation* (the evolution this
  testing convention guards).

## Desktop Agent Phase 1.4 Uses Incremental Migration, Not Rewrite

Decided: 2026-04-24 (Week 2 Phase 1.4, Gate 1.4.B approval)

Decision:

- Land Universal AI agents, providers, registry, and additive
  heartbeat **alongside** the existing 13 files under
  `apps/desktop-agent/src/` rather than in a parallel
  `apps/desktop-agent-next/` tree that swaps in at the end.

Why:

- The existing runtime (HeartbeatLoop, CommandPoller,
  SessionManager, ExportManager, SafeCommandExecutor, Notifier)
  already talks to the api on production endpoints that mobile
  + api expect to continue working. A greenfield rewrite means
  every one of those integration points becomes a fresh
  integration bug at cutover time.
- A parallel package would also need its own ci + deploy
  plumbing (Docker build, signing, worker pool wiring) just
  to run an in-progress refactor. That's meaningful cost for
  no user-visible benefit during phase 1.4.
- The new layer is **additive**: AgentRegistry + agents +
  AgentHeartbeatLoop bolt onto `DesktopRuntime` through new
  constructor branches and new getters. The device-state
  heartbeat keeps posting to the legacy endpoint; the
  agent-centric heartbeat posts to a new endpoint (TD-024)
  that doesn't yet exist, so backoff is the worst that
  happens until the api side lands.
- Testing is easier with the incremental path: 11 existing
  test files kept passing across every commit (c1..c14),
  which means a bisect against any regression shows exactly
  which addition caused it. A big-bang switch hides that.

Alternatives considered:

- **Parallel `apps/desktop-agent-next/` tree with cutover PR.**
  Rejected on cost + risk grounds described above.
- **Rip-and-replace: delete `HeartbeatLoop`, wire the new
  `AgentHeartbeatLoop` to post both schemas to the same
  endpoint.** Rejected — the mobile + api expectations are
  already frozen around the device-state shape. Deferring a
  schema consolidation until the api grows an
  `/v1/agent/heartbeat/agent` endpoint and both sides handle
  both shapes keeps the migration boring.
- **Code freeze on the existing runtime until Phase 1.5.**
  Rejected — it blocks shipping agent work for zero benefit
  and makes the cutover PR huge.

Consequences:

- The repository now contains two live heartbeat loops that
  serve different shapes. Documented in the "Agent Heartbeat
  Schema Is Additive" ADR (older dated entry). The
  concurrency is bounded: once TD-024 closes and mobile +
  api converge on a single shape, the older loop retires
  (tracked as TD-024's completion criterion).
- `DesktopRuntime` grew a phase-1.4-specific section with
  three new fields (`#agentRegistry`, `#agents`,
  `#agentHeartbeatLoop`) and two new exposed getters
  (`agents`, `agentRegistry`). The incremental approach
  accepts that the class is temporarily larger in exchange
  for simpler diffs at each step.
- 11 additional test files (provider triad + registry pair +
  claude-code-agent + heartbeat + runtime-bootstrap) sit
  side-by-side with the legacy `runtime.test.ts`. The legacy
  test stays in place until the modules it covers retire.

References:

- `apps/desktop-agent/src/runtime.ts` — the concrete wiring.
- Sibling ADR *Agent Heartbeat Schema Is Additive, Not
  Replacement* (2026-04-24) — the same rationale applied to
  the heartbeat wire format specifically.

## Desktop Agent Validates Heartbeat Payloads At Runtime

Decided: 2026-04-24 (Week 2 Phase 1.4, Gate 1.4.B approval)

Decision:

- Parse every outbound `AgentHeartbeatRequest` body through
  `agentHeartbeatRequestSchema` before it is posted, and every
  inbound response body through `agentHeartbeatResponseSchema`
  before it is acted on.

Why:

- The heartbeat body is assembled from `AIAgent.getStatus()` +
  identity + runtime state. Any of those sources can drift
  (a future `providerVersion` change, a new health-check key,
  a typo in a field rename) and a drift shows up at the api
  as a generic 400. Catching drift at the producer means
  better log context and a local stack trace.
- The heartbeat endpoint doesn't exist yet (TD-024); during
  the interim, the loop is particularly sensitive to gateway
  proxies returning HTML error pages. Zod-parsing the inbound
  body rejects "200 with an HTML page that looks like a login
  redirect" — which would otherwise be a false-positive
  success — and counts it as a failure, so the backoff +
  degraded-state machinery still protects the agent.
- Runtime validation is the repo's existing pattern at every
  I/O boundary (`apps/api` uses Zod on every body + query,
  `packages/contracts` colocates Zod schemas with type
  exports). The desktop agent is currently the one place
  where outbound bodies leave without a parse step; this
  closes that gap for the new heartbeat path specifically.
- Cost is negligible: the heartbeat body has eight fields,
  posted at most once per `HEARTBEAT_INTERVAL_MS` per
  registered agent. No hot path is affected.

Alternatives considered:

- **Trust TypeScript types and skip the parse.** Rejected —
  types are erased at runtime, and the failure mode when a
  drift slips is "server returns 400 with no useful context".
  The amount of time saved by skipping the parse is dwarfed
  by the debugging time saved when drift is caught locally.
- **Parse outbound only; trust inbound.** Rejected — the
  inbound path carries server-issued commands
  (`pause`/`resume`/`shutdown`/`update-config`). Acting on
  an unvalidated command shape is a trust-boundary violation;
  even while those commands are logged-only in phase 1.4,
  the validation guard lands now so removing it later is a
  visible change, not a silent one.
- **Parse only in dev / log a warning in prod.** Rejected —
  the failure mode (agent acts on a malformed server command
  and self-destructs) is too consequential to gate on a build
  flag. The cost of production parsing is zero in practice.

Consequences:

- `AgentHeartbeatLoop.#emitFor` throws on malformed
  out-or-inbound bodies, which the outer `try/catch` folds
  into the standard failure path (backoff + threshold
  transitions). No special-case code was added — the same
  threshold logic that handles a 500 handles a drift.
- A new health-check key added to `AIAgent.getStatus()`
  flows through the heartbeat automatically as long as it
  fits the `healthChecks: Record<string, 'ok'|'warn'|'fail'>`
  shape. If a future agent needs to report a new status
  value (e.g. `'unknown'`), the schema enum and both ends
  update together — caught in PR review by a failing test.
- Tests exercise the drift path explicitly ("counts a
  malformed response body as a failure"), so the guard is
  load-bearing rather than cosmetic.

References:

- `apps/desktop-agent/src/heartbeat/agent-heartbeat-loop.ts`
  — the two `schema.parse(...)` call sites.
- `packages/contracts/src/agent/heartbeat.ts` — the schemas
  being applied.
- Sibling ADR *Agent Heartbeat Schema Is Additive, Not
  Replacement* (2026-04-24) — explains why the loop exists
  at all.

## Mobile Phase 1.5 Adds Auth Alongside, Does Not Rewrite Navigation

Decided: 2026-04-24 (Week 2 Phase 1.5, Gate 1.5.A approval)

Decision:

- Keep the existing 5-tab bottom navigator, all five screens
  (Home / Devices / Sessions / Costs / Settings), the
  `useOperatorStore`, the theme tokens, and every component
  under `apps/mobile/src/components/**` exactly as they are.
- Add a root-level native-stack (`RootNavigator`) that swaps
  between an `AuthLoadingScreen` / `SignInScreen` tree and the
  existing `RootTabs` tree based on `useAuthStore.status`.
- Auth-specific state lives in a *parallel* zustand store
  (`useAuthStore`) — not merged into `useOperatorStore`.
- Auth-specific services land under `src/services/` alongside
  the existing `api-client.ts` and `auth-session.ts` — no new
  top-level folder for auth-related HTTP.

Why:

- The mobile shell had a stable navigation + dashboard pattern
  (Days 1-3 bootstrap) that mobile + api both expect to keep
  working. Rewriting the tab shell into an auth-aware
  architecture would create a migration the api side cannot
  observe and cannot validate against.
- A parallel `useAuthStore` stays cleanly loose-coupled. The
  dashboard store keeps its mock + controlled-fallback
  semantics; the auth store owns the session state machine.
  Nothing in either store reads the other's fields — the
  render layer composes them.
- Auth services under `src/services/` means the only layering
  decision is "what do you talk to" (auth-gateway vs main api),
  not "where does this kind of thing live". Consistent with the
  already-established pattern.
- The root native-stack is additive: existing screens get the
  same props and same store shape. A user who is already
  authenticated sees zero visual difference from the pre-
  Phase-1.5 app on launch.

Alternatives considered:

- **Merge auth state into `useOperatorStore`.** Rejected. The
  dashboard store has a complex controlled-fallback lifecycle;
  conflating it with session state would make every store
  update conditional on "are we even signed in", which is a
  concern the auth-store owns. Parallel stores are the cleaner
  separation.
- **Put auth services under a new `src/auth-services/` folder.**
  Rejected. The existing `src/services/` is small (two files)
  and the new auth files are the same kind of thing — typed
  HTTP wrappers with Zod-parsed responses. Splitting would
  suggest a category difference that does not exist.
- **Rewrite `RootTabs` to know about auth and render a
  conditional sign-in modal inside itself.** Rejected. That
  pushes auth concerns into the tab shell, which currently has
  no idea what auth even is. Root-level navigation keeps the
  tab shell ignorant of auth in exactly the same way
  `NavigationContainer` is.

Consequences:

- `apps/mobile/App.tsx` changed by two lines (swap
  `RootTabs` → `RootNavigator` import + usage). Every other
  existing file under `apps/mobile/src/` is untouched.
- `useAuthStore` + `useOperatorStore` coexist; future code
  that needs both (e.g. a "show sign-out" Settings tab entry)
  subscribes to both without ceremony.
- `RootNavigator` uses React Navigation v7's "registered
  screens change" behaviour — when `status` flips, the old
  stack unmounts and the new one mounts fresh. No manual
  `navigation.reset()` plumbing is needed.
- When the dashboard API eventually requires a bearer token,
  `services/api-client.ts` can swap its `fetch` for
  `createAuthenticatedFetch(deps)` without changing its own
  surface — the wrapper's type is `typeof fetch`.

References:

- `apps/mobile/App.tsx` — the two-line wiring.
- `apps/mobile/src/navigation/root-navigator.tsx` — the
  conditional stack.
- `apps/mobile/src/state/auth-store.ts` — the parallel store.

## Mobile SignInScreen Tests Target The Extracted Hook, Not Rendered Tree

Decided: 2026-04-24 (Week 2 Phase 1.5, Gate 1.5.C ambiguity
response — Option B)

Decision:

- Extract `SignInScreen`'s behaviour into a pure `performSignIn`
  orchestrator (async function) plus a thin `useSignInHandlers`
  React hook.
- Extract every error-code → user-copy mapping into
  `sign-in-copy.ts` (`errorCopy`, `signInErrorFor`).
- Test `performSignIn` + the copy helpers directly under
  vitest (11 cases). `SignInScreen.tsx` stays a dumb render
  shell; its behaviour is covered by the extracted tests, not
  by a rendered-tree test.
- Do **not** add `@testing-library/react-native` to the
  mobile workspace.

Context:

- Phase 1.5 TZ Part 1.7 asked for RN Testing Library tests on
  `SignInScreen`. Attempting this surfaced a concrete
  compatibility problem: `@testing-library/react-native`
  transitively imports `react-native` source, which contains
  Flow syntax (e.g. `import {typeof X} from '...'`). Vitest's
  esbuild transform does not strip Flow, so *any* test file
  that transitively imports `react-native` fails during module
  resolution with `SyntaxError: Unexpected token 'typeof'`.
  Zero tests actually run.

Why Option B (extract + test the hook):

- Every branch the rendered test would have covered —
  happy-path idToken flow, cancelled picker, play-services-
  unavailable, other GoogleSignInError codes, signInWith…
  rejection with / without a typed code, "previous error
  cleared before new attempt" — lives in `performSignIn` as
  pure orchestration. Moving it out of the component makes
  it unit-testable under vitest with zero new deps.
- `sign-in-screen.tsx` reduces to <140 LOC of JSX + styles
  that are strictly composition (hook output → Pressable +
  error banner + conditional spinner). The rendering surface
  is thin enough that a style regression would be caught by
  manual QA on device; a behaviour regression would surface
  in the hook tests.
- No new deps, no new config. Matches the existing mobile
  pattern — `operator-store.test.ts` tests the store, not
  consuming screens.

Alternatives considered:

- **(A) Configure vitest to strip Flow syntax.** Rejected.
  Would need a babel transform chain, `@babel/preset-flow`,
  and per-file resolver hints — ~1-2 hours of tuning for a
  fragile result that future React Native version bumps would
  likely break again. Industry-documented pain point.
- **(C) Skip `SignInScreen` testing entirely.** Rejected. The
  sign-in entry point is the one screen where a regression
  would be most visible to a user and most expensive to
  recover from. Hook-level coverage is a much better fit than
  "manual QA only".

Consequences:

- `apps/mobile/src/screens/auth/` contains three source
  modules: `sign-in-copy.ts` (pure), `use-sign-in-handlers.ts`
  (orchestrator + hook), `sign-in-screen.tsx` (render shell).
  11 tests land alongside in `__tests__/`.
- testIDs (`sign-in-screen`, `sign-in-button`, `error-banner`,
  `loading-spinner`, `sign-in-config-note`, plus `auth-
  loading-screen`) are in place so a future E2E layer
  (Detox/Maestro) can assert against them without another
  refactor.
- Two transient dev-deps (`@testing-library/react-native`,
  `react-test-renderer`) were added during Option A
  exploration and removed immediately — lockfile is clean.
- The pattern generalises: any future mobile screen with
  non-trivial behaviour should extract a testable orchestrator
  (or custom hook) rather than pull in the RN-testing tool
  chain. If the RN + vitest + Flow interplay is ever resolved
  upstream, revisit.

References:

- `apps/mobile/src/screens/auth/sign-in-copy.ts`
- `apps/mobile/src/screens/auth/use-sign-in-handlers.ts`
- `apps/mobile/src/screens/auth/__tests__/use-sign-in-handlers.test.ts`
- Sibling ADR *Mobile Phase 1.5 Adds Auth Alongside…*
  (2026-04-24) for the broader "keep existing navigation
  intact" rationale.

## Agent Heartbeat v2 Ships As A New Endpoint, Not A Modified One

Decided: 2026-04-24 (Week 2 Phase 2)

Decision:

- Add a new `POST /v1/agent/heartbeat/agent` to the api that
  accepts `agentHeartbeatRequestSchema`.
- Leave the existing `POST /v1/agent/heartbeat` accepting
  `deviceStateSchema` completely unchanged. Both endpoints
  coexist indefinitely; the older one retires only after every
  client migrates to v2.

Why:

- The Desktop Agent's `AgentHeartbeatLoop` (Phase 1.4) already
  posts to `/v1/agent/heartbeat/agent`. It has been hitting
  404s since 1.4 merged; the 404s are backoff-absorbed and do
  not break anything else. Adding the endpoint closes the
  gap without any coordination dance.
- The older `/v1/agent/heartbeat` still serves existing
  clients (legacy device-state flow on mobile / any older
  desktop-agent that never redeployed). A single endpoint that
  accepts both shapes via discriminator would make the route
  handler gnarlier than two narrow ones.
- Additive matches the pattern the Phase 1.3
  *Agent Heartbeat Schema Is Additive, Not Replacement* ADR
  established: we do not rewrite wire contracts in place; we
  add the next shape alongside and let clients roll forward.

Alternatives considered:

- **Modify the existing endpoint to accept both shapes.**
  Rejected. Dispatch-on-discriminator adds branching to a hot
  path for zero forward-compat benefit, and accidentally
  forwards a bug to every legacy client when the shared
  handler changes.
- **Silent upgrade — keep the same URL, let the Zod schema do
  the union.** Rejected. The error surface becomes impossible
  to reason about ("which schema did it fail?").

Consequences:

- Two Firestore collections now: existing `deviceStates`
  (behind the old endpoint) and new `agentHeartbeats`. TTL
  policy on `agentHeartbeats.receivedAt` (7 days) is a manual
  Firestore Console step — documented in the PR body and in a
  code comment next to the accessor.
- A 5-second-per-agent in-memory rate limiter shields the new
  endpoint from a runaway agent. Single-instance MVP; the
  related *WS Sessions In-Memory* ADR tracks the multi-instance
  migration.
- The retirement path for the old endpoint: when
  `DeviceState.runtimeStatus` telemetry shows every connected
  device-class is posting to v2, file a TD to sunset the
  v1 route.

References:

- `apps/api/src/routes/agent.ts` — both endpoints live side by side.
- `apps/api/src/integrations/firestore.ts` — `recordAgentHeartbeat`.
- `packages/contracts/src/agent/heartbeat.ts` — schemas.
- Sibling ADR *Agent Heartbeat Schema Is Additive, Not
  Replacement* (2026-04-24).

## Cost Records Persist In Firestore, Pricing Table Lives In Code

Decided: 2026-04-24 (Week 2 Phase 2)

Decision:

- `cost_records` and `user_budgets` go to Firestore collections.
- The (providerId, model) → per-1M-token pricing table lives
  in `apps/api/src/services/cost.ts` as a module-level
  `PRICING_TABLE` constant. Price updates ship as code
  deploys, not as DB writes.

Why:

- Pricing is a small, rarely-changing, high-read surface.
  Every `POST /v1/cost/estimate` and every `POST /v1/cost/record`
  needs the table. Keeping it in code means zero DB round-trips
  per cost call and a single source of truth that code review
  sees.
- Cost records are the opposite profile — high-cardinality
  append-only writes keyed by user + task. Firestore's
  composite indexes on `(userId, timestamp)` and
  `(userId, providerId, timestamp)` give cheap range reads
  for the spending report endpoints, which is what the table
  would fight against.
- Price changes through code reviews catch the case where the
  wrong number lands (we see the diff). Price changes through
  the DB would require audit tooling we do not have.
- `user_budgets` is a low-volume override for enterprise /
  custom tiers. Firestore doc-per-user is the right shape —
  reads are keyed, writes are rare.

Alternatives considered:

- **Pricing in Firestore, cached in memory.** Rejected.
  Adds an initialization step (cache warm on boot) and
  a consistency question (stale cache vs. DB); for no real
  benefit versus "change in code, ship a deploy". Google and
  Anthropic publish pricing as blog posts, not via an API
  our app could poll.
- **Pricing and records both in code.** Rejected. Records
  are per-user / per-task; stuffing them in memory would mean
  no history survives a restart. Firestore is the right
  persistence.
- **Pricing and records both in Firestore.** Rejected for
  the same reasons pricing-in-Firestore is rejected; combining
  them just compounds the issue.

Consequences:

- A new pricing entry requires a deploy. Acceptable cadence
  — we add agents quarterly, not daily.
- `computeActualCost` runs on every `/v1/cost/record` to
  sanity-check the agent-reported number. Within $0.01 of the
  server's recompute → accepted; otherwise server overrides.
  Protects against a misconfigured agent inflating user spend
  without rejecting honest float drift.
- Firestore composite indexes on `costRecords` are a manual
  Console step; PR body enumerates them.
- Enterprise admin UI to edit `user_budgets` docs is future
  work — tracked as TD-025.

References:

- `apps/api/src/services/cost.ts` — PRICING_TABLE + PLAN_BUDGETS.
- `apps/api/src/integrations/firestore.ts` — `recordCostUsage`,
  `listCostRecordsForUser`, `getUserBudget`, `setUserBudget`.
- `apps/api/src/routes/cost.ts` — endpoint composition + $0.01
  trust window.

## Agent WebSocket Sessions Are In-Memory (MVP); Redis Coordination Is A Future TD

Decided: 2026-04-24 (Week 2 Phase 2)

Decision:

- The `AgentSessionRegistry` is a two-Map (by sessionId + by
  agentId) in-process structure tied to a single Fastify
  instance. No shared state across api replicas.
- On a duplicate-agentId connect, the registry closes the
  prior socket with close code 4004 ("duplicate-agent") and
  replaces it with the new one.

Why:

- Today's api runs as a single Cloud Run revision serving all
  traffic. There is one in-process registry, and that is the
  source of truth. Zero coordination cost, zero network
  round-trip per session touch.
- Scaling to multi-instance needs either session affinity
  (Cloud Run sticky mode) or a shared store — both are
  non-trivial changes we are not paying for pre-scale.
- Agents handle their own reconnection via exponential
  backoff (Phase 1.4 `AgentHeartbeatLoop`'s design). A rolling
  deploy drops sessions, agents reconnect, the new instance's
  registry picks them up. No coordination required.
- In-memory rate-limiting for heartbeat v2 shares the same
  trade-off and benefits from the same assumption — one
  instance, one Map.

Alternatives considered:

- **Redis-backed registry from day one.** Rejected. ~2h of
  wiring (`ioredis`, connection pool, TTL policy on session
  keys, recovery on Redis outage) for zero user-visible
  benefit while we are single-instance.
- **Cloud Run session affinity.** Rejected *for now*. It is
  a mode we can enable in minutes, but it changes load
  distribution characteristics; worth doing at the same time
  we have a reason to scale horizontally.
- **Fire-and-forget sessions (no close on duplicate).**
  Rejected. Without the prior-close, two agents with the
  same id would both register, and a later task-assign would
  arrive at whichever socket was mapped last. Harder to
  reason about than "one agentId, one session".

Consequences:

- When we go multi-instance, the migration is contained:
  replace `createAgentSessionRegistry()` with a Redis-backed
  implementation behind the same interface. Route handler
  + heartbeat code stay put.
- Duplicate-agent e2e tests are flaky under
  `@fastify/websocket`'s `injectWS` (the 4004 close racing
  with the plugin's message delivery). The registry behaviour
  is unit-tested directly; the e2e layer only asserts the
  handshake path.

References:

- `apps/api/src/services/agent-session-registry.ts` — the two-Map
  implementation.
- `apps/api/src/routes/agent-ws.ts` — wire-up + close-codes.
- `apps/desktop-agent/src/heartbeat/agent-heartbeat-loop.ts` —
  exponential backoff makes reconnection tolerant of
  single-instance restarts.

## Task Lifecycle + Retention Posture (Option B — 30 Days)

Decided: 2026-04-24 (Week 3 Phase 3.1, Gate 3.1.A)

Status: Accepted

### Context

Phase 3.1 persists user task submissions to Firestore. The
`TaskRecord.prompt` field carries the raw user-authored text,
which can contain sensitive content (API keys, PII, internal
codebase snippets). The `output` field carries the agent's
response, which inherits the same sensitivity through
reference. Before landing code that writes these fields,
Gate 3.1.A required an explicit retention posture decision
(Red Flag #1).

Three retention windows were surfaced:

  A. Persist indefinitely — keep task history forever unless
     user requests deletion.
  B. Persist with a fixed 30-day TTL — auto-delete on that
     schedule; user-initiated deletion is a future TD.
  C. Ephemeral — store only a hash + length of prompts;
     keep outputs briefly for UI replay, discard after
     completion.

### Decision

**Option B.** Every TaskRecord is written with a
server-computed `expireAt = createdAt + 30 days`. Firestore
TTL policy is applied on the `expireAt` field (not on
`createdAt` — see the TD-026 pitfall from Phase 2's
`agentHeartbeats` — TTL fires when the named field has
passed "now", so the field MUST hold the expiry timestamp,
not the creation timestamp). Documents are auto-deleted by
Google's TTL service within ~24 h of their `expireAt`.

### Consequences

Positive
- Bounded storage footprint — predictable cost, no unbounded
  growth.
- GDPR-practical — reduced blast radius; most regulatory
  frameworks accept a 30-day retention default.
- Aligns with industry norm (OpenAI, Anthropic, Stripe, Vercel
  all default ~30d for prompt / event logs).
- UX-sufficient for MVP — users work with recent tasks (last
  week is typical); a 30-day window covers weekly retrospective
  + reopen/iterate use cases.
- Simpler ops — nothing to vacuum, nothing to archive, no
  stale-index problems at the 30-day mark.

Negative
- History loss at 30 days. Beyond-30-day access requires a
  future export feature (TD tracked outside this phase).
- Manual Firestore Console TTL step per environment — listed
  in the PR #33 body so the first deploy to a new env doesn't
  silently skip it.
- No user-initiated deletion path at 3.1 — a privacy request
  between 0-30 days today has no endpoint; TD-028 fixes.

Mitigations
- TD-028 (user-initiated deletion, P2) closes the 0-30-day
  gap. Planned for Week 4.
- Logs never carry `prompt` or `output` content — only
  metadata (`promptLength`, `taskId`, `userId`). Deliberate
  constraint in POST /v1/tasks handler; verified in c6.
- A follow-up ADR + TD can raise the window (to 90d / 180d)
  if enterprise customer demand appears. The mechanism is
  trivial — change `TASK_RETENTION_DAYS` + re-run migration
  to set `expireAt` on pre-existing rows.

### Alternatives considered

Option A — persist indefinitely
- Pros: preserves full history; zero "where did my task go"
  support tickets.
- Cons: unbounded GDPR liability; storage cost grows linearly
  with usage; every new compliance regime (EU AI Act, CCPA
  expansions) re-opens the retention question; audit burden
  grows.
- Rejected. Indefinite persistence turns every user's
  prompt into a permanent record we must defend against a
  future breach. Not a posture we want to ship MVP with.

Option C — ephemeral / hash-only
- Pros: smallest possible retention surface; "we never stored
  your prompt" story is regulator-friendly.
- Cons: Phase 3.2 task redispatch needs the prompt if the
  assigned agent goes offline mid-dispatch — storing a hash
  would force us to keep the prompt somewhere anyway (e.g.
  Pub/Sub message payload, which has its own retention). UI
  history becomes useless; every resubmit is a re-type.
  Debugging user reports ("why did my task fail?") becomes
  vastly harder with no prompt echo available.
- Rejected. Ephemeral wins on privacy but breaks Phase 3.2
  redispatch and most of the Phase 3.3 UX.

Per-user custom retention (premature-generalisation alt)
- Rejected. No enterprise customer has asked for it yet.
  When one does, it grows as an override on `user_budgets`-
  style pattern (already in place from Phase 2 cost). No
  design lock-in today.

### Implementation

- `TaskRecord.expireAt: isoTimestampSchema` — required field
  in `packages/contracts/src/ai/task.ts` (c1).
- `POST /v1/tasks` computes `expireAt = now + 30 days` at
  submission time (`TASK_RETENTION_MS` constant in
  `apps/api/src/routes/tasks.ts`, c6).
- Manual Firestore Console step: TTL policy on
  `tasks.expireAt`. No offset — the policy uses the field
  value as the absolute expiry timestamp. Listed in PR #33
  body.

### References

- `packages/contracts/src/ai/task.ts` — schema
- `apps/api/src/routes/tasks.ts` — expireAt computation at
  write
- Sibling ADR *Idempotency — In-Memory LRU With Firestore
  Fallback* (2026-04-24) for the other Phase 3.1 lock-in.
- TD-026 (Phase 2 heartbeat TTL pitfall) — the reason
  `expireAt` holds the absolute timestamp, not an offset.
- TD-028 (user-initiated task deletion, P2) for the 0-30-day
  privacy gap.

## Idempotency — In-Memory LRU With Firestore Fallback

Decided: 2026-04-24 (Week 3 Phase 3.1, Gate 3.1.A)

Status: Accepted

### Context

POST /v1/tasks must be idempotent. Mobile clients retry on
flaky networks; users double-tap the submit button; the same
client-supplied `idempotencyKey` (UUID v4) arrives multiple
times. Two submits with the same `(userId, idempotencyKey)`
within a reasonable window must resolve to the same taskId
and return the same response shape.

Phase 3.1 Red Flag #2 makes this a hard architectural
constraint: "Every task dispatch must have at-least-once
delivery + idempotency key + deduplication." The design
question is where the dedup lives.

### Decision

Two-layer check on every POST:

1. **In-memory LRU cache** (`IdempotencyCache` service) —
   keyed by `${userId}:${idempotencyKey}`. 24-hour TTL,
   10 000-entry cap. Authoritative inside a single Fastify
   instance; first-lookup path, sub-millisecond.
2. **Firestore fallback query** via
   `FirestoreOperatorRepository.findTaskByIdempotencyKey`
   on a composite index `(idempotencyKey ASC, userId ASC,
   createdAt DESC)` — runs only on cache miss. Recovers
   replay semantics after a Fastify-instance restart (cold
   cache). Replay is only honoured when the Firestore hit
   is less than 24 h old; older matches fall through to a
   fresh taskId (same semantic as cache expiry).

Cache is written AFTER a successful Firestore record. A
thrown exception during `recordTask` leaves the cache
untouched so a retry can write fresh.

### Consequences

Positive
- Fast path: most replays in a process are cache hits.
- Recovery: cache warms lazily from Firestore on cold miss
  via the fallback query.
- No new infrastructure — in-memory only.
- Same architectural pattern as the Phase 2 heartbeat v2
  rate limiter — single design vocabulary across the api.

Negative
- Single-Fastify-instance scope. Two api replicas don't share
  cache state, so a concurrent identical submit routed to
  different replicas can briefly pass both cache layers and
  produce two `taskId`s (last write wins at Firestore).
  Rare in practice — same client rarely submits to two
  replicas concurrently — but not zero.
- No hard uniqueness guarantee. Firestore doesn't support
  unique constraints at write time; a truly atomic "check
  + write" would require a transactional read-modify-write
  which adds per-request latency.

Mitigations
- TD-027 (Redis-backed cache, P3) tracks the multi-instance
  migration. Same `IdempotencyCache` interface; the
  implementation swap is mechanical.
- The composite index on
  `(idempotencyKey, userId, createdAt DESC)` gives us a
  rebuild path AND a dedup reconciliation query if we ever
  want to post-hoc merge duplicates.

### Alternatives considered

Redis-backed cache from day one
- Pros: shared across api instances; survives restart
  without the Firestore fallback hop.
- Cons: new infrastructure (Memorystore), new operational
  surface (Redis outage = submit broken), new deploy
  complexity (VPC connector, Memorystore instance), extra
  cost (~$25/month minimum for Memorystore basic tier) for
  no user-visible benefit while we're single-instance.
- Rejected for MVP. TD-027 captures the trigger — switch
  when we go multi-instance.

Firestore-only (no cache layer)
- Pros: no state in the api process; automatically correct
  across restart + multi-instance.
- Cons: every POST does a Firestore read before the write.
  Cost at scale (two operations per submit vs one); latency
  cold path (~50-100ms vs sub-ms cache hit); doesn't
  solve the concurrent-race (still needs a transaction).
- Rejected. The common path — user submits, no replay — is
  the path we should optimise. Fallback query covers the
  cold case without paying on every request.

Client-only idempotency (HTTP 409 on conflict)
- Pros: no server-side state.
- Cons: forces every mobile client to handle the 409 flow,
  including stale clients that forget. Not actually
  idempotent — it's conflict detection, not dedup.
- Rejected. The spec calls for idempotency (same response
  on replay), not conflict detection.

Firestore transactional read-modify-write
- Pros: strict atomicity at write time; no concurrent-race
  window.
- Cons: serialises submits per user; Firestore transactions
  have per-document contention limits; complexity for a
  rare edge case.
- Rejected for MVP. Can layer over the current design
  later if the race becomes user-visible.

### Implementation

- `apps/api/src/services/idempotency-cache.ts` (c4): LRU
  via Map insertion-order + delete-and-reinsert on hit;
  lazy sweep of expired entries before eviction; injectable
  clock.
- `apps/api/src/integrations/firestore.ts`
  `findTaskByIdempotencyKey(userId, idempotencyKey)` (c3):
  Firestore fallback query.
- `apps/api/src/routes/tasks.ts` POST /v1/tasks (c6): the
  two-layer check + cache-after-success discipline.
- Composite index `(idempotencyKey ASC, userId ASC,
  createdAt DESC)` — manual Console step listed in the
  PR #33 body.

### References

- c4 / c5 for cache impl + tests.
- Sibling ADR *Task Lifecycle + Retention Posture* (2026-04-24)
  — the other Phase 3.1 architectural lock-in.
- TD-027 (Redis-backed cache, P3) for the multi-instance
  migration path.

## Task Dispatch — Pub/Sub Push + Cloud Tasks Retry (Phase 3.2)

### Context

Phase 3.1 landed POST /v1/tasks, which persists a TaskRecord in
Firestore. Phase 3.2 must carry that record to an actual agent:
find a matching agent by capability, send the task over the
WebSocket control channel, and retry with backoff when no agent
is currently available. Two non-functional constraints shape the
design:

1. Dispatch must tolerate an api instance restart between POST
   and agent-assignment (durability).
2. Dispatch must support delayed retry when no agent matches
   — the agent may be seconds away from connecting.

### Decision

Two complementary Google Cloud primitives, each handling one
responsibility:

- **Pub/Sub push subscription** — immediate dispatch. POST /v1/tasks
  publishes `{taskId, attempt: 1}` to `task-dispatch-${ENV}` after
  the Firestore write. Pub/Sub delivers the message to
  `/v1/internal/pubsub/task-dispatch`, which resolves to the real
  DispatchHandler (router → sendTaskAssign → state).

- **Cloud Tasks queue** — delayed retry. When the router finds no
  matching agent, DispatchHandler schedules a Cloud Tasks HTTP
  task targeting `/v1/internal/tasks/retry-dispatch` with a 30-
  second delay (configurable). That callback re-enters
  DispatchHandler with `attempt += 1`. Exhausting 5 attempts fans
  out to the DLQ topic and marks the task failed.

Both receivers share the same DispatchHandler, so the
orchestration logic has one implementation. The receivers are
composed in `app.ts`; the route layer stays thin.

### Consequences

Positive
- Low-latency happy path (Pub/Sub push ≈ 50-200ms end-to-end) for
  the common case of an already-connected agent.
- Durable dispatch: Pub/Sub retains the message until ACKed, so an
  api crash mid-dispatch does not lose the task.
- Backoff for free: Cloud Tasks handles scheduling + retry
  counting on our behalf; we do not roll our own scheduler loop.
- DLQ topic gives us ops visibility on exhausted tasks without
  inventing a new persistence schema.

Negative
- Two moving parts instead of one. Push semantics + delayed retry
  have subtly different retry policies (Pub/Sub has its own
  retry-on-nack; Cloud Tasks has its own max-attempts). The
  invariant — "at most 5 total dispatch attempts across both
  paths" — is enforced by the app-level counter, not by the
  infra.
- Attempt counter lives in the Pub/Sub envelope, not in the
  TaskRecord. A re-dispatch triggered by a task-rejected WS frame
  restarts the counter at 1 (Phase 3.3 TD to unify).
- Google region asymmetry. Pub/Sub is global; Cloud Tasks is
  regional. Retry queue pinned to europe-west4 (same as api); Phase
  2 legacy queues in europe-west1 stay there (TD-034).

Mitigations
- Stop rule #2 enforced via route-level no-op on redelivery (c8
  test pins it): the route does not mutate Firestore twice for a
  redelivered message; the DispatchHandler's state transitions
  are idempotent in practice (updateTask is a merge).
- TD-032 (dispatch monitoring, P3) tracks adding a Cloud Monitoring
  dashboard for task-dispatch-dev + dlq topics + retry queue so
  exhaustion trends are visible.

### Alternatives considered

Cloud Tasks alone (no Pub/Sub)
- Pros: one infra primitive; unified retry policy; simpler mental
  model.
- Cons: Cloud Tasks minimum delay is 1 second, so even a
  "zero-delay" dispatch burns 1s latency on the happy path. We'd
  be paying a fixed tax for the common case to simplify the
  uncommon one.
- Rejected.

Pub/Sub alone (no Cloud Tasks)
- Pros: single infra primitive.
- Cons: Pub/Sub's retry backoff is subscription-scoped and blunt
  (exponential with a global min/max). Delaying one specific
  message for exactly 30 seconds requires either (a) publishing
  the task with a server-side delay hack (Pub/Sub does not
  support that natively) or (b) writing a scheduler loop in the
  api, which is exactly what Cloud Tasks is.
- Rejected.

BullMQ / Redis-backed queue (self-hosted)
- Pros: fine control over retry + delay semantics; powerful
  features (priority, rate limits).
- Cons: stop rule #7 — new top-level dependency (ioredis + BullMQ)
  and new infrastructure (Memorystore). Self-host operational
  burden for no MVP benefit.
- Rejected. TD-031 stores the scaling trigger for Redis.

Direct WS dispatch from POST /v1/tasks (no queue)
- Pros: simplest possible pipeline.
- Cons: if the api instance crashes between the Firestore write
  and sendTaskAssign, the task is lost. No durability. No
  backoff. No multi-instance story.
- Rejected.

temporal.io workflows
- Pros: industrial-strength orchestration; exact semantics.
- Cons: heavy new runtime, new operational model, new skill
  surface. Massive overkill for a 3-step dispatch.
- Rejected.

### Implementation

- `apps/api/src/services/task-dispatch-publisher.ts` (c3) —
  publishes to the dispatch + DLQ topics. Record-only fallback
  when ADC absent.
- `apps/api/src/services/task-retry-scheduler.ts` (c11) — creates
  Cloud Tasks HTTP tasks with OIDC auth, pinned europe-west4.
- `apps/api/src/routes/internal-tasks.ts` (c7) — Pub/Sub push
  receiver + Cloud Tasks callback route handlers, both
  OIDC-guarded.
- `apps/api/src/app.ts` (c13) — real DispatchHandler composition
  (router + scheduler + publisher + firestore.updateTask).
- `apps/api/scripts/create-pubsub-topics.sh` +
  `create-cloud-tasks-queue.sh` (c18) — idempotent provisioning.

### References

- Sibling Phase 3.2 ADRs: *Internal Route Authentication — Google
  OIDC ID Token*, *Capability Matching — Subset Rule + In-Memory
  Round-Robin*.
- TD-031 (Redis round-robin), TD-032 (dispatch monitoring),
  TD-034 (Cloud Tasks region unification).

## Internal Route Authentication — Google OIDC ID Token (Phase 3.2)

### Context

Phase 3.2 adds three api routes that are NOT user-facing:

- `POST /v1/internal/pubsub/task-dispatch` — Pub/Sub push
- `POST /v1/internal/pubsub/task-dlq` — DLQ push
- `POST /v1/internal/tasks/retry-dispatch` — Cloud Tasks callback

These are invoked by Google-managed services (Pub/Sub push
identity, Cloud Tasks). Without authentication, they are a
public DDoS surface — any unauthenticated POST could spoof a
dispatch event. Stop rule #8 makes this a hard constraint: "No
Pub/Sub push target without OIDC auth."

### Decision

Each internal route is guarded by a Fastify preHandler that:

1. Extracts a Bearer token from the `Authorization` header.
2. Verifies it via `google-auth-library`'s `OAuth2Client.verifyIdToken`
   with `audience = PUBSUB_PUSH_AUDIENCE` (the api URL). This
   library handles JWKS fetching + caching + rotation transparently.
3. Asserts the payload's `iss`, `email_verified`, `email` claims
   and the `aud` matches explicitly (belt-and-suspenders over the
   lib's internal audience check).
4. Consults an `allowedEmails` set — in Phase 3.2 populated with
   `{CLOUD_RUN_SERVICE_ACCOUNT}`, because the Pub/Sub push identity
   and the Cloud Tasks invoker are both configured to be that one
   runtime SA.

Rejection matrix: missing/malformed token → 401, verification
failure → 401, email not in allowlist → 403. On success the
route sees `request.oidcIdentity` with the verified subject +
email + audience.

### Consequences

Positive
- No static secrets. OIDC tokens rotate automatically; SA
  identity is verifiable.
- Google-managed JWKS endpoint — no key management on our side.
- Aligns with Cloud Run's native auth model, so the same identity
  that invokes the service passes the app-layer check.

Negative
- Library dependency (`google-auth-library` is already in use by
  `apps/api/src/integrations/auth.ts`, so no new dep added).
- Local dev friction — developers need to mint an OIDC token via
  `gcloud auth print-identity-token --audiences=<api-url>` before
  probing the internal routes manually. Documented in
  `docs/flows/end-to-end-task-flow.md`.
- Separate verifier file (`apps/api/src/middleware/
  google-oidc-verifier.ts`) duplicates some logic from
  `integrations/auth.ts`. TD-036 tracks consolidation.

Mitigations
- `apps/api/src/app.ts` gates route registration on
  `config.PUBSUB_PUSH_AUDIENCE`. Dev environments without the
  audience set simply do not register the routes — this is
  different from registering-without-auth, so stop rule #8 holds.

### Alternatives considered

Shared-secret header (static API key)
- Pros: simplest possible auth; easy to test.
- Cons: static secret must be rotated manually; no SA-level
  identity; leaks in logs/env are permanent until rotation.
- Rejected.

Custom HS256 JWT issued by the api
- Pros: reuse the existing user JWT machinery.
- Cons: we would be re-implementing OIDC without Google's SA
  identity model; the api would need to run its own JWKS; Cloud
  Tasks + Pub/Sub don't know how to mint our custom JWT — they
  issue Google-signed OIDC tokens natively.
- Rejected.

VPC-only network isolation
- Pros: no token verification; traffic has to come through the
  VPC.
- Cons: Cloud Run ingress does not selectively gate Pub/Sub
  service traffic by VPC — Pub/Sub push comes from Google's
  managed edge, not a VPC we control. VPC-only would also block
  our local dev probes.
- Rejected.

Signed URLs on the push subscription
- Pros: no token verification.
- Cons: Pub/Sub push does not support signed-URL authentication.
- Rejected as not supported.

mTLS
- Pros: origin identity cryptographically bound.
- Cons: Cloud Run terminates TLS at the edge; no mTLS-to-origin.
- Rejected as not supported.

### Implementation

- `apps/api/src/middleware/google-oidc-verifier.ts` (c5) —
  `GoogleOidcVerifier` class + `createGoogleOidcGuard`
  preHandler. Test seam via `oauthClient?` injection.
- `apps/api/src/routes/internal-tasks.ts` (c7) — all 3 new
  routes declare `{preHandler: oidcGuard}`.
- `apps/api/src/app.ts` (c7/c13) — verifier constructed inside
  the `if (config.PUBSUB_PUSH_AUDIENCE)` block; absence skips
  route registration entirely.

### References

- Sibling Phase 3.2 ADR *Task Dispatch — Pub/Sub Push + Cloud
  Tasks Retry*.
- TD-036 (OIDC verification paths consolidation).

## Capability Matching — Subset Rule + In-Memory Round-Robin (Phase 3.2)

### Context

Phase 3.2 dispatch must pick an agent for a given task. Tasks
declare `capabilities: string[]` (user-visible requirements —
code-generation, planning, shell-execution, …). Agents declare
`manifest.capabilities: CapabilityDescriptor[]` at WS hello
time. The router bridges the two.

Three design choices are intertwined: what counts as a match,
how to pick one among multiple matches, and where the selection
state lives.

### Decision

**Match rule** — subset: `task.capabilities ⊆ agent.capabilities`.
An agent matches when every required capability is declared in
its manifest; the agent may have more.

**Selection** — per-bucket round-robin. The "bucket key" is a
canonical form of the required set: sorted, deduped, joined by
`|`. Two tasks whose requirements are equal under set semantics
share a cursor; the router advances the cursor on each call so
consecutive identical requests route to different agents.

**State** — in-memory `Map<bucketKey, lastIdx>` inside the
`TaskRouter` instance. No Firestore writes from the router.

**Candidate ordering** — stable-sorted by `sessionId` before the
cursor is applied. Phase 2's `AgentSessionRegistry.list()` does
not contractually guarantee iteration order; explicit sort makes
round-robin deterministic.

### Consequences

Positive
- Simple mental model: "same requirements → next agent in line."
- No cross-request state in a shared store for MVP — no new
  infrastructure.
- Works correctly for the common cases: one matching agent, many
  matching agents with identical capabilities, overlapping buckets.
- Empty required set matches any agent — useful for dispatcher
  testing and for a future "any available worker" task type.

Negative
- Multi-instance unfairness. Two api replicas each maintain their
  own cursor; the same bucket can over-pick one agent if another
  agent was already at the tail of the other replica's rotation.
  Stop rule #10 bans Firestore-backed cursors; TD-031 tracks the
  Redis migration trigger.
- Round-robin is oblivious to agent load, cost, reliability, or
  latency. Every matching agent is treated identically. TD-033
  tracks weighted reliability scoring.
- Cursor is lost on api restart. Fresh cursor starts at the first
  agent in sorted order. Marginal unfairness that self-corrects
  over one round.

Mitigations
- Phase 3.2 is single-instance by design; the fairness problem
  does not exist today.
- TD-031 (Redis round-robin) + TD-033 (reliability scoring)
  stored as P3. Promotion to P1 when multi-instance or observed
  hot-spot.

### Alternatives considered

Set equality (`task.capabilities === agent.capabilities`)
- Pros: unambiguous match semantics.
- Cons: over-restrictive — a task needing only `code-generation`
  would fail to match an agent that supports
  `{code-generation, planning, tool-use}`. Starves specialist
  agents and makes fleet composition brittle.
- Rejected.

Random selection among matches
- Pros: simplest possible implementation; no state.
- Cons: statistical imbalance under low agent count; hot-spot
  risk (same agent can get 3 consecutive identical tasks); harder
  to reason about in tests.
- Rejected.

Weighted by agent success rate / reliability
- Pros: gracefully degrades around flaky agents.
- Cons: requires historical telemetry we don't have at Phase 3.2.
  Introduces a feedback loop that is subtle to tune.
- Deferred. TD-033.

Redis-backed cursor from day one
- Pros: coherent rotation across api replicas.
- Cons: new infrastructure (Memorystore), new operational
  surface, cost (~$25/month minimum), no MVP benefit while
  single-instance.
- Deferred. TD-031 captures the trigger.

Agent pull model (agents claim tasks from a queue)
- Pros: dispersed state; naturally load-balanced; no central
  selection.
- Cons: harder to observe (no single place to see which agent
  owns a task); weaker ordering guarantees; fundamentally
  different architecture from the Phase 2 WS control-channel
  decision.
- Rejected as scope change.

### Implementation

- `packages/contracts/src/ai/agent-manifest-schema.ts` (c9) —
  runtime Zod mirror of the AgentCapability union + loose
  manifest schema (`.passthrough()`).
- `apps/api/src/services/task-router.ts` (c9) — `createTaskRouter`
  factory with subset match, bucket-keyed cursors, stable-sorted
  candidates, malformed-manifest exclusion.
- `apps/api/src/routes/agent-ws.ts` (c13) — manifest validation
  on hello; malformed manifest → `close 4002 manifest-invalid`
  before the session reaches the router.
- `apps/desktop-agent/src/providers/control-channel-ws.ts` (c15)
  — agent-side defense-in-depth capability filter before the
  executor sees a task-assign.

### References

- Sibling Phase 3.2 ADRs: *Task Dispatch — Pub/Sub Push + Cloud
  Tasks Retry*, *Internal Route Authentication — Google OIDC
  ID Token*.
- TD-031 (Redis round-robin), TD-033 (reliability scoring).

## Mobile-To-Api Streaming — SSE (Phase 3.3)

### Context

Phase 3.3 needs server-to-mobile streaming so the user sees live
agent output as it is produced. Phase 3.2 already runs a
WebSocket between the api and the desktop-agent (control channel
+ task dispatch); the question is whether to reuse that protocol
for the mobile → api leg or pick something new.

The mobile leg is one-directional (server → client) once the
task is submitted, and the client is on a battery-constrained
device behind possibly-flaky networks. Cloud Run terminates HTTP
requests at 60 minutes; long-running streams have to handle that
boundary explicitly.

### Decision

Server-Sent Events (SSE) for the mobile → api streaming leg.

The api emits frames over `GET /v1/tasks/:taskId/stream` with the
standard `id:` / `event:` / `data:` lines. The client uses
`@microsoft/fetch-event-source` (DP-1) so it can attach a Bearer
token — the EventSource standard does not allow custom headers,
which makes it unusable with our auth model.

The bus → SSE handler in `apps/api/src/routes/tasks.ts` is the
seam: it subscribes to `taskEventBus`, replays the
Firestore-recorded deltas above the inbound `Last-Event-ID`, then
forwards live events. Heartbeat comment frames go out every 25s
(DP-3) so the Cloud Run idle timer never triggers mid-stream.

### Consequences

Positive
- One-way streaming → simpler client. The library is ~200 LOC
  and reconnects automatically on ECONNRESET.
- Last-Event-ID is the standard SSE resume mechanism. Our `seq`
  numbering doubles as the resume cursor, so reconnect = "skip
  what you already have, replay the rest."
- HTTP semantics: bearer auth, CORS, proxies, cloud Run
  observability — all work without special handling.
- The bus boundary is symmetric with the agent → api WS leg.
  Both feed `taskEventBus` and never know about each other.

Negative
- Cloud Run 60-minute hard limit. Streams that exceed that
  window need a client-driven reconnect (we pre-emptively
  reconnect at 55 min). The c14 sse-client wrapper handles
  this transparently.
- `EventSource` doesn't carry a Bearer header, so we add a
  third-party library (`@microsoft/fetch-event-source`). One
  more npm dep on the mobile side. TD-043 tracks the
  consolidation when the RN ecosystem catches up.
- 401 mid-stream needs a 4th close reason (`reauth-needed`)
  beyond the SSE library's natural `server-end | fatal |
  aborted` so the screen can rotate the bearer and reconnect
  with the same `Last-Event-ID`. Documented in the c14
  wrapper.
- In-memory event bus → multi-instance replay would lose
  subscribers. TD-041 tracks the Redis migration trigger.

### Alternatives considered

WebSocket (the agent ↔ api protocol)
- Pros: bidirectional already in the codebase; one transport
  pattern across all surfaces; no Cloud Run timeout (well,
  same limit applies).
- Cons: bidirectional is overkill for the mobile read leg.
  Reconnect state management is more complex than SSE's
  Last-Event-ID. Auth handshake involves a custom subprotocol
  or query-param bearer (CORS-fragile in browsers; Expo Web
  hits this).
- Rejected: simpler protocol matches simpler requirement; the
  overlap with the agent leg isn't worth the extra surface.

Long polling (`GET /v1/tasks/:taskId/output?since=<seq>`)
- Pros: trivial protocol; works on every HTTP client; no
  special server primitives.
- Cons: latency is bounded below by the poll interval. At a
  1-second poll, token-by-token streaming feels janky. At
  100ms polling, the request rate kills mobile battery and
  doubles the api QPS.
- Rejected: latency unacceptable for the live-token UX.

gRPC server streaming
- Pros: strongly typed; multiplexed; the server-streaming RPC
  primitive matches our use case exactly.
- Cons: React Native ecosystem support for gRPC-Web is
  fragile (no expo-managed package); adds a second transport
  stack on the mobile side; tooling isn't where SSE/WebSocket
  tooling is.
- Rejected: ecosystem maturity gap.

HTTP/2 server push
- Pros: standard; multiplexed.
- Cons: client APIs are limited (browsers + RN don't expose
  push streams to user code in a usable way); Cloud Run edge
  support is uneven; the standard is effectively dead in
  browser-land.
- Rejected: client-side support gap.

### Implementation

- `apps/api/src/services/task-event-bus.ts` (c1) — in-memory
  fan-out bus.
- `apps/api/src/routes/tasks.ts` (c3) — `reply.hijack()` SSE
  handler with backpressure-safe writeQueue, heartbeat ticker,
  and Firestore replay above Last-Event-ID.
- `apps/api/src/app.ts` (c5) — task-callback bridge from the
  agent-ws layer into the bus.
- `apps/mobile/src/services/sse-client.ts` (c14) —
  `connectSse()` wrapper over `@microsoft/fetch-event-source`
  with the `'reauth-needed'` close reason for mid-stream
  bearer rotation.
- `apps/mobile/src/screens/task-stream-screen.tsx` (c14) —
  drives connect / reconnect / Last-Event-ID forwarding from
  store state.
- `packages/contracts/src/ai/task-stream.ts` (c17) — single
  source of truth for the on-the-wire frame shape.

### References

- DP-1: `@microsoft/fetch-event-source ^2.0.1`.
- DP-2: in-memory event bus (TD-041 multi-instance migration).
- DP-3: 25s heartbeat (Cloud Run 60-min boundary).
- TD-041 (multi-instance event bus), TD-042 (Last-Event-ID
  replay caching), TD-043 (mobile SSE polyfill consolidation).

## ClaudeCodeAgent Integration — Phase 1.4 + Thin Adapter (Phase 3.3)

### Context

Phase 3.3 must turn the dispatch pipeline (Phase 3.2 — task lands
on an agent) into actual model output. The desktop-agent already
ships a `ClaudeCodeAgent` from Phase 1.4 that subprocess-spawns
the `claude` CLI via execa, with a state machine, capability
manifest, cost estimation, and a passing test suite. The choice
is whether to use that, or to introduce a different execution
strategy now.

### Decision

Use the existing Phase 1.4 `ClaudeCodeAgent` behind a thin
TaskExecutor adapter. The adapter (~280 LOC) bridges the
`AIAgent.executeTask` interface to the `ControlChannelWs`
`TaskExecutor` interface that Phase 3.2 expects. The only
addition to Phase 1.4 is a single public `awaitSettled()` method
already present on the agent (no behaviour change, just exposure).

A `CapturingStreamProvider` slots in front of the agent's
existing `StreamProvider` contract: when the agent emits via
`StreamProvider.createStream(...)`, the capture provider forwards
each chunk to the WS task-delta sender for that task. No edits to
Phase 1.4's emit path.

A `DESKTOP_AGENT_EXECUTOR` env flag lets the dev / test
environments fall back to an echo stub when no Anthropic API key
is present, keeping the unit-test cycle independent of network +
CLI install.

### Consequences

Positive
- Phase 1.4 is already battle-tested. Re-using it preserves
  the spawn / state-machine / capability work and keeps the
  Phase 3.3 diff focused on integration.
- The adapter is mechanical mapping. The risky moving parts
  (subprocess, streaming, error normalization) stay in the
  Phase 1.4 layer where they have unit coverage.
- Echo-stub fallback decouples the test path from the real
  Anthropic dependency. CI / dev never need an API key.
- Phase 1.4's StreamProvider abstraction was designed for
  capture-style integration — the c7 adapter slot was a
  prediction Phase 1.4 made.

Negative
- Subprocess overhead per task (spawn + claude CLI startup ≈
  300-800ms cold). Acceptable for MVP — most user-perceived
  latency is the model itself.
- Anthropic API key lives on the agent host, not on the api
  side. Provisioning is a desktop concern (`.env` file), which
  is fine for the operator-owned desktop architecture but
  shifts the secret to the user's machine.
- The Phase 1.4 contract surfaces a non-trivial `executeTask`
  interface (manifest, capability descriptors, cost provider).
  The adapter has to fabricate plausible defaults for fields
  the dispatch layer doesn't know about (e.g., providerId).

### Alternatives considered

Embedded SDK call (`@anthropic-ai/sdk` directly from the agent)
- Pros: no subprocess; first-class TypeScript types; tool-use
  orchestration is server-controlled.
- Cons: re-implements what the `claude` CLI already does
  (file I/O sandboxing, MCP server orchestration,
  conversation state). Loses the operator's expectation that
  the agent uses the same `claude` they use interactively.
- Rejected: feature regression vs Phase 1.4.

REST direct call (skip the CLI; call the Anthropic API directly
from the api server)
- Pros: simplest dependency tree on the agent host (no CLI
  install).
- Cons: contradicts the operator-owned architecture — the
  whole point of the desktop agent is that the *user's
  machine* runs the agent and holds the API key. Cloud-side
  execution turns the project into a SaaS proxy.
- Rejected: violates trust model.

WASM-bundled `claude`
- Pros: a single binary cross-platform; no install step.
- Cons: doesn't exist; not actionable; would require Anthropic
  to publish a WASM build of the CLI.
- Rejected: not actionable.

Cloud-side execution (Cloud Run runs `claude`)
- Pros: scalable; no local agent.
- Cons: the API key would have to live in Cloud Run's secret
  manager; the operator no longer owns execution; latency
  goes up by one extra hop; the Phase 1 architectural
  premise (operator's local box runs the agent) is violated.
- Rejected: contradicts the project model.

### Implementation

- `apps/desktop-agent/src/agents/claude-code-agent/
  task-executor-adapter.ts` (c7) — `CapturingStreamProvider` +
  `createClaudeCodeAgentExecutor` factory.
- `apps/desktop-agent/src/agents/claude-code-agent/
  __tests__/task-executor-adapter.test.ts` (c8) — 6 tests for
  the adapter.
- `apps/desktop-agent/src/main.ts` (c9) —
  `DESKTOP_AGENT_EXECUTOR` env flag with `claude-code` default
  and `echo-stub` fallback. Top-level await constructs the
  executor with `NodeFileSystemProvider` + `ApiCostProvider` +
  `CapturingStreamProvider`.

### References

- Phase 1.4 ADR: *Desktop Agent Phase 1.4 Uses Incremental
  Migration, Not Rewrite*.
- TD-044 (future agent execution control hooks — cancel /
  pause / resume).

## Mobile State Management — Zustand (Phase 3.3 Confirmation)

### Context

Phase 1.5 chose Zustand for `useAuthStore`. Phase 3.3 adds
`useTaskStore` (Phase 3.3 c10) and `useOperatorStore` was added
earlier. Re-confirming Zustand for the new store happens at this
gate so the choice is documented for the next contributor and so
any pivot to RTK / Riverpod / Jotai is a deliberate decision
rather than drift.

### Decision

Zustand for all mobile state stores. New stores follow the
auth-store pattern: `createXxxStore(deps)` factory that the test
exercises directly, plus a default singleton at the bottom of
the module wired against the production deps.

### Consequences

Positive
- One mental model across stores. Auth, operator, and task
  stores share idioms (selectors, factory shape, singleton
  wiring).
- Tiny bundle (~1 kB gzipped) — important on Expo's bridge.
- Hooks-friendly with no provider wrapping. Components select
  with `useStore(s => s.field)` and re-render only on the
  selected slice.
- The factory + singleton split is testable. Tests build
  isolated stores via `createTaskStore({...})`; production
  uses the wired singleton.

Negative
- Singleton wiring at module top-level pulls react-native-only
  modules (`expo-secure-store`, `@react-native-google-signin`)
  through tokenStorage and the auth-store import chain. Test
  files have to `vi.mock(...)` those modules at the top of the
  file, which is one more thing to remember. The c12-fix
  commit (729a762) is the canonical example.
- No built-in middleware ecosystem like Redux Toolkit.
  Time-travel debugging, persistence, optimistic updates etc.
  are user-built. We have not needed any of these at MVP scale.

### Alternatives considered

Redux Toolkit
- Pros: time-travel debug; RTK Query for HTTP caching;
  enormous ecosystem; great DevTools.
- Cons: more boilerplate (`createSlice`, action creators,
  reducers); the auth-store work would have to be migrated;
  the boilerplate vs Zustand is real.
- Rejected: the existing Zustand store is the precedent and
  the boilerplate cost isn't justified at MVP.

Riverpod (or any DI-flavoured provider library)
- Pros: provider scoping; explicit dependency injection;
  excellent for medium / large apps.
- Cons: requires migration of the existing stores; steeper
  learning curve for contributors who know Redux/Zustand;
  ecosystem on RN is smaller than Zustand's.
- Rejected: migration cost without clear MVP benefit.

`React.Context` + `useReducer`
- Pros: zero deps; native React; sufficient for tiny apps.
- Cons: re-render perf at scale (no selector model); manual
  memoization; worse DX than Zustand selectors. Not enough
  ceiling for an app with auth + operator + task views.
- Rejected: insufficient for the medium-app posture.

Jotai
- Pros: atomic state; minimal API; reactive composition.
- Cons: different mental model from the existing Zustand
  stores; would create a mixed paradigm in the codebase.
- Rejected: consistency wins.

### Implementation

- `apps/mobile/src/state/auth-store.ts` (Phase 1.5) — original
  Zustand store + factory + singleton pattern.
- `apps/mobile/src/state/task-store.ts` (Phase 3.3 c10) —
  follows the same pattern. Tracks `submissionStatus`,
  per-task view models, delta-idempotent `appendDelta`,
  terminal `completeTask` / `failTask`.
- `apps/mobile/src/state/task-store.test.ts` — same vi.mock
  pattern as auth-store.test.ts so the singleton wiring
  doesn't crash vitest's rolldown parser on react-native's
  Flow-syntax index.

### References

- Phase 1.5 ADR: *Mobile Phase 1.5 Adds Auth Alongside, Does
  Not Rewrite Navigation*.
- c12-fix commit 729a762 — vi.mock pattern for stores that
  pull RN-only modules through their singleton.

## Mobile Auth For First APK Build — Real Google Sign-In (Phase 3.4)

### Context

Phase 3.4 produces the first installable APK of the Operator-OS
mobile shell and runs the first manual smoke test on a real
Android device. The Phase 1.5 + Phase 3.3 mobile code already
implements the full Google Sign-In path end-to-end (`SignInScreen`
→ `googleSignIn.signIn()` → `authClient.signin(idToken)` →
auth-gateway `/v1/auth/signin` → HS256 access + refresh tokens).
What's missing is the production-side wiring: the OAuth Web
Client ID provisioned in Google Cloud Console, registered as an
accepted audience in the gateway's `AUTH_ACCEPTED_GOOGLE_CLIENT_IDS`,
and the APK signing-key SHA-1 attached to that OAuth client.

Three options were on the table at Gate 3.4 (per Phase 3.4 Part 1
survey blockers B-4):

- **B.1 Real Google Sign-In** — provision the Web Client ID, do
  the two-pass build dance (build → capture EAS-managed signing
  SHA-1 → register → rebuild → auth works), test against the
  real auth path.
- **B.2 Dev mint shortcut** — patch the mobile temporarily with a
  hardcoded "Sign in (dev)" button that calls the auth-gateway's
  `/v1/dev/mint-test-token` (TD-045 / PR #36) and stores the
  returned operator-HS256 token. Bypasses Google entirely.
- **B.3 Hybrid** — keep real auth flow, fall back to dev mint
  button when `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is absent.

### Decision

**B.1 — Real Google Sign-In on first APK build.**

Provision the OAuth Web Client ID in `operator-os-dev` Google
Cloud Console; set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in
`apps/mobile/.env.production`; do two EAS builds (Pass 1 to learn
the signing SHA-1; register; Pass 2 to install on the device with
working sign-in).

### Rationale

Phase 3.4's value is verifying the mobile UX *as it will look to
real users*. The dev mint shortcut would only verify the
TaskSubmit / TaskStream rendering paths — important, but the
sign-in flow is the user's first interaction with the app and the
dominant Phase 1.5 deliverable. Skipping it means the first
real-device verification of sign-in slides to Phase 4+. A
verification we plan to do anyway is best done now while the
context is fresh, before more code lands on top.

The two-pass build dance is a known Android cost: every Android
OAuth client is keyed by package name + SHA-1. EAS-managed
signing produces the SHA-1 only on first build. Either we eat
the dance now or we eat it on the first user-facing build later.
Taking the hit now in Phase 3.4 means the rest of the project
runs on a known-working signing setup.

### Consequences

Positive
- The first manual smoke test exercises the production sign-in
  surface, not a dev-only impostor. The TaskSubmit / TaskStream
  flows that follow are tested by a session that came in via the
  same path a real user would.
- The OAuth Web Client ID provisioned now is durable: the same
  client ID covers the dev / preview / production EAS profiles.
  When Phase 4 lands a Play Store build with a different signing
  key, only the SHA-1 differs — the client ID stays.
- The gateway's `AUTH_ACCEPTED_GOOGLE_CLIENT_IDS` env var gets
  its first non-empty value, exercising a code path that has been
  dormant since Phase 1.5.

Negative
- Two EAS builds for the smoke test (~10-20 min each on EAS's
  free tier), versus one build with B.2.
- The provisioning involves a manual click-through in Google
  Cloud Console: create OAuth client → name → add SHA-1 → add
  package name. Must be done by Akmal on his account; cannot be
  automated from this side. The TZ Operations Notes section
  (Phase 3.4 Part 8 R23++) documents the exact clicks for
  reproducibility.
- The dev mint endpoint (TD-045 / PR #36) goes unused for this
  smoke. It will be exercised on the next smoke window when the
  real sign-in is the suspect being debugged.

Mitigations
- Operations notes in the Phase 3.4 R23++ report capture the
  clicks so the next time we add a build profile (or migrate to
  Play Store signing), the steps are documented.
- TD-053 candidate (filed if first smoke surfaces sign-in
  problems): "Mobile auth bootstrap script for new build
  profiles" — a script that prompts for the SHA-1 + package +
  client ID and adds the OAuth credential via gcloud where
  possible.

### Alternatives considered

B.2 — Dev mint shortcut
- Pros: zero Google Cloud Console work; one EAS build; lowest
  time-to-installable-APK.
- Cons: doesn't exercise the production sign-in path; adds a
  dev-only "Sign in (dev)" button that has to be removed before
  any real user touch the build. Forgetting that removal is a
  real risk.
- Rejected for Phase 3.4 first smoke. May be useful later when
  smoke-testing TaskSubmit/TaskStream UX without re-going
  through sign-in every time.

B.3 — Hybrid (real + dev mint fallback)
- Pros: keeps the dev escape hatch indefinitely.
- Cons: adds a code path to production builds that is
  intentionally insecure; an Android user who bypasses the
  Google flow could trick the app via env-var manipulation or
  reverse engineering. The blast radius is small (the dev mint
  endpoint is still gated server-side by `AUTH_DEV_MINT_ENABLED`
  on the gateway), but the principle of "no dev paths in
  production" is worth honouring.
- Rejected on the same "fewest-paths" principle.

### Implementation

- `apps/mobile/.env.production` (gitignored) — sets
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the value Akmal pastes
  after provisioning.
- `apps/mobile/eas.json` — `preview` profile with
  `buildType: apk`, `distribution: internal`, channel `preview`.
  EAS picks up `.env.production` automatically when
  `EAS_PROFILE=preview` is in the build invocation.
- `apps/mobile/app.json` — `android.package =
  "com.operatoros.app"`, `android.versionCode = 1`. The
  `extra.eas.projectId` is added by `eas init` on first run.
- Gateway env: `AUTH_ACCEPTED_GOOGLE_CLIENT_IDS` updated to
  include the new Web Client ID. Out-of-band update;
  `--update-env-vars` (TD-040 fix preserves other env vars).

### References

- Phase 1.5 ADR: *Mobile Phase 1.5 Adds Auth Alongside, Does
  Not Rewrite Navigation* — the original sign-in implementation.
- TD-045 / PR #36: dev mint endpoint (the alternative we
  rejected for first smoke, kept for future targeted testing).
- @react-native-google-signin/google-signin v13+ Credential
  Manager docs: webClientId + Android signing SHA-1 are the only
  required production-side configuration.

## Agent Productionization — Auth, Online Status, Startup, Legacy Sunset (Phase 4.0)

### Context

Phase 3.3 / Phase 3.4 / Phase 3.4.1 closed the mobile streaming
loop end-to-end: a real user signs in via Google, submits a task,
and watches a live SSE stream of Claude execution. The desktop
agent that does the actual execution, however, is still in
development posture per the Phase 4.0 Part 1 survey
(2026-04-27):

- The agent connects to the api WS using a one-hour user JWT
  pulled out of the mobile keychain (or, post-3.4.1, minted
  locally from the gateway signing secret). The token expires
  hourly. Manual refresh is required. PC reboot loses the
  process.
- The REST agent surface
  (`POST /v1/agent/heartbeat`, `POST /v1/agent/heartbeat/agent`,
  `GET /v1/agent/commands`) sends no `Authorization` header at
  all, so every tick currently fails with 401 (TD-056). Only
  the WS path is functionally wired.
- The Claude CLI on the host is already authenticated against
  the Max OAuth session
  (`~/.claude/.credentials.json` → `claudeAiOauth`). The
  subprocess the agent spawns inherits the parent process's
  env, so it picks up Max session OAuth automatically — but
  the dead `ANTHROPIC_API_KEY` line in the agent `.env` could
  silently switch behaviour if anyone ever passed `--bare`.
- The api's in-memory `AgentSessionRegistry` (per Phase 3.2 ADR
  *Agent WebSocket Sessions Are In-Memory*) means a Cloud Run
  cold-start or scale-to-zero loses every agent's session — for
  Phase 3 single-user dev that was acceptable, but always-on
  agents need durable identity.
- There is no Windows boot integration. Agent restart on PC
  reboot or crash requires a manual terminal session.

For a production-grade always-on agent we need: durable
identity, long-lived auth, hands-off boot integration, mobile-
visible online status, and a clear sunset path for the legacy
REST endpoints that nothing actually uses.

The Part 1 survey produced four decisions (D1–D4 below) and an
R12 halt for confirmation. Akmal confirmed all four with hard-
mode enhancements (rotation + audit + scoping for D1; trichotomy
+ Pub/Sub fan-out for D2; crash recovery + self-update for D3;
30-day deprecation window for D4).

### Decision

**D1 — Per-machine opaque token, registered once, stored in
Windows Credential Manager.**

- 32-byte random token, base64url encoded, presented as
  `Authorization: Bearer <token>` on every request (WS upgrade
  + REST).
- Server stores `bcrypt(token, cost=12)` in a new Firestore
  collection `agents/{agentId}` alongside the agent's user
  binding, machine name, capabilities, online state, and
  rotation metadata.
- Client stores the raw token in Windows Credential Manager
  under target `OperatorOS:agent-token` (DPAPI-protected per-
  user blob; no plaintext on disk).
- Bootstrap is a one-time CLI flow:
  `pnpm --filter desktop-agent register` — the agent prompts
  for a user JWT (paste from mobile or gateway sign-in), calls
  `POST /v1/agent/register`, stores the returned raw token,
  and self-tests by connecting the WS once.
- Rotation: server hints at rotation when the token's age
  crosses 30 days **or** its bcrypt-counter use-count crosses
  100K. Agent calls `POST /v1/agent/rotate-token` proactively;
  the old token stays valid for a 24h overlap window so a
  rolling fleet of agents never sees a transient 401.
- Audit: every auth event (success / failure / rotation /
  revocation) is appended to BigQuery dataset
  `operator_os_dev_audit.agent_auth` with timestamp + agent_id +
  event_type + ip + user_agent + success + latency_ms +
  optional error_code.
- Scoping: token claims include the agent's declared
  capabilities array; the server enforces per-action
  permissions on the WS task-assign path (an agent that only
  declared `code-generation` can't accept `shell-execution`).
- Revocation: user calls `DELETE /v1/agent/{id}` from the
  mobile UI; the server flips `revoked=true` in the Firestore
  doc, and the next auth check returns 401, which the agent
  treats as fatal-exit (user must re-register on the host).

**D2 — Online status is derived from the WS connection itself,
not a separate REST heartbeat.**

- The api sets `agents/{id}.online=true` and updates
  `lastConnectAt` on every successful WS welcome.
- The existing 30-second WS server-side ping (`agent-ws.ts:195`)
  doubles as the heartbeat: each pong updates
  `lastHeartbeatAt` in Firestore.
- WS close → `online=false`, `lastDisconnectAt` recorded,
  category captured (network / server / client / intentional).
- Mobile derives a trichotomy:
  - `online`     if `lastHeartbeatAt > now - 90s`
  - `degraded`   if online AND `p95(rtt_5min) > 200ms`
  - `offline`    if `lastHeartbeatAt < now - 90s`
- Cross-instance coordination: every Cloud Run instance writes
  to Firestore (single source of truth), and any state
  transition publishes a message to a new Pub/Sub topic
  `agent-status-changes` so the mobile app can subscribe via
  SSE for live updates instead of polling.
- The api provides `GET /v1/agent/list` (all agents owned by
  the user) and `GET /v1/agent/{id}/status` (single agent
  with RTT histogram). Mobile uses both.

**D3 — Windows Scheduled Task, triggered "at log on of any
user", restart-on-failure, runs as the user (NOT SYSTEM).**

- One scheduled task per machine, named `OperatorOS Agent`,
  registered via `schtasks /create /xml` from
  `scripts/install-agent-autostart.ps1`.
- Trigger: at log on of any user. Action: `powershell.exe
  -File %APPDATA%\operator-os\start-agent.ps1`.
- Restart on failure: 3 retries at 1-min intervals (built-in
  schtasks setting). On 10 consecutive failures the task
  disables auto-restart and writes a Windows Event Log entry.
- Run-as: the user account that installed it. SYSTEM is
  rejected because the Claude CLI's Max OAuth credentials
  live under the user's profile and SYSTEM cannot read them.
- Self-update: a daily-cron child step calls
  `GET /v1/agent/latest-version`; if a newer version is
  published, the agent downloads to a staging dir, verifies a
  detached signature against the public key bundled in the
  agent itself, swaps the binary, and rolls back if the new
  binary fails its post-swap health check.
- Logging: the wrapper script tees stdout/stderr to a daily-
  rotated file at `%APPDATA%\operator-os\logs\agent-
  YYYYMMDD.log`. Startup and crash events also go to the
  Windows Event Log under source `OperatorOS Agent`.

**D4 — Deprecate the legacy REST endpoints; the WS is the
single agent control surface.**

- Affected paths:
  - `POST /v1/agent/heartbeat`
  - `POST /v1/agent/heartbeat/agent`
  - `GET  /v1/agent/commands`
- Phase 4.0 ship: each route returns the standard deprecation
  trio of headers — `Deprecation: true`,
  `Sunset: 2026-05-25` (30 days from Phase 4.0 ship),
  `Link: </docs/MIGRATION-V4>; rel="deprecation"` — and
  records request count to the audit log so we can confirm
  zero-usage before sunset.
- Phase 4.1 (after `Sunset`): the routes return `410 Gone`
  with a body pointing at the WS. They stay routable for a
  further window so anyone with cached client code gets a
  clear error instead of a confusing 404.
- Phase 5+: routes removed entirely.
- Replacement: device state, command polling, and exports all
  fan in through the WS (`task-progress`, `task-delta`,
  `task-completed`, `task-failed` frames). Status reads happen
  via `GET /v1/agent/{id}/status` (read-only, user JWT auth).

### Rationale

Auth model (D1). Three options were on the table: long-lived
JWT, refresh-token rotation analogous to the mobile flow, and
opaque per-machine tokens. The opaque token wins on three
axes that matter more than its single weakness:

- *Revocation*. The mobile flow already has a refresh-token
  story, but revoking a single agent without affecting the
  user's mobile session means we'd need an agent-scoped
  refresh row and a per-row revocation list. With opaque
  tokens, "revoke" is a single `revoked=true` Firestore field
  flip. No JWT denylist, no key rotation cascading through
  the gateway.
- *Bootstrap simplicity*. A one-time `register` call followed
  by Credential Manager storage is a single onboarding step
  the user runs once per machine. Refresh-token rotation
  would need both the bootstrap *and* a working rotation
  loop, doubling the surface area where setup can fail.
- *Blast-radius story*. A leaked agent token only opens that
  one agent's permissions on that one user. A leaked user
  refresh token opens the entire mobile session. The agent
  permissions are also scoped (capabilities array in the
  Firestore doc), so an agent registered as `code-generation`
  only can't be used to e.g. read files even if the token
  leaks.

The single weakness — a Firestore lookup per auth — is
mitigated by a small in-process LRU cache (token-prefix → bcrypt
match) so repeated requests on a long-lived WS don't re-hit
Firestore. Bcrypt cost 12 means a fresh evaluation takes ~250
ms; cached evaluations are µs.

Online status (D2). A separate heartbeat REST endpoint adds an
endpoint, a schedule, and a code path to maintain — all to
report a fact the WS connection already proves continuously.
Deriving from the WS removes that surface, eliminates the
clock-skew window between "last heartbeat seen" and "WS
actually disconnected", and uses the existing 30-second ping
the api already sends. Pub/Sub fan-out lets the mobile see
state transitions in <1s instead of waiting for a 30s polling
cycle, which matters for the user experience of "is my agent
up?". The trichotomy (online / degraded / offline) gives the
mobile UI a meaningful "yellow" state instead of a binary
green/red, and the RTT data is useful operational telemetry.

Startup (D3). Scheduled Task is the only option compatible
with both auto-restart-on-crash *and* user-context (which is
required for the Claude CLI's OAuth). NSSM would force SYSTEM
context, breaking the Max session. Startup folder is fragile
(no auto-restart, no "at log on of any user" semantics).
Crash recovery + self-update + Event Log integration are
production-grade requirements per the user's hard-mode brief
— skipping any one of them in Phase 4.0 means the agent fails
silently in a way that's hard to diagnose later.

Legacy sunset (D4). The three deprecated routes are
currently returning 401 on every call (TD-056), so usage is
already zero in practice. Adding deprecation headers gives
us audit evidence to confirm zero-usage before the
Phase 4.1 sunset, which is good hygiene even though the
practical effect is nil.

### Consequences

Positive

- The agent survives reboots, crashes, network drops, and
  Cloud Run scale-to-zero events. The user provisions once
  per machine and forgets.
- The mobile UI shows live agent status without polling, so
  "is my desktop online?" is a 1-second question instead of a
  30-second one.
- Auth events feed BigQuery, which means the first phishing
  attempt or stolen-laptop incident has a forensic trail
  (geo-jumps, IP changes, sudden frequency spikes are
  detectable; alerts via Cloud Monitoring on those queries).
- The agent token is scoped — a leaked token can't escalate
  beyond the capabilities the user granted at registration.
- The legacy REST surface gets a clear sunset path with audit
  evidence, closing TD-056 by design (the new auth path
  proves it works; the old path retires).
- The Anthropic API key dependency is removed from the agent
  `.env`, eliminating the silent-mode-switch risk (TD-055
  closes once the key is also rotated on the Anthropic side).

Negative

- New backend surface area: 6 new endpoints + a Firestore
  collection + a BigQuery dataset + a Pub/Sub topic. Each is
  a new failure mode and a new operational concern.
- Self-update introduces a binary-replacement code path on
  Windows. Even with signature verification + post-swap
  health check + rollback, a malformed update could brick the
  agent on a single machine until manual intervention. The
  rollout is conservative (signed releases only, signed by a
  key whose private half is offline) but the surface exists.
- Scheduled Task XML is a Windows-specific artefact. macOS /
  Linux ports of this same productionization story will need
  their own bootstrap (launchd / systemd) and the install
  scripts won't translate.
- Mobile UI gains a Pub/Sub SSE subscription, which is a new
  long-lived connection alongside the task SSE. Resource
  contention is unlikely (RN handles multiple SSEs fine
  post-3.4.1), but it's a new connection to manage on
  background/foreground transitions.

Mitigations

- Self-update gates: post-swap health check is an HTTP call
  to `/v1/agent/latest-version` matching the new version
  string; if the agent process can't even open a socket
  to reach the api, the wrapper rolls back. This catches
  the most common failure modes (corrupt download,
  permissions, signature drift).
- Pub/Sub topic is auto-created with the api's existing
  service account permissions; no new IAM bindings.
- Mobile SSE subscription is paused on background and
  resumed on foreground (matches existing task SSE pattern
  from Phase 3.3).
- Backwards compatibility: the legacy REST endpoints stay
  routable for 30 days, and the WS path is unchanged from
  Phase 3.4.1, so no live agent breaks on Phase 4.0 deploy.

Neutral

- Windows-only scope. macOS/Linux agents are out of Phase
  4.0 by design (no current users on those OSes); the
  Firestore + WS + token model is OS-agnostic, only the
  install scripts are not.

### Compliance

Security

- Token never serialized to disk in plaintext (Credential
  Manager uses DPAPI per-user encryption).
- Token never logged by the agent (logger redacts
  `Authorization` headers).
- Bcrypt cost 12 is the OWASP-recommended floor for 2026;
  re-evaluate at cost 14 in 2028 per Moore's-law forecast.
- Self-update signature: detached Ed25519 signature on the
  binary; public key bundled in the agent. Private key held
  offline, signing happens on Akmal's machine for Phase 4.0.
  Key-rotation policy: 1-year cycle.

Operations

- Health check: `GET /v1/agent/list` includes per-agent
  `lastHeartbeatAt`. A scheduled Cloud Monitoring check
  alerts on agents that miss > 5min of heartbeats while
  having `online=true`.
- Capacity: Firestore `agents` collection scales linearly
  with agent count; for the foreseeable user base (1–100
  agents) this is well within free-tier limits. BigQuery
  audit log writes are batched per minute.
- Cost: agent token auth is one Firestore read per WS
  connect (cached for the life of the connection) — small
  fraction of mobile costs. BigQuery writes are tiny
  (<100 events/agent/day).

Scalability

- The api's in-memory `AgentSessionRegistry` becomes a
  per-instance cache layered on top of the Firestore
  source-of-truth. Cross-instance coordination is via
  Pub/Sub fan-out. This is the long-promised replacement for
  *Agent WebSocket Sessions Are In-Memory (MVP); Redis
  Coordination Is A Future TD* — the future TD now has a
  concrete answer (Pub/Sub, not Redis).

### Migration plan

Existing single-agent setup → Phase 4.0:

1. Phase 4.0 backend deploys: new endpoints + Firestore
   collection + BigQuery dataset are live, but the legacy
   endpoints continue to serve the existing REST clients
   (with deprecation headers).
2. The user runs the agent registration CLI once on their
   PC. The CLI:
   - prompts for a user JWT (paste from mobile or gateway
     sign-in flow)
   - calls `POST /v1/agent/register`
   - stores the returned token in Credential Manager
   - self-tests the WS connection
   - prints success + agent UUID
3. The user runs `install-agent-autostart.ps1` once,
   which writes the wrapper script to `%APPDATA%`,
   registers the scheduled task, and verifies it.
4. From this point on, every reboot brings the agent back.
   The user's manual `pnpm dev` flow continues to work
   exactly as before — Phase 4.0 is purely additive on the
   client side.
5. Mobile users get the agent-status UI in the next mobile
   build (Phase 4.0 mobile work parallels the agent /
   backend work but is its own deploy).

### Sunset criteria

This ADR is reconsidered if any of the following hold:

- Multi-OS demand. macOS or Linux users would re-open the
  startup decision (D3); a cross-OS solution likely shifts
  to per-OS ADRs.
- Cross-org / multi-tenant scope. The "user owns one or more
  agents" model implies a single user account; an enterprise
  tenant model would re-open D1 (likely toward OAuth client
  credentials) and D2 (likely toward push fan-out via a
  message broker).
- > 1000 concurrent agents per Cloud Run instance. The in-
  memory registry per-instance becomes a hot path; Redis or
  a similar shared cache is the likely next step.
- Self-update incidents. If a malformed update bricks more
  than 5% of agents in any release, D3's self-update
  mechanism is removed in favour of manual updates with
  email notification.

### Implementation

Backend (Phase 4.0 Part 3):

- `apps/api/src/routes/agent.ts` — new routes (register,
  rotate-token, status, list, latest-version) using new
  `createAgentTokenGuard` middleware.
- `apps/api/src/integrations/auth.ts` — `createAgentTokenGuard`
  alongside the existing `createAgentGuard`. Bcrypt-based.
- `apps/api/src/integrations/firestore.ts` — new `agents`
  collection wrapper.
- `apps/api/src/services/agent-registry.ts` — encapsulates
  the Firestore + Pub/Sub fan-out logic; replaces the
  current in-memory `AgentSessionRegistry` for persistent
  identity (the in-memory one stays for per-instance WS
  bookkeeping).
- `apps/api/src/integrations/audit-log.ts` — new file;
  BigQuery writer for `operator_os_dev_audit.agent_auth`.
- `packages/contracts/src/ai/agent-registration.ts` — new
  schemas for the register/rotate/status request + response
  bodies.

Agent (Phase 4.0 Parts 4 + 5 + 6):

- `apps/desktop-agent/src/auth/credential-manager.ts` —
  new file; PowerShell wrapper around Windows Credential
  Manager.
- `apps/desktop-agent/src/cli/register.ts` — new file;
  one-time CLI entry point.
- `apps/desktop-agent/src/auth/token-rotator.ts` — new
  file; background rotation loop.
- `apps/desktop-agent/src/providers/control-channel-ws.ts` —
  read token from Credential Manager (replacing
  `process.env.CONTROL_CHANNEL_TOKEN`).
- `apps/desktop-agent/src/api-client.ts` — include
  `Authorization: Bearer <token>` in every REST request,
  closing TD-056.
- `scripts/install-agent-autostart.ps1` and
  `scripts/uninstall-agent-autostart.ps1` — new files.
- `apps/desktop-agent/scripts/start-agent.ps1` — new file;
  the wrapper invoked by schtasks.

Mobile (Phase 4.0 Part 7):

- `src/state/agent-status-store.ts` — new Zustand store.
- `src/screens/devices-screen.tsx` — gain agent list +
  revoke buttons.
- `src/components/agent-status-badge.tsx` — new component
  for the persistent header indicator.

Documentation (Phase 4.0 Part 10):

- `docs/AGENT_SETUP.md` — first-time setup walkthrough.
- `docs/AGENT_TROUBLESHOOTING.md` — common errors + fixes.
- `docs/MIGRATION-V4.md` — for the legacy-REST-endpoint
  sunset.

### References

- Phase 3.2 ADR: *Agent WebSocket Sessions Are In-Memory
  (MVP); Redis Coordination Is A Future TD* — this ADR is
  the long-promised follow-up to that "future TD"; the
  answer is Pub/Sub + Firestore, not Redis.
- Phase 3.3 ADR: *ClaudeCodeAgent Integration — Phase 1.4
  + Thin Adapter (Phase 3.3)* — execution path the new
  auth model wraps.
- TD-054 (closed): mobile SSE swap to react-native-sse —
  the close that unblocked Phase 4.0.
- TD-055 (open, P0): rotate ANTHROPIC_API_KEY. Phase 4.0
  Part 2 removes the key from the agent's env, but the
  rotation on the Anthropic side is still a separate user
  action.
- TD-056 (open, P3): legacy REST endpoint 401s. Phase 4.0
  Part 4 closes this incidentally by adding the
  Authorization header to the REST client; the deprecation
  in Part 8 retires the endpoints entirely.
- BCrypt cost 12: OWASP Authentication Cheat Sheet (2026
  revision).
- Windows Credential Manager / DPAPI: Microsoft Docs,
  *Cryptography Next Generation* article on DPAPI per-user
  encryption.

### Amendment 1 — Token rotation overlap flow (Phase 4.0 Part 3, hard-mode addition)

The original D1 specified a 24-hour overlap window during
rotation but did not pin the data model. Hard-mode review
selected a single-document overlap (one `agents/{id}` doc with
both current and previous hashes) over a sub-collection of
token versions. The single-doc approach makes rotation a
single Firestore write, makes auth a single read, and keeps
the data shape obvious for ops queries.

Field shape on `agents/{agentId}`:

```
tokenHash:                string         (current bcrypt hash)
previousTokenHash:        string | null  (last rotated hash)
previousTokenExpiresAt:   Timestamp | null  (cleanup deadline)
oldTokenUsageCount:       number         (defaults to 0)
```

Validation order on inbound auth:

1. `bcrypt.compare(token, tokenHash)` → if match, accept;
   `oldTokenUsageCount` and `previousTokenHash` are not
   touched.
2. Else, if `previousTokenHash !== null` and
   `now <= previousTokenExpiresAt`:
   - `bcrypt.compare(token, previousTokenHash)` → if match,
     accept; **set response header
     `X-Token-Rotation-Recommended: true`**;
     `agents.update({ oldTokenUsageCount: increment(1) })`.
3. Else: 401.

Header semantics on the agent side:

- The agent's REST client + WS-upgrade handler watch every
  response for `X-Token-Rotation-Recommended: true`.
- On observation, the agent enqueues an immediate rotation
  call (`POST /v1/agent/rotate-token`) and proceeds with
  the in-flight request unchanged. Rotation runs out-of-band
  on the next event-loop tick, not blocking the user task.
- The agent debounces: if a rotation is already in flight,
  subsequent header observations are no-ops until the
  rotation settles.

Cleanup job:

- A scheduled Cloud Run job (`cron-cleanup-rotated-tokens`,
  hourly) sweeps `agents/` where `previousTokenExpiresAt <
  now()` and writes `{previousTokenHash: null,
  previousTokenExpiresAt: null}`. The sweep is idempotent and
  uses Firestore's batched writes (max 500 per batch).
- The job also publishes a metric
  `agent_old_token_cleanup_count` to Cloud Monitoring per
  run so we have a visible heartbeat that cleanup is
  running.

Metric: `oldTokenUsageCount`

- Per-agent counter incremented on every accepted-via-
  previous-hash auth.
- Mobile UI surfaces it as a "stale token" indicator on the
  Devices screen (Phase 4.0 Part 7) so the user sees that an
  agent hasn't completed rotation yet.
- A non-zero value 48h after rotation is a real signal: the
  agent is using a stale token despite seeing the rotation
  header. Likely root cause: the rotation call failed and
  the agent didn't retry. Cloud Monitoring alerts on
  `oldTokenUsageCount > 0` after `previousTokenExpiresAt -
  6h` (i.e. in the last 6h before cleanup).

Rationale for the header-based pull rather than a
server-pushed rotation:

- Push would require either polling for "has my token been
  rotated?" or a long-lived control channel that's already
  authenticated. Both add machinery without buying anything
  the header-pull pattern doesn't already give us.
- Header-pull is opportunistic: rotation happens on the
  next normal request, which means a sleeping agent doesn't
  rotate (correct — we don't want to wake it up; the
  cleanup job will simply expire the previous hash and the
  agent rotates on its next wake), and a busy agent
  rotates immediately (correct — high-traffic = high-risk
  rotation surface).

References:

- TD-057 (filed at this amendment): BigQuery audit pipeline
  for `agent_auth` events. Part 3 ships with a
  `LoggingAuditWriter` stub; the BigQuery writer plugs into
  the same interface once the table exists.
- TD-058 (filed at this amendment): Pub/Sub topic for the
  `agent-status-changes` real-time fan-out. Part 3 ships
  with a no-op publisher; the real one plugs in once the
  topic is provisioned.
- TD-059 (filed at this amendment): signed self-update
  pipeline. Part 3 ships `GET /v1/agent/latest-version`
  returning a stub response; the actual update mechanism
  slips to Phase 4.0.1.
