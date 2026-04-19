param(
  [string]$ProjectId = "operator-os-dev",
  [string]$RuntimeServiceAccount = "cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com",
  [switch]$Apply = $false
)

$ErrorActionPreference = "Stop"

$Commands = @(
  "gcloud projects add-iam-policy-binding $ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/aiplatform.user",
  "gcloud projects add-iam-policy-binding $ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/datastore.user",
  "gcloud tasks queues add-iam-policy-binding commands --location=europe-west1 --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/cloudtasks.enqueuer",
  "gcloud tasks queues add-iam-policy-binding approvals --location=europe-west1 --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/cloudtasks.enqueuer",
  "gcloud tasks queues add-iam-policy-binding exports --location=europe-west1 --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/cloudtasks.enqueuer",
  "gcloud pubsub topics add-iam-policy-binding agent-events --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/pubsub.publisher",
  "gcloud pubsub topics add-iam-policy-binding budget-events --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/pubsub.publisher",
  "gcloud pubsub topics add-iam-policy-binding operator-alerts --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/pubsub.publisher",
  "gcloud pubsub topics add-iam-policy-binding session-events --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/pubsub.publisher",
  "gcloud secrets add-iam-policy-binding operator-jwt-secret --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/secretmanager.secretAccessor",
  "gcloud secrets add-iam-policy-binding session-signing-secret --project=$ProjectId --member=serviceAccount:$RuntimeServiceAccount --role=roles/secretmanager.secretAccessor",
  "gcloud storage buckets add-iam-policy-binding gs://operator-os-dev-artifacts --member=serviceAccount:$RuntimeServiceAccount --role=roles/storage.objectAdmin",
  "gcloud storage buckets add-iam-policy-binding gs://operator-os-dev-exports --member=serviceAccount:$RuntimeServiceAccount --role=roles/storage.objectAdmin",
  "gcloud storage buckets add-iam-policy-binding gs://operator-os-dev-remote --member=serviceAccount:$RuntimeServiceAccount --role=roles/storage.objectViewer",
  "bq add-iam-policy-binding --member=serviceAccount:$RuntimeServiceAccount --role=roles/bigquery.dataEditor $ProjectId:ops_analytics"
)

Write-Host "Prepared least-privilege IAM bindings for $RuntimeServiceAccount"

foreach ($command in $Commands) {
  if ($Apply) {
    Write-Host "Applying: $command"
    Invoke-Expression $command
  } else {
    Write-Host $command
  }
}

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry run only. Re-run with -Apply after reviewing docs/IAM_PLAN.md."
}
