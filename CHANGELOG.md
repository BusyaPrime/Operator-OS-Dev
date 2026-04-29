# Changelog

All notable changes to Operator-OS land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Phase 4.0 Part 8 — Legacy REST sunset (ADR-025 D4)

#### Deprecated

- `POST /v1/agent/heartbeat`,
  `POST /v1/agent/heartbeat/agent`, and
  `GET /v1/agent/commands` are formally deprecated in favour
  of the WS control channel (`/v1/agent/ws`). Each response
  now carries `Deprecation: @<unix-seconds>` (RFC 9745),
  `Sunset: Mon, 25 May 2026 00:00:00 GMT` (RFC 8594), and
  `Link: <docs/MIGRATION-V4.md>; rel="deprecation"`,
  `Link: <docs/MIGRATION-V4.md>; rel="sunset"` (RFC 8288).
  Phase 4.1 turns the routes into `410 Gone` once
  `legacy-endpoint-usage` log-based metric stays at zero
  for two consecutive weeks.

#### Added

- `apps/api/src/middleware/deprecation.ts` —
  `applyDeprecationHeaders`, `recordLegacyEndpointUsage`,
  and a `createDeprecationPreHandler` factory that chains
  cleanly with the existing auth guards. Exports the
  baked-in dates (`LEGACY_ENDPOINT_DEPRECATION_AT`,
  `LEGACY_ENDPOINT_SUNSET_AT`) and the default migration
  doc URL so tests + agent code can assert against the
  same constants the routes serve.
- Each call to one of the three deprecated routes now
  emits a structured `source: 'legacy-endpoint-usage'`
  pino INFO line carrying `endpoint`, `userId`, `ip`,
  `userAgent`, plus the deprecation/sunset timestamps —
  Cloud Logging surfaces this as a log-based metric so
  ops can count residual traffic per day per endpoint.
- `docs/MIGRATION-V4.md` — caller-facing migration guide:
  affected endpoints, replacement (WS frame schema),
  timeline, on-the-wire detection (header shape +
  log-line shape), and a query template for the
  `legacy-endpoint-usage` metric.

#### Documented

- ADR-025 amendment 3 in `docs/DECISIONS.md` records the
  deprecation surface, transition phases (4.0 → 4.1 →
  Phase 5), and the merge-order dependency on Amendment 2
  (Phase 4.0 Part 5, PR #40).

#### Quality

- `@operator-os/api`: 230 → 243 tests (+13 across 2 new
  files: `middleware/__tests__/deprecation.test.ts` (9)
  and `routes/__tests__/agent-deprecation.test.ts` (4)).
- Coverage targets: every header is present on the success
  path; the Sunset header round-trips through Date.parse
  back to the documented constant; non-deprecated
  `/v1/agent/*` routes (e.g. `/sessions`) carry NO
  deprecation headers — surface stays scoped.

### Phase 4.0 — Always-On Agent + Max Subscription

#### Added

- Agent registration system: `POST /v1/agent/register` mints a
  per-machine opaque token, persists `bcrypt(token, cost=12)` +
  `sha256(token).slice(0,16)` (indexable lookup hash) on a new
  Firestore `agents/` collection, returns the raw token once.
- Agent token rotation: `POST /v1/agent/rotate-token` with the
  24h overlap window from ADR-025 amendment 1. The previous
  hash stays valid during the overlap; mid-overlap auth attempts
  see the `X-Token-Rotation-Recommended: true` response header
  and increment the `oldTokenUsageCount` metric on the agent.
- Agent management: `GET /v1/agent/list`, `GET /v1/agent/:id/status`
  (user JWT, AgentSummary projection — bcrypt hashes stripped),
  `DELETE /v1/agent/:id` (revoke = field flip, not delete, so
  audit forensics survive).
- Agent release pointer: `GET /v1/agent/latest-version` —
  Phase 4.0 stub returns `{ downloadUrl: null, signature: null }`
  per TD-059. The agent's update loop is gated on a non-null
  `downloadUrl` so the stub cleanly disables auto-update.
- `agentTokenGuard` middleware with two-stage hash verification
  (current first, previous second within overlap window),
  bounded LRU cache (256 entries × 5min TTL, keyed by
  sha256(token) so raw bytes never sit in Map keys), and a
  per-agent invalidator the rotate + revoke routes call after
  writes to keep the cache coherent.
- `FirestoreAgentRepository` durable wrapper with
  `findCandidatesByTokenLookup` (parallel where queries on
  current + previous lookup-hash fields, union-merged),
  transactional `create` + `rotateToken` + `markRevoked`, and
  the cleanup-job hook `clearExpiredPreviousTokens`.
- Audit event taxonomy: lifecycle events
  (`agent_registered`, `token_rotated`, `agent_revoked`)
  alongside the auth-attempt events (`auth_success`,
  `auth_success_previous_hash`, `auth_failed_*`).
- Max-session preflight in the desktop agent
  (`apps/desktop-agent/src/agents/claude-code-agent/max-session-preflight.ts`):
  fails fast with a clear error when the Claude OAuth shape
  is missing from `~/.claude/.credentials.json`, so the agent
  doesn't spawn a subprocess that would silently fail at first
  model call.

#### Changed

- `ANTHROPIC_API_KEY` is no longer required by the desktop
  agent. The `claude` CLI's normal mode prefers the OAuth
  session at `~/.claude/.credentials.json`; the env var was
  dead weight in our setup. Removed from `apps/desktop-agent/.env`
  + updated `docs/flows/end-to-end-task-flow.md` to reflect
  the actual auth posture.
- `API_SERVICE_VERSION` env var added to api config schema
  (default `0.1.0`). Surfaced by `GET /v1/agent/latest-version`.

#### Documented

- ADR-025 *"Agent Productionization — Auth, Online Status,
  Startup, Legacy Sunset (Phase 4.0)"* in `docs/DECISIONS.md`.
  Covers the four bound decisions D1-D4 + amendment 1 on the
  rotation overlap flow.
- TD-054 (mobile SSE consumer crash) closed by the standalone
  repo; TD-043 closed alongside.
- TD-057 (P1, must close before Phase 4.0 closure): BigQuery
  audit pipeline for `agent_auth` events. Phase 4.0 ships a
  `LoggingAuditWriter` stub.
- TD-058 (P1, must close before Part 7 mobile UI): Pub/Sub
  topic `agent-status-changes` for the real-time fan-out.
  Phase 4.0 ships a `NoOpStatusEmitter` stub.
- TD-059 (P2, deferred past Phase 4.0): signed self-update
  pipeline. Phase 4.0 stub returns null `downloadUrl` /
  `signature`.

#### Quality

- Cumulative test growth on Phase 4.0:
  - `@operator-os/contracts`: 162 → 184 (+22)
  - `@operator-os/api`: 161 → 230 (+69)
  - `@operator-os/desktop-agent`: 145 → 156 (+11)
- Per-route coverage on every new route covers happy / 401 /
  403 / 404 / 400 / 503 paths plus audit-resilience scenarios.
- Integration test through real `buildServer` exercises the
  full register → list → status → rotate-token → revoke
  round-trip, including the LRU-cache-coherence boundary
  case (rotating with the old token after rotation now
  correctly returns 409 with the rotation-recommended
  header).
