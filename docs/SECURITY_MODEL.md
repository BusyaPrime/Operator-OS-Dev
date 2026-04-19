# Security Model

## Core Promise

Operator OS Dev is built around a visible trusted control model. The user should understand:

- when a device is connected
- what a runtime can do
- whether the system is live or in fallback mode
- what session or command state currently exists

## Explicit Prohibitions

This branch does not implement, and must not quietly introduce:

- stealth access
- hidden control channels
- spyware behavior
- keylogging
- credential harvesting
- hidden OS hooks
- covert persistence
- invisible remote-control behavior
- silent screen capture

## Trusted Session Requirements

- sessions are explicit records
- approvals are visible and auditable
- session visibility stays `visible`
- mobile and API surfaces can show current session state
- desktop runtime remains transparent about what it is doing

## Controlled Fallback Requirement

This pass adds a stricter honesty rule:

- if Firestore/Auth/Vertex are not ready, the API must report that
- if the API is not available, mobile and desktop-agent must enter controlled fallback instead of pretending they are live
- readiness degradation is expected locally until ADC and cloud permissions are configured

This is part of the trust model, not just a development convenience.

## Secrets Handling

- secrets live in Secret Manager or other approved managed stores
- local development should prefer ADC instead of JSON key files
- long-lived service account keys remain discouraged
- secrets must not be copied into docs, logs, or commits
- `github-token` is not part of the default runtime path unless a code path actually needs it

## Service Identity Preference

Preferred runtime identity on GCP:

- `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

Principles:

- prefer least-privilege IAM roles
- prefer topic/queue/secret/bucket-level bindings where practical
- do not grant `Owner` or `Editor` to runtime identities without a very strong reason

The current least-privilege plan is documented in [IAM_PLAN.md](/D:/Operator-OS-Dev/docs/IAM_PLAN.md).

## Data Access Boundaries

- personal data outside the project is out of scope
- desktop-agent remains intentionally limited and transparent
- export artifacts target approved buckets only
- auth/session payloads are typed and explicit
- audit and analytics flows are modeled, not hidden

## Bootstrap And Phase-2 Posture

At this stage, the repo provides:

- documented trust boundaries
- explicit no-stealth constraints
- controlled fallback semantics
- server-side auth verification scaffolding via Firebase Admin
- typed GCP integration abstractions
- honest readiness reporting

It still does not provide:

- a full production threat model
- a finalized approval policy
- cloud-validated IAM enforcement from this branch
- a deployed remote-session implementation
