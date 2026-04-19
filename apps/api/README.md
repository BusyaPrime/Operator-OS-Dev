# Operator OS API

Fastify-based control-plane scaffold for Cloud Run.

## Current Bootstrap Scope

- `/health` and `/ready` endpoints
- structured logging
- environment parsing through `@operator-os/config`
- Vertex provider abstraction with ADC-friendly auth
- internal module stubs for auth, commands, sessions, analytics, alerts, exports, storage, telemetry, providers, and vertex

## Local Run

```powershell
pnpm --filter @operator-os/api dev
```

## Manual Note

Vertex-backed methods are wired for ADC or Cloud Run service identity, but bootstrap does not claim a successful live Vertex call unless local ADC is configured.
