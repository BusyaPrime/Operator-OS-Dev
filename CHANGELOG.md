# Changelog

All notable changes to Operator-OS land here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Phase 4.0 Part 5 — Reconnection state machine + RTT + categorisation

#### Added

- `ConnectionStateMachine` — six-state explicit machine
  (DISCONNECTED → CONNECTING → CONNECTED → DEGRADED →
  DISCONNECTING → REVOKED with REVOKED absorbing). Replaces
  scattered `#shuttingDown` + `#sessionId !== undefined`
  booleans inside the WS class.
- `RttHistogram` — bounded rolling-window histogram
  (default 20 samples ≈ 10 minutes at 30s ping cadence).
  Reports p50 / p95 / p99 / mean / mostRecent. Pure utility,
  numpy-style linear-interpolation percentiles.
- `categorizeDisconnect(...)` — maps WS disconnect inputs
  (Error.code, Error.message, closeCode, intentional) into
  nine documented categories: NETWORK_DOWN, DNS_FAILURE,
  TLS_HANDSHAKE_FAIL, SERVER_UNREACHABLE, SERVER_REJECTED,
  PROTOCOL_ERROR, CLIENT_TIMEOUT, INTENTIONAL, UNKNOWN.
- `ReconnectBackoff` — exponential backoff with ±20%
  jitter, 1000-attempt ceiling, reset on welcome, injectable
  random source for deterministic tests. Replaces inline
  backoff math in `#scheduleReconnect`.
- `PollingNetworkChangeDetector` — polls
  `os.networkInterfaces()` every 5s, fires onChange
  listeners when the non-internal-address signature
  changes. ControlChannelWs subscribes on `start()` and
  cancels its pending backoff timer + reconnects
  immediately when the local interface comes back. Pure
  TS, no native deps. Forward path to a Windows-event
  impl when Phase 4.x lands a native addon.
- ADR-025 amendment 2 documents the state machine,
  reconnect resilience, RTT limitation (local processing
  latency only — true RTT pending api timestamp echo).

#### Changed

- `ControlChannelWs` accepts five new optional constructor
  fields (`stateMachine`, `backoff`,
  `networkChangeDetector`, `rttHistogram`). Defaults wire
  up production-ready instances; tests inject deterministic
  ones.
- New public getters: `connectionState`, `sessionId`.
- `isConnected` now reads `stateMachine.canSend` (CONNECTED
  or DEGRADED).
- Backoff math + `#shuttingDown` state replaced with state-
  machine queries throughout `#connectAsync`,
  `#scheduleReconnect`, close-event handler, error-event
  handler.

#### Quality

- `@operator-os/desktop-agent`: 229 → 285 (+56 across 5.A-F).
- Every new primitive ships with focused unit tests:
  ConnectionStateMachine (15), RttHistogram (8),
  categorizeDisconnect (15), ReconnectBackoff (18),
  NetworkChangeDetector (14). The Part 5.F integration was
  validated by the existing 285-test suite — no regressions
  in the WS auth path (Part 4.E), rotation cascade (Part
  4.G), or claude-code-agent tests.

### Phase 4.0 Part 4 — Agent-side token management

#### Added

- `DpapiCredentialStore` (`apps/desktop-agent/src/auth/credential-store.ts`):
  per-machine token at rest under `%APPDATA%/OperatorOS/.credentials/<sanitized-target>.dpapi`,
  encrypted with PowerShell `ProtectedData` (DPAPI ScopeCurrentUser),
  atomic .tmp+rename writes. Plus `InMemoryCredentialStore` for tests.
  `AGENT_TOKEN_TARGET = 'OperatorOS:agent-token'` exported as the
  canonical key.
- Registration CLI: `pnpm --filter @operator-os/desktop-agent register`
  — six-step UX with Max-session preflight, JWT shape + expiry
  validation, hostname normalisation, register-then-self-test
  round-trip, Credential Manager write.
- `TokenRotator`: signal-driven rotation per ADR-025 amendment 1.
  Single-flight, exponential backoff (1s → 60s ceiling, 6
  attempts), 401 → fatal-non-retryable, 409 → no-op
  (server says rotation already in flight), atomic store
  update (write → read-back → confirm), 6h periodic safety-net
  timer with 25d local age trigger.
- `TokenAuthSignals` shared event surface + `noopAuthSignals`.
- REST client (`DesktopApiClient`) now reads token fresh from
  the credential store on every request, fires
  `signals.onRotationHinted` on `X-Token-Rotation-Recommended`
  observation, fires `signals.onUnauthorized({source: 'rest'})`
  on 401. Closes TD-056 (legacy heartbeat 401s).
- WS path (`ControlChannelWs`) accepts `tokenProvider` +
  `authSignals`, reads token fresh on every (re)connect,
  observes `X-Token-Rotation-Recommended` on the upgrade
  response, fires `signals.onUnauthorized` on close code 4001
  or upgrade error 401.
- `FatalAuthHandler` subscribes to `onUnauthorized`. First
  observation logs structured fatal + exits with code 87
  (`AGENT_TOKEN_REVOKED_EXIT_CODE`). Idempotent. Phase 4.0
  Part 6's Scheduled Task XML will key off the exit code to
  stop auto-restart loops.
- `main.ts` wires all four building blocks together; backward-
  compat fallback keeps the legacy `CONTROL_CHANNEL_TOKEN` env
  var path working for dev / smoke flows.
- Rotation-cascade integration test exercises:
  upgrade-header → rotator → store → next connect, WS close
  4001 → fatal exit, rotator 401 → fatal exit.

#### Quality

- `@operator-os/desktop-agent`: 156 → 229 (+73 across 4.A-G).
- Cumulative TD-056 closure: REST 401s on
  `/v1/agent/heartbeat` + `/v1/agent/commands` no longer
  ignored — Authorization header attached on every call,
  401 cascades to the FatalAuthHandler.

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
