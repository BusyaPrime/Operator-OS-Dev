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
