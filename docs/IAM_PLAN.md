# IAM Plan

## Scope

This document now distinguishes between bindings that were applied during pass 3
and bindings that still require a follow-up.

Primary identities:

- runtime:
  `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`
- build/deploy:
  `deploy-bot@operator-os-dev.iam.gserviceaccount.com`

## Auto-Applied During Pass 3

### `cloudrun-runtime`

Project-level:

- `roles/aiplatform.user`
- `roles/datastore.user`

Queue-level:

- `roles/cloudtasks.enqueuer` on `commands`
- `roles/cloudtasks.enqueuer` on `approvals`
- `roles/cloudtasks.enqueuer` on `exports`

Topic-level:

- `roles/pubsub.publisher` on `agent-events`
- `roles/pubsub.publisher` on `budget-events`
- `roles/pubsub.publisher` on `operator-alerts`
- `roles/pubsub.publisher` on `session-events`

Secret-level:

- `roles/secretmanager.secretAccessor` on `operator-jwt-secret`
- `roles/secretmanager.secretAccessor` on `session-signing-secret`

Bucket-level:

- `roles/storage.objectAdmin` on `gs://operator-os-dev-artifacts`
- `roles/storage.objectAdmin` on `gs://operator-os-dev-exports`
- `roles/storage.objectViewer` on `gs://operator-os-dev-remote`

### `deploy-bot`

Project-level:

- `roles/cloudbuild.builds.builder`
- `roles/logging.logWriter`
- `roles/run.admin`

Resource-level:

- `roles/artifactregistry.writer` on repository `operator-os-docker`
- `roles/storage.objectAdmin` on `gs://operator-os-dev-artifacts`
- `roles/iam.serviceAccountUser` on
  `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

Service-account impersonation plumbing:

- `roles/iam.serviceAccountTokenCreator` for
  `service-1016254604177@gcp-sa-cloudbuild.iam.gserviceaccount.com` on
  `deploy-bot`
- `roles/iam.serviceAccountTokenCreator` for `user:xodarevakmal@gmail.com` on
  `deploy-bot`

Verification-only service access:

- `roles/run.invoker` on service `operator-os-api` for
  `serviceAccount:deploy-bot@operator-os-dev.iam.gserviceaccount.com`
- `roles/run.invoker` on service `operator-os-api` for
  `user:xodarevakmal@gmail.com`

## Manual / Follow-Up Needed

### BigQuery Dataset Write Access

Desired binding:

- `roles/bigquery.dataEditor` on dataset `ops_analytics` for
  `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

Why it was not auto-applied:

- `bq add-iam-policy-binding` returned:
  `This feature requires allowlisting.`
- I did not widen the scope to project-level `roles/bigquery.dataEditor`
  because that would be a broader grant than this pass required.

Recommended follow-up:

1. apply a dataset-scoped binding through the BigQuery UI or an approved
   dataset IAM command path
2. re-run the API integration smoke tests for BigQuery writes

### BigQuery Audit Dataset Write Access (Phase 4.0 / TD-057)

Applied 2026-04-28:

- `roles/bigquery.dataEditor` on dataset `operator_os_dev_audit`
  for `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`.

How it was applied:

- The modern `bq add-iam-policy-binding --dataset` form remains
  allowlist-blocked on this project (same response as
  `ops_analytics`).
- Worked around via the legacy `bq update --source <acl-json>`
  path. BigQuery normalised the binding to legacy `WRITER` in
  the stored ACL, which is the alias of
  `roles/bigquery.dataEditor` (per Google's role-mapping
  table) so the effective permission is identical.
- Reproducible JSON for the access list lives at
  `docs/AGENT_AUDIT_QUERIES.md` ("Reproducing the schema from
  scratch") for disaster recovery / project copy scenarios.

Future placeholder — analytics SA:

- When an analytics SA is provisioned (per the TD-047
  inventory effort), it should receive
  `roles/bigquery.dataViewer` on `operator_os_dev_audit` so
  it can read the audit trail without write capability. Apply
  via the same legacy ACL path until the modern bind is
  allowlisted.

## What Was Intentionally Not Granted

Not granted during this pass:

- `Owner`
- `Editor`
- broad project-wide `roles/storage.admin`
- broad project-wide `roles/bigquery.dataEditor`
- default runtime access to `github-token`

## Notes

- The Cloud Run service itself is deployed with `require authentication`.
- The temporary `run.invoker` bindings above were added to verify the service
  without opening it publicly.
- If those verification-only bindings are no longer wanted after pass 3, they
  can be removed without affecting the runtime service identity.
