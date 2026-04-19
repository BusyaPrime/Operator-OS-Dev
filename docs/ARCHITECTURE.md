# Architecture

## Product Shape

Operator OS Dev is a trusted operator system built around explicit visibility and explicit control. The product is designed so the user can inspect the state of devices, sessions, cost posture, alerts, and cloud runtime from a phone-first surface, then initiate deliberate trusted actions. It is not a stealth desktop takeover tool.

## Main Surfaces

### Mobile Operator App

The mobile app remains the primary operator surface. In the current pass it is a live-ready shell that consumes a typed operator dashboard and exposes:

- Home
- Devices
- Sessions
- Costs
- Settings

Each screen now has typed loading, empty, error, and controlled fallback behavior. When the backend is unavailable or not fully wired, the shell does not pretend to be live; it switches to an explicit fallback mode.

### Backend Control Plane

The Fastify API is now more than a scaffold. It currently owns:

- `/health`
- `/ready`
- `/v1/auth/session`
- `/v1/operator/state`
- `/v1/operator/dashboard`
- `/v1/devices`
- `/v1/sessions`
- `/v1/alerts`
- `/v1/costs`
- `/v1/commands`
- `/v1/agent/*`
- `/v1/ai/*`

The control plane now contains live-ready integration modules for:

- Firebase Admin auth via ADC
- Firestore repository access with a controlled in-memory overlay fallback
- Pub/Sub publishers
- Cloud Tasks enqueue abstractions
- Cloud Storage upload/download abstractions
- BigQuery analytics writes
- Secret Manager access
- Vertex AI / Gemini provider wiring through ADC

### Desktop Runtime

The desktop runtime is still intentionally transparent, but it now uses real HTTP interfaces against the API:

- heartbeat posts to `/v1/agent/heartbeat`
- command polling hits `/v1/agent/commands`
- session updates post to `/v1/agent/sessions`
- export requests post to `/v1/agent/exports`
- alerts post to `/v1/agent/alerts`

If the API is unavailable, the runtime falls back explicitly and logs that fact. It does not introduce hidden local behavior.

## Data And Control Flows

### Operator Dashboard Flow

1. Mobile requests `/v1/operator/dashboard`.
2. API resolves optional auth session state.
3. API reads Firestore-backed state if available.
4. If Firestore or ADC is unavailable, API returns a controlled fallback dashboard with an explicit reason.
5. Mobile renders the resulting typed state and transport mode.

### Agent Heartbeat And Command Flow

1. Desktop agent posts a device heartbeat.
2. API records the state in a transient overlay and tries to persist to Firestore.
3. API publishes an agent event when Pub/Sub is available.
4. Desktop agent polls for pending commands.
5. Current pass keeps queue-to-agent delivery in an honest controlled fallback path until the durable worker path is fully deployed.

### Analytics And Cost Flow

The API foundation now includes typed write paths for:

- command events
- session events
- alert events
- cost snapshots

The current implementation is live-ready but not yet cloud-validated, because local ADC is missing and BigQuery table provisioning has not been executed from this branch.

### Trusted Session Model

A session remains an explicit, inspectable object with:

- device
- operator
- status
- mode
- visibility
- timestamps

The backend and mobile surfaces preserve the visible trusted-session model. No hidden session initiation path exists in this pass.

## Cloud Resource Mapping

- Cloud Run hosts the API
- Firestore stores operator, device, session, alert, and audit data when available
- Cloud Tasks is the intended worker-dispatch mechanism for commands, approvals, and exports
- Pub/Sub is the intended event fan-out path
- Cloud Storage stores artifacts, export requests, and future remote assets
- BigQuery stores analytics-grade events
- Secret Manager holds backend secrets
- Vertex AI provides all LLM functionality

## Region Mapping

- Firestore: `eur3`
- Cloud Tasks queues: `europe-west1`
- Cloud Run target region: `europe-west4`
- KMS: `europe-west4`
- BigQuery dataset region: `EU`

The repository should continue to avoid region sprawl without a concrete operational reason.

## Auth Model

The current server-side auth shape is:

- Firebase Admin via ADC / attached service identity
- optional auth session resolution for operator-facing read routes
- required-auth guard skeleton available for future privileged routes
- explicit bootstrap fallback when Firebase token verification cannot run locally

This means auth wiring is honest: readiness reports that local auth is not configured instead of faking success.

## Service Identity Model

The preferred runtime identity remains:

- `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

This service identity is the target for:

- Vertex AI access
- Firestore access
- Pub/Sub publish access
- Cloud Tasks enqueue access
- Secret Manager reads
- Storage bucket access
- BigQuery writes

The concrete least-privilege plan is recorded in [IAM_PLAN.md](/D:/Operator-OS-Dev/docs/IAM_PLAN.md).
