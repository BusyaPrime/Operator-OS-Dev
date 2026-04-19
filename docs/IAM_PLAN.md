# IAM Plan

## Scope

This plan covers the Cloud Run runtime identity used by the API:

- service account: `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

The goal is least-privilege for the current pass-2 API foundation. No `Owner`, `Editor`, or broad admin roles are required for the runtime itself.

## Recommended Bindings

### Project-Level

- `roles/aiplatform.user`
  Why: required for Vertex AI / Gemini inference calls.
- `roles/datastore.user`
  Why: required for Firestore document reads and writes via the server-side API.

### Queue-Level

- `roles/cloudtasks.enqueuer` on:
  - `commands`
  - `approvals`
  - `exports`
  Why: the API only enqueues tasks; it does not need queue admin rights.

### Topic-Level

- `roles/pubsub.publisher` on:
  - `agent-events`
  - `budget-events`
  - `operator-alerts`
  - `session-events`
  Why: the API publishes typed operational events and does not need subscriber/admin rights.

### Secret-Level

- `roles/secretmanager.secretAccessor` on:
  - `operator-jwt-secret`
  - `session-signing-secret`
  Why: runtime code reads secret payloads but does not rotate or administer them.

Notes:

- `github-token` is intentionally not included in the default runtime plan because the current API code path does not need it.
- Add it only if a real GitHub integration path is introduced.

### Bucket-Level

- `roles/storage.objectAdmin` on:
  - `gs://operator-os-dev-artifacts`
  - `gs://operator-os-dev-exports`
  Why: the API currently writes JSON artifacts and export requests and may need to overwrite them during bootstrap.
- `roles/storage.objectViewer` on:
  - `gs://operator-os-dev-remote`
  Why: current code only needs read-ready access for future remote/session asset retrieval.

### Dataset-Level

- `roles/bigquery.dataEditor` on dataset `ops_analytics`
  Why: the API writes analytics rows. If future flows need query jobs, add `roles/bigquery.jobUser` separately instead of broadening the dataset role.

## Not Applied Automatically

These bindings were not applied during this pass because the local `gcloud` account and ADC state were not configured, and overgranting would have been riskier than leaving an explicit plan.

Use:

- [infra/scripts/iam-bindings.ps1](/D:/Operator-OS-Dev/infra/scripts/iam-bindings.ps1)
- [infra/scripts/iam-bindings.sh](/D:/Operator-OS-Dev/infra/scripts/iam-bindings.sh)

Both scripts default to dry-run output so the commands can be reviewed before execution.
