# Operator OS Dev

Operator OS Dev is a phone-first trusted operator system. The product goal is not silent desktop takeover. The goal is a visible control plane where the user can inspect agents, runtime state, sessions, alerts, costs, and approvals from a mobile device, then trigger explicit trusted actions.

This repository is now in a phase-2 integration state:

- the monorepo foundation is in place
- the API has real GCP-aware integration abstractions and live-ready endpoints
- the mobile app consumes a typed dashboard with controlled fallback behavior
- the desktop agent uses real HTTP heartbeat and command-polling paths
- Cloud Run / Cloud Build / IAM plans exist, but no successful deploy has been claimed from this branch

## High-Level Architecture

- `apps/api`
  Fastify control plane for health, readiness, operator dashboard, agent endpoints, typed GCP integrations, and Vertex-backed explainability routes.
- `apps/mobile`
  Expo shell for Home, Devices, Sessions, Costs, and Settings with typed loading, empty, error, and controlled fallback states.
- `apps/desktop-agent`
  Transparent desktop runtime scaffold that heartbeats into the API, polls for commands, reports sessions and exports, and avoids hidden control behavior.
- `packages/contracts`
  Shared Zod schemas for auth, health, operator state, commands, sessions, alerts, analytics, queue payloads, and runtime receipts.
- `packages/config`
  Shared environment parsing for API, mobile, and desktop-agent runtimes.
- `infra`
  Cloud Build, Cloud Run, deploy verification, and least-privilege IAM planning scripts.
- `docs`
  Source-of-truth architecture, security, deploy, Vertex, IAM, and pass-status notes.

## Repo Map

```text
apps/
  api/
  desktop-agent/
  mobile/
packages/
  config/
  contracts/
  tooling/
docs/
infra/
.github/
```

## Local Development

Install and validate the workspace:

```powershell
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the API locally:

```powershell
pnpm --filter @operator-os/api dev
```

Run the desktop runtime scaffold:

```powershell
pnpm --filter @operator-os/desktop-agent dev
```

Run the mobile shell:

```powershell
pnpm --filter @operator-os/mobile dev
```

## Current Local Runtime Behavior

- `/health` reports process liveness
- `/ready` reports dependency status and is expected to return `503` locally until ADC / Cloud-integrations are actually configured
- `/v1/operator/dashboard` returns typed operator/mobile state and falls back honestly when Firestore/Auth are not live yet
- `/v1/agent/*` accepts heartbeats and agent reports and supports controlled fallback behavior
- `/v1/ai/*` is wired for Vertex AI, but local calls require ADC

As of `2026-04-20`:

- `pnpm lint` passes
- `pnpm typecheck` passes
- `pnpm test` passes
- `pnpm build` passes
- local API smoke passed for `/health` and `/v1/operator/dashboard`
- local desktop-agent smoke showed heartbeat and command-poll requests hitting the API
- local Docker image verification is still blocked by the workstation Docker daemon state

## Known GCP Resources

This repo reuses the already-created `operator-os-dev` project resources and does not create parallel infrastructure during this phase. The current code expects:

- Firestore default database in `eur3`
- BigQuery dataset `ops_analytics`
- Cloud Tasks queues in `europe-west1`
- Artifact Registry repository `operator-os-docker`
- Cloud Run service target `operator-os-api` in `europe-west4`
- Vertex AI access through ADC / service identity

The full inventory is recorded in [GCP_RESOURCES.md](/D:/Operator-OS-Dev/docs/GCP_RESOURCES.md).

## Intentionally Not Done Yet

- no production deploy has been verified from this branch
- no local ADC is configured yet on this workstation
- no Firebase client auth flow is wired end-to-end in mobile yet
- no durable queue worker or approval worker has been deployed yet
- no real remote-control implementation exists
- no stealth hooks, hidden capture, keylogging, or credential harvesting behavior exists
- no successful local Docker build has been proven because the daemon still returns a 500 engine error

## Recommended Reading

1. [PASS2_STATUS.md](/D:/Operator-OS-Dev/docs/PASS2_STATUS.md)
2. [ARCHITECTURE.md](/D:/Operator-OS-Dev/docs/ARCHITECTURE.md)
3. [SECURITY_MODEL.md](/D:/Operator-OS-Dev/docs/SECURITY_MODEL.md)
4. [VERTEX.md](/D:/Operator-OS-Dev/docs/VERTEX.md)
5. [DEPLOY.md](/D:/Operator-OS-Dev/docs/DEPLOY.md)
6. [IAM_PLAN.md](/D:/Operator-OS-Dev/docs/IAM_PLAN.md)
