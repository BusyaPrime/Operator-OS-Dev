# Operator OS API

Fastify-based control-plane for Cloud Run. Auto-deployed on
merge to `phase3/live-deploy-and-vertex` via the CD workflow
landed in PR #20 and refined in PR #22 (WIF-backed auth,
canonical Cloud Build flag set per DECISIONS.md — see the
*Canonical Cloud Build Flag Set* ADR).

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
