# OperatorOS Agent — Setup Guide

This document walks a fresh Windows install through the
one-time setup needed for the desktop agent to run as a
permanent background service. Phase 4.0 Part 6.

## What you end up with

- A registered desktop agent identity on the backend
  (per-machine token, DPAPI-encrypted at rest).
- A Windows Scheduled Task named **OperatorOS Agent** that
  starts the agent at user logon and restarts it 3× on
  failure.
- A canonical log path: `%APPDATA%\operator-os\logs\agent-YYYYMMDD.log`.
- Mobile shows the agent online whenever your user is logged in.

## Prerequisites

1. **Claude Code CLI on PATH.** Verify:
   ```powershell
   claude --version
   ```
   Should print `2.x.x` or later.

2. **Active Claude Max session.** Verify:
   ```powershell
   claude /status
   ```
   Should show an authenticated session. If not:
   ```powershell
   claude login
   ```

3. **Repository cloned and built.**
   ```powershell
   cd D:\Operator-OS-Dev
   pnpm install
   pnpm --filter @operator-os/desktop-agent build
   ```
   The Scheduled Task expects `apps/desktop-agent/dist/main.js`
   to exist; the wrapper script will refuse to start if it's
   missing (exit 91).

## Step 1: Register the agent

```powershell
cd D:\Operator-OS-Dev
pnpm --filter @operator-os/desktop-agent register
```

The CLI walks six steps:

1. Max-session preflight (reads `~\.claude\.credentials.json`).
2. Backend URL + a fresh user JWT (mint from the mobile app
   or paste a known-good token).
3. JWT shape + expiry validation.
4. Hostname normalisation.
5. Round-trip: `POST /v1/agent/register` → returns the raw
   per-machine token.
6. Persist the token to Windows Credential Manager
   (DPAPI-encrypted, `OperatorOS:agent-token`).

A successful run prints the new `agentId`. Mobile's Devices
tab will show the agent (offline until step 2 completes).

## Step 2: Install autostart

No admin rights required.

```powershell
cd D:\Operator-OS-Dev
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\install-agent-autostart.ps1
```

The installer:

- Creates `%APPDATA%\operator-os\` with `logs/`, `cache/`,
  `state/` subdirs.
- Copies `start-agent.ps1` to `%APPDATA%\operator-os\` so the
  scheduled task references a stable path that survives repo
  moves.
- Writes a Scheduled Task XML and registers it via
  `schtasks /Create /XML ... /F`.

Expected output:
```
[OK] Scheduled Task installed
  Task name:           OperatorOS Agent
  Trigger:             At logon
  Principal:           current user (LeastPrivilege)
  Restart on failure:  3 retries × 1 min interval
  Logs:                C:\Users\<you>\AppData\Roaming\operator-os\logs\agent-YYYYMMDD.log
```

## Step 3: Verify

Either reboot, or trigger the task manually:

```powershell
schtasks /Run /TN "OperatorOS Agent"
```

Tail the log:

```powershell
Get-Content "$env:APPDATA\operator-os\logs\agent-$(Get-Date -Format 'yyyyMMdd').log" -Wait -Tail 50
```

A healthy run looks like:
```
[<UTC>] [WRAPPER] [INFO] agent wrapper starting (pid 12345)
[<UTC>] [WRAPPER] [INFO] claude CLI: 2.x.x
[<UTC>] [WRAPPER] [INFO] Max session credentials present
[<UTC>] [WRAPPER] [INFO] working directory: D:\Operator-OS-Dev\apps\desktop-agent
[<UTC>] [WRAPPER] [INFO] spawning: node D:\Operator-OS-Dev\apps\desktop-agent\dist\main.js
[<UTC>] [AGENT]   {"level":30,...,"msg":"control channel welcomed sessionId ..."}
```

On mobile's Devices tab the agent should now show:
- **Status:** online
- **Last heartbeat:** seconds ago

## Custom installation paths

If you've cloned the repo somewhere other than the default
`D:\Operator-OS-Dev`, set an environment variable in the
Scheduled Task action **before** registration:

```powershell
[Environment]::SetEnvironmentVariable(
    'OPERATOR_OS_AGENT_ROOT',
    'C:\path\to\apps\desktop-agent',
    'User'
)
```

Then re-run `install-agent-autostart.ps1` so the Scheduled
Task picks up the new env (it inherits user-scope vars at
logon).

## Updating the agent

TD-059 (signed self-update pipeline) is deferred to Phase 4.0.1.
For now, manual updates:

```powershell
cd D:\Operator-OS-Dev
git pull
pnpm install
pnpm --filter @operator-os/desktop-agent build
schtasks /End /TN "OperatorOS Agent"
schtasks /Run /TN "OperatorOS Agent"
```

The `schtasks /End` then `/Run` cycle is faster than waiting
for the StopExisting policy to fire on the next logon.

## Uninstall

```powershell
cd D:\Operator-OS-Dev
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts\uninstall-agent-autostart.ps1
```

Deletes the Scheduled Task and prompts before removing the
config directory. The agent token in Windows Credential
Manager is **not** deleted automatically — revoke via the
backend (mobile's Devices → Revoke, or `DELETE /v1/agent/:id`)
if you want forensic separation.

## See also

- `docs/AGENT_TROUBLESHOOTING.md` — exit codes, common
  failure modes, diagnostics commands.
- ADR-025 D3 + amendment 4 in `docs/DECISIONS.md`.
- `apps/desktop-agent/src/auth/fatal-auth-handler.ts` —
  source of exit code 87 (`AGENT_TOKEN_REVOKED`).
