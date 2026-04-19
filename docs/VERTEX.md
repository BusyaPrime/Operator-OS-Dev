# Vertex Integration

## Why Vertex Only

The product is GCP-first and intentionally avoids a mixed-model runtime inside the application. Vertex AI keeps auth, billing, deployment, and logging inside one cloud boundary and aligns with the Cloud Run service-identity model.

## Current Provider Strategy

The API owns the first provider implementation:

- `AIProvider`
- `VertexAIProvider`

Current live-ready entrypoints:

- `generateText()`
- `summarizeOperatorState()`
- `explainAgentActivity()`
- `suggestCostOptimizations()`
- `planTaskBreakdown()`

Current API routes:

- `/v1/ai/summarize/operator-state`
- `/v1/ai/explain/agent-activity`
- `/v1/ai/suggest-cost-optimizations`
- `/v1/ai/plan-task-breakdown`

## Auth Model

Preferred auth paths:

- local development: ADC via `gcloud auth application-default login`
- Cloud Run: attached service account `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

The current provider does not require a checked-in API key and does not use OpenAI SDKs.

## Environment

Current expected configuration:

- `GOOGLE_CLOUD_PROJECT=operator-os-dev`
- `VERTEX_LOCATION=europe-west4`
- `VERTEX_MODEL=gemini-2.5-flash`

The model ID stays configurable because Vertex model availability changes over time.

## Error Behavior

The provider now maps the most important failure classes explicitly:

- missing ADC
- missing IAM permissions
- invalid project / region / model configuration
- unexpected upstream Vertex errors

This means the API can fail honestly with a real status code instead of returning a fake summary.

## What Is Implemented

- provider abstraction
- lazy Vertex client creation
- ADC detection
- readiness reporting
- explicit error mapping
- first explainability routes

## What Is Not Implemented Yet

- tool calling
- prompt registry
- evaluation harness
- safety policy tuning
- grounding
- production prompt versioning

## Manual Step For Local Calls

If local Vertex calls fail because ADC is not configured, run:

```powershell
gcloud auth application-default login
```

Cloud Run should not need this manual step if the runtime service account has the correct IAM roles.
