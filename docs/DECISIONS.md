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
