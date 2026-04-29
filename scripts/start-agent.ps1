#Requires -Version 5.1

<#
.SYNOPSIS
    Wrapper for the Operator-OS desktop agent. Runs preflight,
    spawns `node dist/main.js`, captures stdout/stderr to a
    daily-rotated log file, and translates the agent's exit
    code into a Task-Scheduler-friendly value.

.DESCRIPTION
    Phase 4.0 Part 6 — implements ADR-025 D3 amendment 4.

    Designed to be invoked by the Windows Scheduled Task
    "OperatorOS Agent" (logon trigger). NOT intended for
    direct interactive use, though it works for that — the
    log path under %APPDATA%\operator-os\logs is the same.

    Exit code translation:
      87 (AGENT_TOKEN_REVOKED) → wrapper exits 0 so the
          Scheduled Task does NOT auto-restart. The agent
          needs the user to re-register; thrashing is worse
          than silence. Operator sees the FATAL log line.
      0  → wrapper exits 0 (clean).
      Else → wrapper propagates the code so the Task
          Scheduler's RestartOnFailure (3×1min) kicks in.

    Override the agent root by setting OPERATOR_OS_AGENT_ROOT
    before invocation (or in the Scheduled Task action's
    environment) — the default is the Akmal-dev path.

.NOTES
    Exit code taxonomy:
      0   clean shutdown
      87  AGENT_TOKEN_REVOKED — manual re-registration needed
      88  claude CLI missing
      89  Max session credentials missing
      90  agent root path not found
      91  agent dist/main.js not built
#>

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------
# Logging plumbing
# ---------------------------------------------------------------

$appData = [Environment]::GetFolderPath('ApplicationData')
$configDir = Join-Path $appData 'operator-os'
$logsDir = Join-Path $configDir 'logs'
$today = Get-Date -Format 'yyyyMMdd'
$logFile = Join-Path $logsDir "agent-$today.log"

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Write-AgentLog {
    param(
        [Parameter(Mandatory)] [string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR', 'FATAL')]
        [string]$Level = 'INFO'
    )
    $timestamp = (Get-Date).ToUniversalTime().ToString('o')
    $line = "[$timestamp] [WRAPPER] [$Level] $Message"
    Add-Content -Path $logFile -Value $line -Encoding utf8
    # Mirror to stdout so an interactive run / Task Scheduler
    # event log carries the same content.
    Write-Output $line
}

Write-AgentLog "agent wrapper starting (pid $PID)"

# ---------------------------------------------------------------
# Preflight: claude CLI
# ---------------------------------------------------------------

try {
    $claudeRaw = & claude --version 2>&1
    $claudeVersion = ($claudeRaw -join ' ').Trim()
    Write-AgentLog "claude CLI: $claudeVersion"
} catch {
    Write-AgentLog "FATAL: claude CLI not found on PATH ($_)" 'FATAL'
    exit 88
}

# ---------------------------------------------------------------
# Preflight: Max session credentials
# ---------------------------------------------------------------

$credPath = Join-Path $env:USERPROFILE '.claude\.credentials.json'
if (-not (Test-Path $credPath)) {
    Write-AgentLog "FATAL: Max session credentials not found at $credPath" 'FATAL'
    Write-AgentLog "       Run 'claude login' to authenticate, then re-run." 'FATAL'
    exit 89
}
Write-AgentLog "Max session credentials present"

# ---------------------------------------------------------------
# Resolve agent root + entry point
# ---------------------------------------------------------------

$agentRoot = $env:OPERATOR_OS_AGENT_ROOT
if ([string]::IsNullOrWhiteSpace($agentRoot)) {
    $agentRoot = 'D:\Operator-OS-Dev\apps\desktop-agent'
}

if (-not (Test-Path $agentRoot)) {
    Write-AgentLog "FATAL: agent root not found: $agentRoot" 'FATAL'
    Write-AgentLog "       Set OPERATOR_OS_AGENT_ROOT to the apps/desktop-agent path." 'FATAL'
    exit 90
}

$agentMain = Join-Path $agentRoot 'dist\main.js'
if (-not (Test-Path $agentMain)) {
    Write-AgentLog "FATAL: dist\main.js missing at $agentMain — build the workspace first" 'FATAL'
    Write-AgentLog "       cd <repo-root>; pnpm --filter @operator-os/desktop-agent build" 'FATAL'
    exit 91
}

Set-Location $agentRoot
Write-AgentLog "working directory: $agentRoot"

# ---------------------------------------------------------------
# Spawn agent + tee output
# ---------------------------------------------------------------

Write-AgentLog "spawning: node $agentMain"

# Use the call operator (&) and pipe stderr (2>&1) into stdout
# so a single ForEach-Object captures everything. Each line is
# prefixed with [AGENT] to distinguish from wrapper-emitted
# lines in the same log file.
& node $agentMain 2>&1 | ForEach-Object {
    $agentTs = (Get-Date).ToUniversalTime().ToString('o')
    Add-Content -Path $logFile -Value "[$agentTs] [AGENT] $_" -Encoding utf8
}

$exitCode = $LASTEXITCODE
Write-AgentLog "agent exited with code $exitCode"

# ---------------------------------------------------------------
# Translate exit code for Task Scheduler
# ---------------------------------------------------------------

switch ($exitCode) {
    0 {
        Write-AgentLog "clean shutdown — wrapper exits 0"
        exit 0
    }
    87 {
        Write-AgentLog "AGENT_TOKEN_REVOKED — manual re-registration required" 'FATAL'
        Write-AgentLog "  Run: pnpm --filter @operator-os/desktop-agent register" 'FATAL'
        Write-AgentLog "  Wrapper exits 0 to suppress Task Scheduler auto-restart." 'FATAL'
        exit 0
    }
    88 {
        Write-AgentLog "claude CLI missing — wrapper propagates code 88" 'ERROR'
        exit 88
    }
    89 {
        Write-AgentLog "Max session missing — wrapper propagates code 89" 'ERROR'
        exit 89
    }
    90 {
        Write-AgentLog "agent root missing — wrapper propagates code 90" 'ERROR'
        exit 90
    }
    91 {
        Write-AgentLog "agent not built — wrapper propagates code 91" 'ERROR'
        exit 91
    }
    default {
        Write-AgentLog "unexpected exit code $exitCode — propagating to Task Scheduler" 'WARN'
        exit $exitCode
    }
}
