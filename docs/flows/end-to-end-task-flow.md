# End-to-End Task Flow

Status: Phase 2 landed the api surfaces; the full
mobile → api → desktop-agent → AI → mobile roundtrip is complete
through `/v1/cost/record` observability. The final task-submit
endpoint (`POST /v1/tasks`) + task queue + router selection are
Week 4 work, captured at the bottom.

## Participants

| Layer           | Service / package                          |
| --------------- | ------------------------------------------ |
| Mobile          | `apps/mobile` (Expo / React Native)        |
| Auth gateway    | `apps/auth-gateway` (Cloud Run)            |
| API             | `apps/api` (Cloud Run, Fastify)            |
| Desktop agent   | `apps/desktop-agent` (local Node process)  |
| Concrete agent  | `ClaudeCodeAgent` → `claude` CLI (execa)   |

## Sequence (Phase 2 — all control channels live)

```
Mobile App            Auth Gateway          API               Desktop Agent         Claude Code CLI
    |                      |                 |                      |                      |
    |                      |   one-time (mobile launch or expired session)                 |
    |                      |                 |                      |                      |
    | POST /v1/auth/signin |                 |                      |                      |
    |--------------------->|                 |                      |                      |
    |  { idToken }         |                 |                      |                      |
    |<---------------------|                 |                      |                      |
    |  { accessToken,      |                 |                      |                      |
    |    refreshToken,     |                 |                      |                      |
    |    user }            |                 |                      |                      |
    |                      |                 |                      |                      |
    |     (access token stored in-memory; refresh token in keychain)                       |
    |                      |                 |                      |                      |
    |                      |                 |                      |                      |
    |                      |                 |  DESKTOP AGENT STARTS                       |
    |                      |                 |                      |                      |
    |                      |                 |  WSS /v1/agent/ws    |                      |
    |                      |                 |<---------------------|                      |
    |                      |                 | 101 Switching (TLS handshake)               |
    |                      |                 |                      |                      |
    |                      |                 |<-- hello(agentId,    |                      |
    |                      |                 |       manifest) -----|                      |
    |                      |                 |                      |                      |
    |                      |                 | --> welcome(         |                      |
    |                      |                 |       sessionId,     |                      |
    |                      |                 |       serverFeatures)|                      |
    |                      |                 |                      |                      |
    |                      |                 | ping/pong loop (30s default)                 |
    |                      |                 |                      |                      |
    |                      |                 | POST /v1/agent/heartbeat/agent              |
    |                      |                 |<---------------------|                      |
    |                      |                 |  { agentId, state,   |                      |
    |                      |                 |    healthChecks, ... }                      |
    |                      |                 | --> { status: 'ok', serverTime, ... }       |
    |                      |                 |                      |                      |
    |                      |                 |                      |                      |
    |                      |                 |  USER SUBMITS A TASK (Week 4)               |
    |                      |                 |                      |                      |
    | POST /v1/tasks       |                 |                      |                      |
    |----------------------------------------->|                    |                      |
    | { prompt,            |                 | (router picks an     |                      |
    |   agentType,         |                 |  online agent with   |                      |
    |   constraints }      |                 |  matching capability)|                      |
    |                      |                 |                      |                      |
    |                      |                 | POST /v1/cost/estimate  (agent-side)        |
    |                      |                 |<---------------------|                      |
    |                      |                 | --> { costUsd, confidence }                 |
    |                      |                 |                      |                      |
    |                      |                 | GET /v1/cost/status/:userId (mobile-side)   |
    |<-----------------------------------------|                    |                      |
    |   { spentUsd, limitUsd, isOverBudget }  |                     |                      |
    |                      |                 |                      |                      |
    |                      |                 | task-assign (via WS) |                      |
    |                      |                 |--------------------->|                      |
    |                      |                 |                      | executeTask()        |
    |                      |                 |                      |--------------------->|
    |                      |                 |                      |  claude -p <prompt>  |
    |                      |                 |                      |<---------------------|
    |                      |                 |                      |  streams tokens (via |
    |                      |                 |                      |  execa stdout/stream)|
    |                      |                 |<-- task-delta(taskId,|                      |
    |                      |                 |     chunk) ----------|                      |
    |                      |                 |                      |                      |
    |                      |                 | (mobile streams via SSE / WS — Week 4)      |
    |<-----------------------------------------|                    |                      |
    |  token stream (UI renders as it arrives)|                     |                      |
    |                      |                 |                      |                      |
    |                      |                 |                      |<---------------------|
    |                      |                 |                      |  CLI exit 0          |
    |                      |                 |                      |                      |
    |                      |                 |                      | recordUsage()        |
    |                      |                 |                      |--------------------->|
    |                      |                 | POST /v1/cost/record |                      |
    |                      |                 |<---------------------|                      |
    |                      |                 | (server recomputes   |                      |
    |                      |                 |  within $0.01, else  |                      |
    |                      |                 |  overrides)          |                      |
    |                      |                 |                      |                      |
    |                      |                 |<-- task-completed(   |                      |
    |                      |                 |     taskId, output) -|                      |
    |                      |                 |                      |                      |
    |<-----------------------------------------|                    |                      |
    |  final response + usage summary         |                     |                      |
```

