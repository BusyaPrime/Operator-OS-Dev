# GCP Resources

This document records the existing cloud resources that the phase-2 branch is allowed to assume. The repo must reuse them and avoid creating duplicate infrastructure during this pass.

## Project

- Project ID: `operator-os-dev`

## Identity And Auth

- Firebase project attached to `operator-os-dev`
- Identity Platform enabled
- Email/Password enabled
- Google provider enabled
- OAuth baseline already configured

Current code mapping:

- server-side Firebase Admin initializes via ADC / service identity
- mobile auth is still bootstrap-fallback aware and does not yet ship a client Firebase login flow

## Datastores

- Firestore default database exists in `eur3`
- BigQuery dataset exists:
  - dataset: `ops_analytics`
  - location: `EU`

Current code mapping:

- Firestore collections expected by the API:
  - `deviceStates`
  - `operatorStates`
  - `sessions`
  - `alerts`
  - `costSnapshots`
  - `auditEvents`
- BigQuery target tables expected by the API writer:
  - `cost_snapshots`
  - `alert_events`
  - `session_events`
  - `command_events`

The API falls back explicitly if Firestore or BigQuery cannot be reached yet.

## Storage

- `operator-os-dev-artifacts`
- `operator-os-dev-exports`
- `operator-os-dev-remote`

Current code mapping:

- artifacts bucket: command payload and control-plane artifacts
- exports bucket: export request metadata
- remote bucket: future remote/session asset reads

## Messaging And Work Queues

- Pub/Sub topics:
  - `agent-events`
  - `budget-events`
  - `operator-alerts`
  - `session-events`
- Cloud Tasks queues in `europe-west1`:
  - `commands`
  - `approvals`
  - `exports`

Current code mapping:

- Pub/Sub publishers exist in the API and are typed per topic
- Cloud Tasks enqueue abstractions exist for command, approval, and export payloads
- `TASKS_TARGET_BASE_URL` still needs a real service URL before queue delivery can become fully live

## Secrets And Crypto

- Secret Manager:
  - `github-token`
  - `operator-jwt-secret`
  - `session-signing-secret`
- KMS:
  - key ring: `operator-os`
  - key: `exports-key`
  - location: `europe-west4`

Current code mapping:

- API reads:
  - `operator-jwt-secret`
  - `session-signing-secret`
  - `github-token` only if a future code path truly needs it

No secret payloads are stored in the repository or in docs.

## Service Accounts

- `cloudrun-runtime`
- `deploy-bot`
- `analytics-writer`
- `notifier`

Current runtime target:

- `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

The recommended least-privilege bindings for that identity are recorded in [IAM_PLAN.md](/D:/Operator-OS-Dev/docs/IAM_PLAN.md).

## Build And Runtime Targets

- Artifact Registry repository: `operator-os-docker`
- Cloud Run target service name: `operator-os-api`
- Preferred Cloud Run region: `europe-west4`

Current repo mapping:

- Cloud Build config: [infra/cloudbuild/api.cloudbuild.yaml](/D:/Operator-OS-Dev/infra/cloudbuild/api.cloudbuild.yaml)
- Cloud Run manifest: [infra/cloud-run/api.service.yaml](/D:/Operator-OS-Dev/infra/cloud-run/api.service.yaml)
- Deploy script: [deploy-api.ps1](/D:/Operator-OS-Dev/infra/scripts/deploy-api.ps1)

## Cost Controls

- budget: `bootstrap-dev`

## Operational Rule

During this pass:

- do not create duplicate resources for the same role
- do not add new regions without a concrete reason
- do not rotate or overwrite existing secrets unless a later task explicitly requires it
- do not download new service account keys unless there is no safer option
- do not claim a successful deploy or IAM apply unless it actually happened
