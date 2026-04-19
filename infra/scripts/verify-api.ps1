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

function Invoke-VerifiedRequest {
  param(
    [string]$Uri
  )

  try {
    $response = Invoke-WebRequest -Uri $Uri -Headers $Headers -UseBasicParsing

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Body = $response.Content
    }
  } catch {
    if ($null -eq $_.Exception.Response) {
      throw
    }

    return [pscustomobject]@{
      StatusCode = [int]$_.Exception.Response.StatusCode
      Body = $_.ErrorDetails.Message
    }
  }
}

Write-Host "Verifying $ServiceUrl/health"
$Health = Invoke-VerifiedRequest -Uri "$ServiceUrl/health"
$Ready = Invoke-VerifiedRequest -Uri "$ServiceUrl/ready"

Write-Host "Health response:"
$Health | ConvertTo-Json -Depth 10

Write-Host "Readiness response:"
$Ready | ConvertTo-Json -Depth 10

if ($Health.StatusCode -ne 200) {
  throw "Health check failed with HTTP $($Health.StatusCode)."
}

if ($Ready.StatusCode -notin @(200, 503)) {
  throw "Readiness check returned unexpected HTTP $($Ready.StatusCode)."
}
