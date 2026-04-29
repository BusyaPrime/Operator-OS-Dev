#Requires -Version 5.1

<#
.SYNOPSIS
    Remove the OperatorOS Agent Scheduled Task and (with
    confirmation) clean up the %APPDATA%\operator-os\
    config / log / state directory.

.DESCRIPTION
    Phase 4.0 Part 6 — companion to install-agent-autostart.ps1.

    Steps:
      1. End the running task (best-effort; ignored if not running).
      2. Delete the Scheduled Task by name.
      3. Prompt to delete the config directory.
         Default = NO (preserves logs for forensics).
      4. Reminder: revoke the agent token from the backend
         separately. This script does NOT touch DPAPI-encrypted
         credentials or backend records — those are user-driven.
#>

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '== OperatorOS Agent — uninstall autostart ==' -ForegroundColor Cyan
Write-Host ''

# ---------------------------------------------------------------
# Stop running task (best-effort, never throws)
# ---------------------------------------------------------------

$null = & schtasks /End /TN 'OperatorOS Agent' 2>&1
# Ignore exit code: /End fails when nothing is running.

# ---------------------------------------------------------------
# Delete scheduled task
# ---------------------------------------------------------------

$delResult = & schtasks /Delete /TN 'OperatorOS Agent' /F 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host '[OK] Scheduled Task removed.' -ForegroundColor Green
} else {
    Write-Host '[INFO] Task not found (already removed?). Continuing.' -ForegroundColor Yellow
    if ($delResult) {
        Write-Host "       schtasks: $delResult" -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------
# Optional config-directory cleanup
# ---------------------------------------------------------------

$appData = [Environment]::GetFolderPath('ApplicationData')
$configDir = Join-Path $appData 'operator-os'

if (Test-Path $configDir) {
    Write-Host ''
    Write-Host "Config directory: $configDir"
    $confirm = Read-Host 'Delete the config directory (logs, cache, state, start script)? [y/N]'
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        Remove-Item $configDir -Recurse -Force
        Write-Host '[OK] Config directory deleted.' -ForegroundColor Green
    } else {
        Write-Host "Preserved at $configDir."
    }
}

# ---------------------------------------------------------------
# Reminder: backend-side revocation is separate
# ---------------------------------------------------------------

Write-Host ''
Write-Host 'Reminder: this script does NOT revoke the agent token from the backend.' -ForegroundColor Yellow
Write-Host '  - Backend Firestore record stays "active" until DELETE /v1/agent/:id is called.' -ForegroundColor Yellow
Write-Host '  - Run the user-side revoke flow from mobile, OR:' -ForegroundColor Yellow
Write-Host '    pnpm --filter @operator-os/desktop-agent revoke   (when CLI lands)' -ForegroundColor Yellow
Write-Host ''
