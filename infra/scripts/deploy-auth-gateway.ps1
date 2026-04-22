param(
  [string]$ImageTag = "manual",
  [string]$RuntimeServiceAccount = "auth-gateway-runtime",
  [string]$SigningSecretName = "operator-jwt-secret",
  [string]$AcceptedGoogleClientIds = "1016254604177-rgvmifpm5sjr009nie8ga9psnoap69pg.apps.googleusercontent.com",
  [string]$BuildServiceAccount = "projects/operator-os-dev/serviceAccounts/deploy-bot@operator-os-dev.iam.gserviceaccount.com",
  [string]$SourceStagingDir = "gs://operator-os-dev-artifacts/cloud-build/source",
  [string]$LogDir = "gs://operator-os-dev-artifacts/cloud-build/logs",
  [switch]$UseCloudBuild = $true,
  [switch]$Deploy = $true
)

$ErrorActionPreference = "Stop"

$ProjectId = "operator-os-dev"
$Region = "europe-west4"
$ServiceName = "operator-auth-gateway"
$Repository = "operator-os-docker"
$ImageName = "auth-gateway"
$ImageUri = "europe-west4-docker.pkg.dev/${ProjectId}/${Repository}/${ImageName}:${ImageTag}"

# PORT is reserved by Cloud Run and is injected automatically
# based on the --port=8081 flag below. Setting PORT via
# --set-env-vars makes `gcloud run deploy` fail with
# "spec.template.spec.containers[0].env: The following reserved
# env names were provided: PORT". See docs/TECH_DEBT.md TD-011.
$EnvVars = @(
  "NODE_ENV=production",
  "HOST=0.0.0.0",
  "LOG_LEVEL=info",
  "GOOGLE_CLOUD_PROJECT=$ProjectId",
  "FIREBASE_PROJECT_ID=$ProjectId",
  "AUTH_GATEWAY_SERVICE_NAME=$ServiceName",
  "AUTH_ACCESS_TOKEN_ISSUER=$ServiceName",
  "AUTH_ACCESS_TOKEN_AUDIENCE=operator-os-api",
  "AUTH_ACCESS_TOKEN_TTL_SECONDS=3600",
  "AUTH_REFRESH_TOKEN_TTL_SECONDS=2592000",
  "AUTH_JWT_SIGNING_SECRET_NAME=$SigningSecretName",
  "AUTH_ACCEPTED_GOOGLE_CLIENT_IDS=$AcceptedGoogleClientIds",
  "FIRESTORE_USERS_COLLECTION=users",
  "FIRESTORE_REFRESH_TOKENS_COLLECTION=refreshTokens",
  "READINESS_STRICT=true"
)

$EnvVarsValue = $EnvVars -join ","

Write-Host "Preparing auth-gateway deployment for $ServiceName in $Region"
Write-Host "Image URI: $ImageUri"
Write-Host "Runtime SA: ${RuntimeServiceAccount}@${ProjectId}.iam.gserviceaccount.com"

if ($UseCloudBuild) {
  $deployValue = if ($Deploy) { "true" } else { "false" }

  $substitutions = @(
    "_IMAGE_TAG=$ImageTag",
    "_DEPLOY=$deployValue",
    "_RUNTIME_SA=$RuntimeServiceAccount",
    "_AUTH_JWT_SIGNING_SECRET_NAME=$SigningSecretName",
    "_AUTH_ACCEPTED_GOOGLE_CLIENT_IDS=$AcceptedGoogleClientIds"
  ) -join ","

  & gcloud builds submit `
    --project=$ProjectId `
    --service-account=$BuildServiceAccount `
    --gcs-source-staging-dir=$SourceStagingDir `
    --gcs-log-dir=$LogDir `
    --config=infra/cloudbuild/auth-gateway.cloudbuild.yaml `
    --substitutions=$substitutions `
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
  --service-account="${RuntimeServiceAccount}@${ProjectId}.iam.gserviceaccount.com" `
  --allow-unauthenticated `
  --port=8081 `
  --min-instances=0 `
  --max-instances=10 `
  --set-env-vars=$EnvVarsValue
