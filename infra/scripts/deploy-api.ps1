param(
  [string]$ImageTag = "manual",
  [string]$TasksTargetBaseUrl = "https://operator-os-api-m545sz2isq-ez.a.run.app",
  [string]$BuildServiceAccount = "projects/operator-os-dev/serviceAccounts/deploy-bot@operator-os-dev.iam.gserviceaccount.com",
  [string]$SourceStagingDir = "gs://operator-os-dev-artifacts/cloud-build/source",
  [string]$LogDir = "gs://operator-os-dev-artifacts/cloud-build/logs",
  [switch]$UseCloudBuild = $true,
  [switch]$Deploy = $true
)

$ErrorActionPreference = "Stop"

$ProjectId = "operator-os-dev"
$Region = "europe-west4"
$ServiceName = "operator-os-api"
$Repository = "operator-os-docker"
$ImageUri = "europe-west4-docker.pkg.dev/${ProjectId}/${Repository}/${ServiceName}:${ImageTag}"

$EnvVars = @(
  "NODE_ENV=production",
  "GOOGLE_CLOUD_PROJECT=$ProjectId",
  "GOOGLE_CLOUD_REGION=$Region",
  "FIREBASE_PROJECT_ID=$ProjectId",
  "VERTEX_LOCATION=$Region",
  "VERTEX_MODEL=gemini-2.5-flash",
  "BIGQUERY_DATASET=ops_analytics",
  "CLOUD_TASKS_LOCATION=europe-west1"
)

if (-not [string]::IsNullOrWhiteSpace($TasksTargetBaseUrl)) {
  $EnvVars += "TASKS_TARGET_BASE_URL=$TasksTargetBaseUrl"
}

$EnvVarsValue = $EnvVars -join ","

Write-Host "Preparing API deployment for $ServiceName in $Region"
Write-Host "Image URI: $ImageUri"

if ($UseCloudBuild) {
  $deployValue = if ($Deploy) { "true" } else { "false" }

  & gcloud builds submit `
    --project=$ProjectId `
    --service-account=$BuildServiceAccount `
    --gcs-source-staging-dir=$SourceStagingDir `
    --gcs-log-dir=$LogDir `
    --config=infra/cloudbuild/api.cloudbuild.yaml `
    --substitutions="_IMAGE_TAG=$ImageTag,_DEPLOY=$deployValue,_TASKS_TARGET_BASE_URL=$TasksTargetBaseUrl" `
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
  --set-env-vars=$EnvVarsValue