## Auth flow detail (Phase 1.2 + 1.5 pattern — recap)

1. Mobile acquires a Google idToken via the native sign-in
   picker (`@react-native-google-signin/google-signin`).
2. Mobile POSTs the idToken to `auth-gateway /v1/auth/signin`.
3. Auth gateway verifies the Google idToken against
   `AUTH_ACCEPTED_GOOGLE_CLIENT_IDS`, mints an HS256 operator
   access token + a refresh token, returns both plus the user
   profile.
4. Mobile persists the refresh token in the OS keychain
   (`expo-secure-store`), holds the access token in memory.
5. Subsequent mobile requests go through
   `authenticated-api-client` which attaches
   `Authorization: Bearer <accessToken>`, proactively refreshes
   inside a 5-minute expiry window, and retries once on 401.
   Double-401 or invalid-credentials on refresh →
   `authStore.forceSignOut()`.

## Agent flow detail (Phase 1.4 + Phase 2 surfaces)

1. Desktop agent starts. `DesktopRuntime.start()` wires up
   `NodeFileSystemProvider`, `WebSocketStreamProvider`,
   `ApiCostProvider`, `AgentRegistry`, and each enabled agent
   (currently just `ClaudeCodeAgent`).
2. Agents in `ENABLED_AGENTS` are probed (`claude --version`)
   and transitioned to `idle` on success or `degraded` on
   failure. Runtime keeps going either way.
3. `AgentHeartbeatLoop` starts ticking at
   `HEARTBEAT_INTERVAL_MS`, posting to the api's new
   `POST /v1/agent/heartbeat/agent` endpoint. A 5-second
   per-agent rate limiter on the api rejects duplicate-
   submits inside the window (429). Server persists to
   `agentHeartbeats` Firestore collection.
4. `WebSocketStreamProvider` connects to
   `wss://.../v1/agent/ws`, sends hello with the
   `AgentManifest`, receives welcome. The session stays open
   while agents execute tasks; the api's ping/pong loop keeps
   idle sessions alive and force-closes at 60s of no activity.

## What's still Week 4+

- **`POST /v1/tasks` endpoint** — the mobile-side submit that
  today goes nowhere. Will route through Pub/Sub or Cloud
  Tasks to the agent via the WS session.
- **Task queue** — Pub/Sub topic `task-dispatch` (decision
  pending) with one subscription per online agent. Lets us
  buffer work when an agent briefly disconnects.
- **Router / capability matcher** — picks which agent to
  assign a task to based on `listCapabilities()` + load
  balancing. Today's mobile will hardcode `claude-code` until
  the router exists.
- **Streaming response mobile ← api** — likely SSE
  (one-directional) since mobile is consuming, not
  publishing. WS is an alternative but SSE survives proxies
  better.
- **Real cost tracking** — Phase 2 records individual costs;
  aggregation + budget enforcement in the hot path (blocking
  an over-budget user pre-dispatch) happens in a separate
  admin/billing PR.
- **Multi-instance agent-session coordination** — today's
  in-memory `AgentSessionRegistry` is single-Cloud-Run-instance
  only. Once the api scales to >1 instance, agents need
  either sticky sessions (via Cloud Run's session-affinity
  mode) or a shared Redis registry. ADR
  *Agent WebSocket Sessions Are In-Memory* records the
  migration plan.

## Verification endpoints (once live)

| What                        | How                                                                 |
| --------------------------- | ------------------------------------------------------------------- |
| Heartbeat v2 live           | `curl -XPOST .../v1/agent/heartbeat/agent` with valid agent JWT     |
| Cost estimate               | `POST .../v1/cost/estimate` with agent JWT + pricing-table row      |
| Budget snapshot             | `GET .../v1/cost/status/:userId` with user JWT matching `:userId`   |
| WS handshake                | desktop-agent logs `starting agent heartbeat loop` followed by a ws connect; api logs `agent session established` |

## References

- `apps/api/src/routes/agent.ts` — /v1/agent/heartbeat/agent
- `apps/api/src/routes/cost.ts` — /v1/cost/*
- `apps/api/src/routes/agent-ws.ts` — WSS /v1/agent/ws
- `apps/api/src/services/cost.ts` — pricing table + period math
- `apps/api/src/services/agent-session-registry.ts` — in-memory sessions
- `apps/desktop-agent/src/heartbeat/agent-heartbeat-loop.ts` — producer
- `apps/desktop-agent/src/agents/claude-code-agent/claude-code-agent.ts` — concrete agent
- `apps/mobile/src/services/authenticated-api-client.ts` — bearer + refresh
- `docs/DECISIONS.md` — Phase 2 ADRs: additive heartbeat, code-based pricing, in-memory sessions
- `docs/TECH_DEBT.md` — TD-017 / TD-022 / TD-024 closed; TD-025 filed
