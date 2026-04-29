#Requires -Version 5.1

<#
.SYNOPSIS
    Install the Windows Scheduled Task that auto-starts the
    Operator-OS desktop agent at user logon.

.DESCRIPTION
    Phase 4.0 Part 6 — implements ADR-025 D3 amendment 4.

    Creates %APPDATA%\operator-os\ (config + logs + cache +
    state subdirs), copies start-agent.ps1 alongside, and
    registers a Scheduled Task named "OperatorOS Agent" via
    schtasks.exe + an XML definition.

    Idempotent: safe to re-run. The /F flag overwrites an
    existing task with the same name.

    Runs as the invoking user at LeastPrivilege — NOT SYSTEM.
    The agent reads ~\.claude\.credentials.json which is per-
    user; running as SYSTEM would lose that access.

.NOTES
    No admin rights required. The Task Scheduler logon-trigger
    + InteractiveToken combination works under standard user
    permissions.
#>

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '== OperatorOS Agent — install autostart ==' -ForegroundColor Cyan
Write-Host ''

# ---------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------

$appData = [Environment]::GetFolderPath('ApplicationData')
$configDir = Join-Path $appData 'operator-os'
$logsDir = Join-Path $configDir 'logs'
$cacheDir = Join-Path $configDir 'cache'
$stateDir = Join-Path $configDir 'state'

Write-Host "Config dir: $configDir"
foreach ($d in @($configDir, $logsDir, $cacheDir, $stateDir)) {
    New-Item -ItemType Directory -Path $d -Force | Out-Null
}

# ---------------------------------------------------------------
# Copy start-agent.ps1 to a stable location under %APPDATA%.
# ---------------------------------------------------------------
# Reasoning: the script source path under the repo can move,
# but %APPDATA%\operator-os is permanent for this user. The
# Scheduled Task references the copy, not the repo path.

$scriptSource = Join-Path $PSScriptRoot 'start-agent.ps1'
$scriptDest = Join-Path $configDir 'start-agent.ps1'

if (-not (Test-Path $scriptSource)) {
    Write-Host "ERROR: start-agent.ps1 missing at $scriptSource" -ForegroundColor Red
    Write-Host '       Run this from the repo scripts/ directory.' -ForegroundColor Red
    exit 1
}

Copy-Item $scriptSource $scriptDest -Force
Write-Host "Copied start script: $scriptDest"

# ---------------------------------------------------------------
# Build Scheduled Task XML
# ---------------------------------------------------------------
# RestartOnFailure 3×1min covers transient WS / network blips.
# Exit code 87 (AGENT_TOKEN_REVOKED) is rewritten to 0 by the
# wrapper, so Task Scheduler's "any non-zero retries" policy
# does NOT thrash a revoked-token scenario.
#
# RunLevel LeastPrivilege intentional — the agent reads
# ~\.claude\.credentials.json (per-user OAuth), so running as
# SYSTEM would lose that access.
#
# StopExisting on duplicate spawn so a manual `schtasks /Run`
# doesn't double-spawn while the logon-triggered instance is
# still active.

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>OperatorOS Agent — auto-start at user logon (Phase 4.0 Part 6).</Description>
    <Author>Akmal Khujdarov</Author>
    <URI>\OperatorOS Agent</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>StopExisting</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$scriptDest"</Arguments>
    </Exec>
  </Actions>
</Task>
"@

# ---------------------------------------------------------------
# Persist XML and register the task
# ---------------------------------------------------------------

$xmlPath = Join-Path $env:TEMP 'operator-os-agent-task.xml'
[System.IO.File]::WriteAllText(
    $xmlPath,
    $taskXml,
    [System.Text.Encoding]::Unicode  # schtasks requires UTF-16 LE
)

Write-Host 'Registering Scheduled Task...'
$schResult = & schtasks /Create /XML $xmlPath /TN 'OperatorOS Agent' /F 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ''
    Write-Host '[OK] Scheduled Task installed' -ForegroundColor Green
    Write-Host ''
    Write-Host "  Task name:           OperatorOS Agent"
    Write-Host "  Trigger:             At logon"
    Write-Host "  Principal:           current user (LeastPrivilege)"
    Write-Host "  Action:              powershell.exe -File $scriptDest"
    Write-Host "  Restart on failure:  3 retries × 1 min interval"
    Write-Host "  Logs:                $logsDir\agent-YYYYMMDD.log"
    Write-Host ''
    Write-Host 'Next steps:'
    Write-Host '  1. Reboot OR run:    schtasks /Run /TN "OperatorOS Agent"'
    Write-Host '  2. Verify status:    schtasks /Query /TN "OperatorOS Agent" /V /FO LIST'
    Write-Host '  3. Tail logs:        Get-Content "$env:APPDATA\operator-os\logs\agent-*.log" -Wait -Tail 50'
} else {
    Write-Host ''
    Write-Host '[FAIL] schtasks reported a failure' -ForegroundColor Red
    Write-Host $schResult
    exit 1
}

Remove-Item $xmlPath -Force -ErrorAction SilentlyContinue
