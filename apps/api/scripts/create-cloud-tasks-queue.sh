#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# create-cloud-tasks-queue.sh — Phase 3.2 task-dispatch retry queue
#
# Creates (idempotently):
#   - queue  task-dispatch-retry-${ENV}  in ${LOCATION}
#
# The queue receives delayed HTTP tasks targeting
#   POST ${API_URL}/v1/internal/tasks/retry-dispatch
# authenticated by a Google-issued OIDC ID token minted against
# ${API_URL} using CLOUD_RUN_SERVICE_ACCOUNT (wired in the api at
# run-time; the queue itself does not carry auth config).
#
# Usage:
#   ENV=dev      bash create-cloud-tasks-queue.sh
#   ENV=staging  bash create-cloud-tasks-queue.sh
#   ENV=prod     bash create-cloud-tasks-queue.sh
#
# Optional env overrides:
#   PROJECT_ID               default: operator-os-dev
#   LOCATION                 default: europe-west4  (MUST match api region
#                            per Phase 3.2 stop rule #11 — the legacy
#                            europe-west1 queues from Phase 2 are NOT
#                            co-located, see TD-034 for unification)
#   MAX_DISPATCHES_PER_SEC   default: 10
#   MAX_CONCURRENT           default: 50
#   MAX_ATTEMPTS             default: 5
#
# IAM preconditions (one-off, see infra/scripts/iam-bindings.sh):
#   * roles/cloudtasks.enqueuer on the queue for the api runtime SA
#     (cloudrun-runtime@${PROJECT_ID}.iam.gserviceaccount.com)
#
# Re-runnable: gated on `describe || create`; a second invocation is
# a no-op.
# ---------------------------------------------------------------------------

set -euo pipefail

ENV="${ENV:-dev}"
PROJECT_ID="${PROJECT_ID:-operator-os-dev}"
LOCATION="${LOCATION:-europe-west4}"
MAX_DISPATCHES_PER_SEC="${MAX_DISPATCHES_PER_SEC:-10}"
MAX_CONCURRENT="${MAX_CONCURRENT:-50}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-5}"

case "$ENV" in
  dev|staging|prod) ;;
  *)
    echo "ERROR: ENV must be dev|staging|prod, got: ${ENV}" >&2
    exit 2
    ;;
esac

QUEUE="task-dispatch-retry-${ENV}"

echo "==============================================================="
echo "  Cloud Tasks queue provisioning"
echo "    env:            ${ENV}"
echo "    project:        ${PROJECT_ID}"
echo "    location:       ${LOCATION}"
echo "    queue:          ${QUEUE}"
echo "    max dispatch/s: ${MAX_DISPATCHES_PER_SEC}"
echo "    max concurrent: ${MAX_CONCURRENT}"
echo "    max attempts:   ${MAX_ATTEMPTS}"
echo "==============================================================="

if gcloud tasks queues describe "${QUEUE}" \
    --location="${LOCATION}" \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "  [skip]  queue ${QUEUE} already exists in ${LOCATION}"
else
  gcloud tasks queues create "${QUEUE}" \
    --location="${LOCATION}" \
    --project="${PROJECT_ID}" \
    --max-dispatches-per-second="${MAX_DISPATCHES_PER_SEC}" \
    --max-concurrent-dispatches="${MAX_CONCURRENT}" \
    --max-attempts="${MAX_ATTEMPTS}" >/dev/null
  echo "  [ok]    queue ${QUEUE} created"
fi

echo "==============================================================="
echo "  Done."
echo "==============================================================="
