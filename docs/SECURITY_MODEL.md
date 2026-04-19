# Security Model

## Core Promise

Operator OS Dev is built around a visible trusted control model. The user should understand when a device is connected, what a runtime can do, and what actions are being requested or executed.

## Explicit Prohibitions

The bootstrap branch does not implement, and should not later quietly introduce:

- stealth access
- hidden control channels
- spyware behavior
- keylogging
- credential harvesting
- hidden OS hooks
- hidden takeover flows
- covert persistence mechanisms

## Trusted Session Requirements

- sessions are explicit records, not invisible background actions
- approvals are visible and auditable
- operator actions should be attributable to a user or service identity
- the mobile surface should be able to show current session state

## Secrets Handling

- secrets belong in approved managed stores such as Secret Manager
- local development should prefer ADC over checked-in keys
- long-lived service account key files are discouraged
- credentials must not be copied into docs, logs, or commits

## Service Identity Preference

When running on GCP:

- Cloud Run should use `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`
- service-to-service access should rely on IAM-backed identities
- access should be least-privilege and role-specific

## Data Access Boundaries

- personal data outside the project is out of scope
- the desktop runtime scaffold is transparent and intentionally limited
- exported artifacts should use approved storage buckets and encryption controls

## Security Posture For Bootstrap

At this stage, the repository provides:

- documented trust boundaries
- explicit no-stealth constraints
- configuration scaffolding aligned to managed identity
- honest TODO markers where security-critical functionality is not yet implemented

It does not yet provide a full threat model, audit pipeline, or production authorization policy set.
