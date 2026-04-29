# Migration: pre-4.0 REST agent → Phase 4.0 WebSocket control channel

**Audience:** anyone running an Operator-OS desktop agent built before
Phase 4.0 (i.e. before the `feat/phase-4.0-part-8-deprecate-legacy`
ship date). Once the sunset window closes, the affected REST routes
return `410 Gone` and the agent has to be on the WS path to function.

## Timeline

| Event              | Date (UTC)             | What changes |
|--------------------|------------------------|--------------|
| Deprecation marker | **2026-04-29**         | Routes keep working; every response carries `Deprecation`, `Sunset`, and `Link` headers (RFC 9745 / 8594 / 8288). Each call is logged as `source: legacy-endpoint-usage`. |
| Sunset             | **2026-05-25**         | Phase 4.1 transition window opens: routes return `410 Gone` once `legacy-endpoint-usage` stays at zero for two consecutive weeks. The ~26-day deprecation window is intentionally aggressive — every pre-4.0 caller is internal (we own the full migration path), so the rollout budget is correspondingly short. |
| Removal            | Phase 5 (post-sunset, after 410 is live and stable) | Routes are deleted from `apps/api/src/routes/agent.ts`. Any client still calling them gets `404 Not Found`. |

## Affected endpoints

The following three routes are deprecated by ADR-025 D4. They are
replaced 1:1 by the WebSocket control channel mounted at
`/v1/agent/ws` (see `apps/desktop-agent/src/providers/control-channel-ws.ts`).

| Pre-4.0 endpoint                       | Replacement on WS                                                        |
|----------------------------------------|--------------------------------------------------------------------------|
| `POST /v1/agent/heartbeat`             | `hello` frame on connect → server sends `welcome`. Periodic `ping` from server with RTT echo. |
| `POST /v1/agent/heartbeat/agent`       | Same as above. The agent-centric body fields (`agentId`, `providerId`, `state`, `uptimeSeconds`, `activeTaskCount`, `healthChecks`) are carried on the `hello` frame. |
| `GET /v1/agent/commands`               | `task-assign` frame pushed by server when the router matches an agent. No polling required.   |

Other `/v1/agent/*` routes (`/sessions`, `/exports`, `/alerts`,
register / rotate-token / list / status) are **unaffected** — they
remain REST and remain supported indefinitely.

## How to detect that you are on a deprecated route

Every response from a deprecated endpoint carries:

```http
Deprecation: @1777660800
Sunset: Tue, 28 Jul 2026 00:00:00 GMT
Link: <https://docs.operator-os.dev/migration/v4>; rel="deprecation"; type="text/html",
      <https://docs.operator-os.dev/migration/v4>; rel="sunset"; type="text/html"
```

- `Deprecation: @<unix-seconds>` — the moment the route was marked
  deprecated. Per RFC 9745.
- `Sunset: <HTTP-date>` — the moment the route stops responding 200.
  Per RFC 8594.
- `Link` with `rel="deprecation"` / `rel="sunset"` — points at this
  document. Per RFC 8288.

Server-side, every legacy hit is logged at INFO with structured
fields:

```json
{
  "source": "legacy-endpoint-usage",
  "endpoint": "POST /v1/agent/heartbeat",
  "userId": "user-akmal",
  "ip": "203.0.113.42",
  "userAgent": "OperatorAgent/0.5.2",
  "deprecationAt": 1777660800000,
  "sunsetAt": 1785571200000
}
```

Cloud Logging surfaces these as a log-based metric; ops watches the
per-day count for two consecutive weeks of zero before deleting the
routes.

## How to migrate

### Direct path: ship Phase 4.0+ desktop agent

The Phase 4.0 desktop agent (PRs #38 + #39 + #40) drives the WS path
end-to-end. It:

1. Authenticates with a per-machine opaque token (see ADR-025 D1) —
   no JWT in `Authorization` header.
2. Connects to `/v1/agent/ws`, sends `hello`, receives `welcome`.
3. Listens for `task-assign` frames.
4. Sends `ping` / receives `pong` for liveness + RTT measurement.
5. On disconnect: state-machine-driven reconnect with ±20% jitter
   exponential backoff (capped at 30s).

Replacing your pre-4.0 install with the Phase 4.0+ desktop agent
covers every migration step — there is no per-endpoint REST-to-WS
adapter to write.

### Operator path: identify residual pre-4.0 traffic

```sql
-- BigQuery / Cloud Logging analytics: legacy hits per day per
-- endpoint, last 30 days. Plug into a dashboard; alert at 0 hits
-- for two consecutive weeks.
SELECT
  TIMESTAMP_TRUNC(timestamp, DAY) AS day,
  jsonPayload.endpoint AS endpoint,
  COUNT(*) AS hits
FROM `operator-os-dev.operator_os_dev_audit.application_logs`
WHERE jsonPayload.source = 'legacy-endpoint-usage'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day, endpoint
ORDER BY day DESC, hits DESC;
```

If your tenant's BigQuery sink isn't configured yet, the same
counts are visible in Cloud Logging directly:

```
resource.type="cloud_run_revision"
jsonPayload.source="legacy-endpoint-usage"
```

## FAQ

**Q: Will the routes 410 immediately on the sunset date?**
A: No. The sunset date is when the 410 transition becomes
authorised; the actual flip happens in a follow-up PR after two
consecutive weeks of zero `legacy-endpoint-usage` hits. We will not
black-hole working traffic.

**Q: What if I can't ship Phase 4.0+ before the sunset date?**
A: File an issue against the API repo; we extend the sunset on a
case-by-case basis. The headers carry no contractual force — they
are advisory.

**Q: Does this affect mobile clients?**
A: No. Mobile uses Firebase ID tokens against `/v1/operator/*` and
`/v1/tasks/*` routes. None of those are in the deprecation set.

**Q: Where do I find the new WS control channel docs?**
A: `docs/flows/end-to-end-task-flow.md` covers the agent-side state
machine; `apps/api/src/routes/agent-ws.ts` is the server-side
canonical reference for the frame schemas.
