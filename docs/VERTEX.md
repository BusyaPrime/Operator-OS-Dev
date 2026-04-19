# Vertex Integration

## Why Vertex Only

The project is GCP-first and intentionally avoids a mixed-model runtime in the product. Vertex AI gives the repo a single managed auth, billing, and deployment context for explainability features such as summaries, activity explanations, cost advice, and task breakdowns.

## Provider Strategy

The API owns the first provider implementation. It exposes a generic `AIProvider` interface and a `VertexAIProvider` implementation so the rest of the system can depend on stable methods instead of a vendor-specific SDK surface.

Planned bootstrap methods:

- `generateText()`
- `summarizeOperatorState()`
- `explainAgentActivity()`
- `suggestCostOptimizations()`
- `planTaskBreakdown()`

## Auth Model

Preferred auth paths:

- local development: ADC via `gcloud auth application-default login`
- Cloud Run: attached service account `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

The bootstrap branch does not assume or require checked-in API keys.

## Environment

Current expected configuration:

- `GOOGLE_CLOUD_PROJECT=operator-os-dev`
- `VERTEX_LOCATION=europe-west4`
- `VERTEX_MODEL=gemini-2.5-flash`

The model ID remains configurable because model lifecycle changes over time on Vertex AI.

## What Is Implemented In Bootstrap

- provider abstraction in the API
- lazy Vertex client creation
- request methods that call Gemini through Vertex
- honest error handling when ADC or permissions are missing

## What Is Not Implemented Yet

- tool calling
- prompt registry
- safety policy tuning
- grounding integrations
- automated evaluation
- production prompt versioning

## Manual Step For Local Calls

If local Vertex calls fail because ADC is not configured, run:

```powershell
gcloud auth application-default login
```

Cloud Run should not need this manual step because the runtime will use its attached service account.
