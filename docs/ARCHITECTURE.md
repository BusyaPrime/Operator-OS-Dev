# Architecture

## Product Shape

Operator OS Dev is a trusted operator system built around explicit visibility and explicit control. The system is designed so the user can open a phone-first interface, inspect what is happening across agents and runtimes, and then intentionally approve or trigger actions. The product is not a stealth desktop takeover tool.

## Main Surfaces

### Mobile Operator App

The mobile app is the primary operator surface. It is responsible for:

- session overview
- device and runtime state visibility
- cost and budget visibility
- alerts and approvals
- deployment and runtime control entry points
- explain and summary surfaces backed by Vertex

The mobile app should remain thin. It consumes the control-plane API and renders state derived from contracts shared across the monorepo.

### Backend Control Plane

The backend API is the orchestration layer. It is responsible for:

- health and readiness endpoints for Cloud Run
- authentication boundary integration
- command intake and approval workflows
- session coordination
- analytics and cost aggregation
- alert fan-out
- export job management
- Vertex-backed summarization and explanation features

It does not directly become a general-purpose shell host. It coordinates trusted actions across the rest of the platform.

### Desktop Runtime

The desktop runtime is an explicit agent process that:

- reports heartbeat and capability state
- polls or receives commands from the control plane
- participates in trusted visible sessions
- prepares export jobs and artifacts
- emits telemetry and notifications

The desktop runtime must remain transparent. No hidden persistence, no stealth hooks, and no prohibited surveillance behavior are part of the design.

## Data And Control Flows

### Analytics And Cost Flows

The API receives operational events from the runtime and backend subsystems, then forwards analytics-grade data into `ops_analytics` in BigQuery. Cost snapshots and budget alerts are modeled as first-class records so they can be surfaced in the mobile app.

### Trusted Session Model

A session is an explicit object with an owner, target device, lifecycle state, approval state, timestamps, and audit trail. Sessions are visible in the mobile app and coordinated by the control plane. The baseline assumes:

- session initiation is deliberate
- session state is inspectable
- approvals are explicit
- the user can see whether a session is idle, pending, active, or closed

### Cloud Resource Mapping

- Cloud Run hosts the API
- Firestore stores operational state and session metadata
- Cloud Tasks drives commands, approvals, and export workflows
- Pub/Sub transports operational events and alerts
- Cloud Storage stores artifacts, exports, and trusted session assets
- BigQuery stores analytics and cost reporting
- Secret Manager stores secrets needed by the backend, not by clients
- Vertex AI provides LLM-based summaries and explanations

## Region Mapping

The current target mapping is intentionally conservative and reuses already-created regions:

- Firestore: `eur3`
- Cloud Tasks queues: `europe-west1`
- Cloud Run target region: `europe-west4`
- KMS: `europe-west4`
- BigQuery dataset region: `EU`

The repo should avoid introducing additional regions during bootstrap unless a later phase proves a concrete need.

## Auth Model

The primary user auth boundary is Firebase / Identity Platform. The expected model is:

- end users authenticate with Email/Password or Google sign-in
- mobile clients exchange authenticated requests with the API
- the API validates identity and authorization before acting on commands or sessions

Bootstrap does not yet include the end-to-end Firebase integration, but the repository layout reserves clear modules for it.

## Service Identity Model

The preferred service-to-service identity model is workload identity through Google-managed service accounts, not downloaded long-lived JSON keys.

- Cloud Run API target SA: `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`
- deployment and CI can use dedicated service accounts when configured
- local development should use ADC, ideally from `gcloud auth application-default login`

This keeps the repo aligned with GCP-native identity and avoids smuggling static credentials into source control.
