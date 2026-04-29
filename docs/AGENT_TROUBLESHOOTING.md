# OperatorOS Agent — Troubleshooting

## Exit codes

`start-agent.ps1` and `apps/desktop-agent/src/main.ts` share
a single exit-code namespace. Use this table to translate a
"Last Result" value from `schtasks /Query`.

| Code | Source                       | Meaning                                                   | Remediation |
|------|------------------------------|-----------------------------------------------------------|-------------|
| 0    | wrapper / agent              | Clean shutdown                                            | (normal — task waits for next logon trigger) |
| 87   | `FatalAuthHandler` (Part 4)  | `AGENT_TOKEN_REVOKED` — token revoked or never accepted   | Re-register: `pnpm --filter @operator-os/desktop-agent register`. **Wrapper rewrites this to 0** so the Scheduled Task does not auto-restart and thrash. |
| 88   | wrapper preflight            | Claude CLI not on PATH                                    | Reinstall the Claude Code CLI; verify `claude --version`. |
| 89   | wrapper preflight            | `~\.claude\.credentials.json` missing                     | Run `claude login`. The agent reads OAuth from this file (no API key fallback). |
| 90   | wrapper                      | `OPERATOR_OS_AGENT_ROOT` path does not exist              | Either set the env var to your apps/desktop-agent path, or move the repo to `D:\Operator-OS-Dev`. |
| 91   | wrapper                      | `apps/desktop-agent/dist/main.js` missing                 | `pnpm --filter @operator-os/desktop-agent build`. |
| else | agent itself                 | Unhandled error or process killed                         | Inspect the daily log; the wrapper propagates the code so Task Scheduler retries 3× per `RestartOnFailure`. |

## Common issues

### Task does not start at logon

```powershell
schtasks /Query /TN "OperatorOS Agent" /V /FO LIST
```

Look at:
- **Last Run Time / Last Result** — should be recent and `0`
  on a healthy install.
- **Status** — `Ready` between runs, `Running` while active.

If "Last Run Time" is `Never`:
- Confirm the task installed at the right scope:
  `schtasks /Query /TN "OperatorOS Agent"` (no error).
- Reinstall: `scripts\install-agent-autostart.ps1`.
- Check the Windows Event Viewer at
  `Microsoft → Windows → TaskScheduler → Operational` for
  the trigger event around your logon time.

### WebSocket reconnect loop

```powershell
Select-String -Path "$env:APPDATA\operator-os\logs\agent-*.log" `
  -Pattern '"level":(50|60)' | Select-Object -Last 20
```

Common causes:
- Network drop. Phase 4.0 Part 5 backoff handles this with
  exponential retry + ±20% jitter; the agent logs each
  retry attempt and the resolved category (DNS_FAILURE,
  SERVER_UNREACHABLE, etc.).
- Backend revision rolled back. Check
  `https://operator-os-api-m545sz2isq-ez.a.run.app/health`
  (200 = up; anything else means the api is down).
- Token revoked. Look for `source: 'fatal-auth-handler'`
  with `eventType: 'token-revoked'` — exit 87 path.

### Agent uses the wrong Claude session

The agent reads OAuth from
`~\.claude\.credentials.json`. If you have multiple Claude
Code installs / profiles, only that one is consulted.

```powershell
claude /status
```

Should show the same email you expect the agent to bill
against (Max subscription).

### High log volume

Daily rotation in place — each day produces a new file
named `agent-YYYYMMDD.log`. Old files are kept indefinitely
until you clean them:

```powershell
Get-ChildItem "$env:APPDATA\operator-os\logs\" -Filter 'agent-*.log' |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) |
    Remove-Item
```

A 30-day retention is a reasonable default for forensics
without filling disk. Adjust as needed.

### Task runs but agent immediately exits 87

The most common path: a token rotation was missed (e.g. the
agent was offline when the rotation overlap window expired)
and the next connect sees a 401 from the backend, which
cascades to `FatalAuthHandler` → exit 87.

Re-register:
```powershell
pnpm --filter @operator-os/desktop-agent register
```

The new token replaces the DPAPI-encrypted entry under
`OperatorOS:agent-token`; the next task run picks it up.

## Diagnostic commands

### Task status snapshot
```powershell
schtasks /Query /TN "OperatorOS Agent" /V /FO LIST
```

### Stop and restart manually
```powershell
schtasks /End /TN "OperatorOS Agent"
schtasks /Run /TN "OperatorOS Agent"
```

### Live log tail
```powershell
Get-Content "$env:APPDATA\operator-os\logs\agent-$(Get-Date -Format 'yyyyMMdd').log" -Wait -Tail 50
```

### Confirm the agent process is running
```powershell
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -like '*Operator-OS-Dev*' }
```

The wrapper script itself is `powershell.exe`; the agent is
the spawned `node.exe` reading from
`apps/desktop-agent/dist/main.js`.

### Inspect last 24h of WRAPPER-level events only
```powershell
Select-String -Path "$env:APPDATA\operator-os\logs\agent-$(Get-Date -Format 'yyyyMMdd').log" `
  -Pattern '\[WRAPPER\]'
```

The wrapper prefixes its own emit lines with `[WRAPPER]`;
the spawned agent's pino output is prefixed `[AGENT]`. Use
this to quickly separate "task scheduler / preflight" issues
from "agent runtime" issues.

## Escalation

If the daily log shows no agent output at all (only
`[WRAPPER]` lines), the wrapper itself is failing before
spawn — most often missing claude CLI (88), missing Max
session (89), or missing dist/main.js (91). The wrapper's
own log lines name the cause.

If the agent spawns but exits non-zero with no preceding
error log, capture:
- The most recent `agent-YYYYMMDD.log` (last 200 lines).
- `schtasks /Query /TN "OperatorOS Agent" /V /FO LIST`.
- The output of `Get-Process node`.

Open an issue with those three artefacts. Phase 4.0 Part 9
(end-to-end verification) will codify the standard repro
flow for these scenarios.
