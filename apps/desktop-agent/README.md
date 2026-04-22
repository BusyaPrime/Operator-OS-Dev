# Operator OS Desktop Agent

Transparent runtime for device heartbeat, command polling,
session / export stubs, notifier stubs, **and** (as of Phase
1.4) the Universal AI Agent runtime — multi-AI provider
wrappers bound to a scoped filesystem, WebSocket streaming,
cost tracking, and additive per-agent heartbeat.

## Explicit Non-Goals

- no hidden remote control
- no keylogging
- no credential harvesting
- no silent OS hooks
- no stealth persistence

## Local Run

```powershell
pnpm --filter @operator-os/desktop-agent dev
```

## Architecture (Phase 1.4)

```
DesktopRuntime
├── HeartbeatLoop              (device state → /v1/agent/heartbeat)
├── CommandPoller              (legacy device commands)
├── SessionManager / ExportManager / Notifier / SafeCommandExecutor
└── Universal AI layer
    ├── ManifestLoader         (provider shortName → AgentManifest)
    ├── AgentRegistry          (typed events: registered / unregistered / state-changed)
    ├── AIAgent[] (built per enabled provider)
    │    └── ClaudeCodeAgent
    │         ├── NodeFileSystemProvider   (scoped FS; atomic writes)
    │         ├── WebSocketStreamProvider  (per-task stream; local fan-out)
    │         └── ApiCostProvider          (TD-022 stubs; budget + usage)
    └── AgentHeartbeatLoop     (per-agent heartbeat → /v1/agent/heartbeat/agent; TD-024)
```

Both heartbeat loops run simultaneously — the device-state
loop posts the mobile-facing shape to the existing endpoint,
and the new agent-centric loop posts to the TD-024 endpoint
that does not yet exist on the api side. See ADR *Agent
Heartbeat Schema Is Additive, Not Replacement* (2026-04-24).

## Configuration

All knobs live in env vars, parsed through
`@operator-os/config` `desktopAgentEnvSchema`. Phase 1.4 adds:

| Variable                  | Default             | Purpose                                               |
| ------------------------- | ------------------- | ----------------------------------------------------- |
| `FS_ALLOWED_ROOTS`        | `process.cwd()`     | CSV of absolute paths the FS provider may touch       |
| `FS_READ_ONLY`            | `false`             | Refuse every mutating FS call when `true`             |
| `FS_MAX_FILE_SIZE_BYTES`  | `10485760`          | Per-`writeFile` cap                                   |
| `FS_MAX_TOTAL_WRITE_BYTES`| `104857600`         | Cumulative write budget across the session            |
| `ENABLED_AGENTS`          | `claude-code`       | CSV of provider shortNames to build + register        |
| `AGENT_USER_ID`           | `local-operator`    | Identity tagged on CostProvider calls                 |

Prior device-state knobs (`API_BASE_URL`, `HEARTBEAT_INTERVAL_MS`,
`DEVICE_ID`, etc.) still apply.

## Providers shipped

| Component                   | Status                              | Notes                                                         |
| --------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| `NodeFileSystemProvider`    | ✅ prod-ready                        | Atomic writes via tmp+rename, scope enforcement, budget caps |
| `WebSocketStreamProvider`   | ✅ local fan-out; ⚠ api ws pending   | Works for in-process subscribers today; network path ≈ TD-017 |
| `ApiCostProvider`           | ⚠ stubs only                        | Real api endpoints land with TD-022                            |
| `AgentRegistry`             | ✅                                   |                                                                |
| `ManifestLoader`            | ✅ in-memory                         | Disk-backed signed manifests = later (SPEC § 27.5)             |
| `ClaudeCodeAgent`           | ✅ task-at-a-time                    | Single-JSON CLI mode; stream-json upgrade on TD-023 decision   |
| `AgentHeartbeatLoop`        | ✅ producer; ⚠ api endpoint pending  | Backoff + thresholds in place; endpoint ≈ TD-024               |

## Testing

```bash
pnpm --filter @operator-os/desktop-agent typecheck
pnpm --filter @operator-os/desktop-agent lint
pnpm --filter @operator-os/desktop-agent test
```

The vitest suite includes 124 tests across the legacy stubs +
every new module in Phase 1.4. Key test harnesses:

- `src/agents/claude-code-agent/__tests__/claude-code-agent.test.ts`
  drives the agent through a mocked `SpawnFn` — every exit of
  the state machine (success, non-zero exit, schema drift,
  cancel, SIGKILL escalation) is covered without spawning a
  real `claude` binary.
- `src/heartbeat/__tests__/agent-heartbeat-loop.test.ts`
  injects a clock + poster so backoff windows, threshold
  transitions (`degraded` / `offline` / `idle` recovery), 401
  refresh-and-retry, and lifecycle are deterministic.
- `src/__tests__/runtime-bootstrap.test.ts` exercises the
  whole `DesktopRuntime` with a fake agent factory, so boot /
  shutdown ordering stays honest as the runtime grows.

## Known gaps (Phase 1.4)

- `TD-017` — ws endpoint on api side.
- `TD-022` — `/v1/cost/*` endpoints on api side.
- `TD-023` — `node-pty` evaluation for future agents.
- `TD-024` — `/v1/agent/heartbeat/agent` endpoint on api side.

All four are tracked in `docs/TECH_DEBT.md`. None block phase
1.5; each one opens a capability (streaming UX, billing UI,
interactive terminals, agent observability) once the api side
lands.
