# GCP Resources

This document records the existing cloud resources that the bootstrap branch is allowed to assume. The goal is to reuse what already exists and avoid duplicating infrastructure during foundation work.

## Project

- Project ID: `operator-os-dev`

## Identity And Auth

- Firebase project is already attached to `operator-os-dev`
- Identity Platform is enabled
- Email/Password is enabled
- Google provider is enabled
- baseline OAuth configuration already exists

## Datastores

- Firestore default database exists in `eur3`
- BigQuery dataset exists:
  - dataset: `ops_analytics`
  - location: `EU`

## Storage

- `operator-os-dev-artifacts`
- `operator-os-dev-exports`
- `operator-os-dev-remote`

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

## Secrets And Crypto

- Secret Manager:
  - `github-token`
  - `operator-jwt-secret`
  - `session-signing-secret`
- KMS:
  - key ring: `operator-os`
  - key: `exports-key`
  - location: `europe-west4`

## Service Accounts

- `cloudrun-runtime`
- `deploy-bot`
- `analytics-writer`
- `notifier`

## Build And Runtime Targets

- Artifact Registry repository: `operator-os-docker`
- Cloud Run target service name: `operator-os-api`
- Preferred Cloud Run region: `europe-west4`

## Cost Controls

- budget: `bootstrap-dev`

## Operational Rule

During bootstrap:

- do not create duplicate resources for the same role
- do not add new regions without a concrete reason
- do not rotate or overwrite existing secrets unless a later task requires it
- do not download new service account keys unless there is no safer option
