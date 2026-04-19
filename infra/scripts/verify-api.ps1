param(
  [string]$ProjectId = "operator-os-dev",
  [string]$Region = "europe-west4",
  [string]$ServiceName = "operator-os-api"
)

$ErrorActionPreference = "Stop"

$ServiceUrl = & gcloud run services describe $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --format="value(status.url)"

if (-not $ServiceUrl) {
  throw "Could not resolve Cloud Run URL for $ServiceName."
}

$Token = & gcloud auth print-identity-token

if (-not $Token) {
  throw "Could not obtain an identity token for verification."
}

$Headers = @{
  Authorization = "Bearer $Token"
}

Write-Host "Verifying $ServiceUrl/health"
$Health = Invoke-RestMethod -Uri "$ServiceUrl/health" -Headers $Headers
$Ready = Invoke-RestMethod -Uri "$ServiceUrl/ready" -Headers $Headers

Write-Host "Health response:"
$Health | ConvertTo-Json -Depth 10

Write-Host "Readiness response:"
$Ready | ConvertTo-Json -Depth 10
