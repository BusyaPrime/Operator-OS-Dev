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
