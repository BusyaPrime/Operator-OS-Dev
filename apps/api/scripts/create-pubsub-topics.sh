#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# create-pubsub-topics.sh — Phase 3.2 task-dispatch Pub/Sub resources
#
# Creates (idempotently):
#   - topic        task-dispatch-${ENV}
#   - topic        task-dispatch-dlq-${ENV}
#   - subscription task-dispatch-api-${ENV}      (push → /v1/internal/pubsub/task-dispatch)
#   - subscription task-dispatch-dlq-api-${ENV}  (push → /v1/internal/pubsub/task-dlq)
#
# Usage:
#   ENV=dev      bash create-pubsub-topics.sh
#   ENV=staging  bash create-pubsub-topics.sh
#   ENV=prod     bash create-pubsub-topics.sh
#
# Optional env overrides:
#   PROJECT_ID           default: operator-os-dev
#   API_URL              default: https://operator-os-api-m545sz2isq-ez.a.run.app
#   PUSH_SERVICE_ACCOUNT default: cloudrun-runtime@${PROJECT_ID}.iam.gserviceaccount.com
#   ACK_DEADLINE         default: 60 (seconds)
#   MAX_DELIVERY         default: 5 (attempts before DLQ)
#
# IAM preconditions (one-off, see infra/scripts/iam-bindings.sh):
#   * roles/iam.serviceAccountTokenCreator on PUSH_SERVICE_ACCOUNT for
#     service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com
#   * roles/run.invoker on the api service for PUSH_SERVICE_ACCOUNT
#
# Re-runnable: every step is gated on `describe || create`; a second
# invocation is a no-op.
# ---------------------------------------------------------------------------

set -euo pipefail

ENV="${ENV:-dev}"
PROJECT_ID="${PROJECT_ID:-operator-os-dev}"
API_URL="${API_URL:-https://operator-os-api-m545sz2isq-ez.a.run.app}"
PUSH_SERVICE_ACCOUNT="${PUSH_SERVICE_ACCOUNT:-cloudrun-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
ACK_DEADLINE="${ACK_DEADLINE:-60}"
MAX_DELIVERY="${MAX_DELIVERY:-5}"

case "$ENV" in
  dev|staging|prod) ;;
  *)
    echo "ERROR: ENV must be dev|staging|prod, got: ${ENV}" >&2
    exit 2
    ;;
esac

TOPIC_DISPATCH="task-dispatch-${ENV}"
SUB_DISPATCH="task-dispatch-api-${ENV}"
TOPIC_DLQ="task-dispatch-dlq-${ENV}"
SUB_DLQ="task-dispatch-dlq-api-${ENV}"

echo "==============================================================="
echo "  Pub/Sub provisioning for env=${ENV} project=${PROJECT_ID}"
echo "    api URL:              ${API_URL}"
echo "    push service account: ${PUSH_SERVICE_ACCOUNT}"
echo "    ack deadline:         ${ACK_DEADLINE}s"
echo "    max delivery:         ${MAX_DELIVERY}"
echo "==============================================================="

create_topic() {
  local topic="$1"
  if gcloud pubsub topics describe "${topic}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "  [skip]  topic  ${topic} already exists"
  else
    gcloud pubsub topics create "${topic}" --project="${PROJECT_ID}" >/dev/null
    echo "  [ok]    topic  ${topic} created"
  fi
}

create_push_subscription() {
  local sub="$1"
  local topic="$2"
  local path="$3"
  local dead_letter="${4:-}"
  if gcloud pubsub subscriptions describe "${sub}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "  [skip]  sub    ${sub} already exists"
    return 0
  fi
  local args=(
    --project="${PROJECT_ID}"
    --topic="${topic}"
    --push-endpoint="${API_URL}${path}"
    --push-auth-service-account="${PUSH_SERVICE_ACCOUNT}"
    --push-auth-token-audience="${API_URL}"
    --ack-deadline="${ACK_DEADLINE}"
    --min-retry-delay=10s
    --max-retry-delay=600s
  )
  if [[ -n "${dead_letter}" ]]; then
    args+=(
      --dead-letter-topic="${dead_letter}"
      --max-delivery-attempts="${MAX_DELIVERY}"
    )
  fi
  gcloud pubsub subscriptions create "${sub}" "${args[@]}" >/dev/null
  echo "  [ok]    sub    ${sub} created (push → ${API_URL}${path})"
}

create_topic "${TOPIC_DISPATCH}"
create_topic "${TOPIC_DLQ}"

create_push_subscription \
  "${SUB_DISPATCH}" \
  "${TOPIC_DISPATCH}" \
  "/v1/internal/pubsub/task-dispatch" \
  "${TOPIC_DLQ}"

create_push_subscription \
  "${SUB_DLQ}" \
  "${TOPIC_DLQ}" \
  "/v1/internal/pubsub/task-dlq" \
  ""

echo "==============================================================="
echo "  Done. 2 topics + 2 subscriptions provisioned."
echo "==============================================================="
