param(
  [string]$ImageTag = "manual",
  [switch]$UseCloudBuild = $true,
  [switch]$Deploy = $true
)

$ErrorActionPreference = "Stop"

$ProjectId = "operator-os-dev"
$Region = "europe-west4"
$ServiceName = "operator-os-api"
$Repository = "operator-os-docker"
$ImageUri = "europe-west4-docker.pkg.dev/$ProjectId/$Repository/$ServiceName:$ImageTag"

Write-Host "Preparing API deployment for $ServiceName in $Region"
Write-Host "Image URI: $ImageUri"

if ($UseCloudBuild) {
  $deployValue = if ($Deploy) { "true" } else { "false" }

  & gcloud builds submit `
    --project=$ProjectId `
    --config=infra/cloudbuild/api.cloudbuild.yaml `
    --substitutions="_IMAGE_TAG=$ImageTag,_DEPLOY=$deployValue" `
    .

  exit $LASTEXITCODE
}

if (-not $Deploy) {
  Write-Host "Deploy switch is false and Cloud Build is disabled, so nothing was deployed."
  exit 0
}

& gcloud run deploy $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --image=$ImageUri `
  --platform=managed `
  --service-account="cloudrun-runtime@$ProjectId.iam.gserviceaccount.com" `
  --no-allow-unauthenticated `
  --port=8080 `
  --set-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=$ProjectId,VERTEX_LOCATION=$Region,VERTEX_MODEL=gemini-2.5-flash"
