#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# grant-pubsub-publisher.sh — Grant the Cloud Run runtime service account
# `roles/pubsub.publisher` on both task-dispatch topics so the api can
# publish dispatch events from POST /v1/tasks.
#
# Smoke-test backstory: Phase 3.3's first authenticated end-to-end POST in
# production failed because the api's runtime SA had no IAM binding on the
# task-dispatch-${ENV} topic. Phase 3.2 deployed the dispatch infra (Pub/Sub
# topics, Cloud Tasks queue, env vars) but never granted the runtime SA the
# `pubsub.publisher` role on the topics it needs to publish to. The dispatch
# leg silently failed under PERMISSION_DENIED; the smoke test caught it.
#
# Idempotent: re-running this script after the binding already exists is a
# no-op. `add-iam-policy-binding` adds the member to the role's list; if
# already there, gcloud reports the same policy and exits 0.
#
# Usage:
#   bash apps/api/scripts/iam/grant-pubsub-publisher.sh
#   bash apps/api/scripts/iam/grant-pubsub-publisher.sh --project=other-project
#
# Defaults match the Phase 3 dev environment. Override the env wiring via
# CLI flags if you ever spin up `task-dispatch-prod`.
# ---------------------------------------------------------------------------

set -euo pipefail

PROJECT="${PROJECT:-operator-os-dev}"
RUNTIME_SA="${RUNTIME_SA:-cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com}"
TOPICS=(
  "${TOPIC_DISPATCH:-task-dispatch-dev}"
  "${TOPIC_DLQ:-task-dispatch-dlq-dev}"
)

# Allow `--project=foo` to override.
for arg in "$@"; do
  case "$arg" in
    --project=*)
      PROJECT="${arg#*=}"
      ;;
    --runtime-sa=*)
      RUNTIME_SA="${arg#*=}"
      ;;
  esac
done

echo "Granting roles/pubsub.publisher on:"
printf '  - %s\n' "${TOPICS[@]}"
echo "to: serviceAccount:${RUNTIME_SA}"
echo "project: ${PROJECT}"
echo ""

for topic in "${TOPICS[@]}"; do
  echo "→ ${topic}"
  gcloud pubsub topics add-iam-policy-binding "${topic}" \
    --project="${PROJECT}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/pubsub.publisher" \
    >/dev/null
  echo "  ✓ bound"
done

echo ""
echo "All done. Verify with:"
echo "  gcloud pubsub topics get-iam-policy ${TOPICS[0]} --project=${PROJECT}"
