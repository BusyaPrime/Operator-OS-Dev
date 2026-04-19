#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-operator-os-dev}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com}"
APPLY="${APPLY:-false}"

commands=(
  "gcloud projects add-iam-policy-binding ${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/aiplatform.user"
  "gcloud projects add-iam-policy-binding ${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/datastore.user"
  "gcloud tasks queues add-iam-policy-binding commands --location=europe-west1 --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/cloudtasks.enqueuer"
  "gcloud tasks queues add-iam-policy-binding approvals --location=europe-west1 --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/cloudtasks.enqueuer"
  "gcloud tasks queues add-iam-policy-binding exports --location=europe-west1 --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/cloudtasks.enqueuer"
  "gcloud pubsub topics add-iam-policy-binding agent-events --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/pubsub.publisher"
  "gcloud pubsub topics add-iam-policy-binding budget-events --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/pubsub.publisher"
  "gcloud pubsub topics add-iam-policy-binding operator-alerts --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/pubsub.publisher"
  "gcloud pubsub topics add-iam-policy-binding session-events --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/pubsub.publisher"
  "gcloud secrets add-iam-policy-binding operator-jwt-secret --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/secretmanager.secretAccessor"
  "gcloud secrets add-iam-policy-binding session-signing-secret --project=${PROJECT_ID} --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/secretmanager.secretAccessor"
  "gcloud storage buckets add-iam-policy-binding gs://operator-os-dev-artifacts --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/storage.objectAdmin"
  "gcloud storage buckets add-iam-policy-binding gs://operator-os-dev-exports --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/storage.objectAdmin"
  "gcloud storage buckets add-iam-policy-binding gs://operator-os-dev-remote --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/storage.objectViewer"
  "bq add-iam-policy-binding --member=serviceAccount:${RUNTIME_SERVICE_ACCOUNT} --role=roles/bigquery.dataEditor ${PROJECT_ID}:ops_analytics"
)

echo "Prepared least-privilege IAM bindings for ${RUNTIME_SERVICE_ACCOUNT}"

for command in "${commands[@]}"; do
  if [[ "${APPLY}" == "true" ]]; then
    echo "Applying: ${command}"
    eval "${command}"
  else
    echo "${command}"
  fi
done

if [[ "${APPLY}" != "true" ]]; then
  echo
  echo "Dry run only. Set APPLY=true after reviewing docs/IAM_PLAN.md."
fi
