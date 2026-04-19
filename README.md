# Operator OS Dev

Operator OS Dev is a phone-first trusted operator system. The product goal is not silent remote control or a hidden desktop takeover. It is a visible operator surface where a user can inspect agents, costs, sessions, deployments, approvals, and runtime health from a mobile device, then initiate explicit trusted actions.

This repository is currently a bootstrap-stage monorepo. It contains a production-minded foundation for:

- a Cloud Run compatible control-plane API
- a mobile-first operator application built with Expo and React Native
- a transparent desktop runtime scaffold
- shared contracts and config parsing packages
- deployment and CI foundations for GCP-first delivery

## High-Level Architecture

- `apps/api`: Fastify-based control plane for health, session orchestration, commands, analytics, alerts, exports, and Vertex-backed explanation workflows
- `apps/mobile`: Expo React Native shell for operator status, devices, sessions, costs, and settings
- `apps/desktop-agent`: explicit desktop runtime scaffold that reports state and waits for trusted commands, without hidden hooks or spyware behavior
- `packages/contracts`: shared Zod schemas and TypeScript types used by API, mobile, and desktop runtime
- `packages/config`: shared environment parsing and runtime configuration helpers
- `infra/`: Cloud Build, Cloud Run, and local deployment/verification scripts
- `docs/`: source-of-truth project documents

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

1. Install dependencies:

   ```powershell
   pnpm install
   ```

2. Run the API locally:

   ```powershell
   pnpm --filter @operator-os/api dev
   ```

3. Run the desktop runtime scaffold:

   ```powershell
   pnpm --filter @operator-os/desktop-agent dev
   ```

4. Run the mobile scaffold:

   ```powershell
   pnpm --filter @operator-os/mobile dev
   ```

## Build And Validation

- Build all workspaces:

  ```powershell
  pnpm build
  ```

- Lint:

  ```powershell
  pnpm lint
  ```

- Typecheck:

  ```powershell
  pnpm typecheck
  ```

- Test:

  ```powershell
  pnpm test
  ```

- Build the API container:

  ```powershell
  docker build -f apps/api/Dockerfile -t operator-os-api:local .
  ```

## Known GCP Resources

This repo is intentionally aligned to the already-created `operator-os-dev` GCP project and does not create duplicate parallel resources during bootstrap. The current baseline assumes:

- Cloud Run deployment target: `operator-os-api` in `europe-west4`
- Artifact Registry repository: `operator-os-docker`
- Firestore database in `eur3`
- Cloud Tasks queues in `europe-west1`
- BigQuery dataset `ops_analytics`
- Vertex AI and Gemini usage through ADC / service identity

The full inventory is recorded in [docs/GCP_RESOURCES.md](/D:/Operator-OS-Dev/docs/GCP_RESOURCES.md).

## Intentionally Not Done Yet

- No production deployment has been executed from this bootstrap branch
- No real remote-control session implementation is present yet
- No stealth hooks, keylogging, credential harvesting, or hidden OS integration exist
- No Firebase/Identity client integration is wired end-to-end yet
- No persistence layer beyond contracts and scaffolding is implemented yet
- No approval workflow or command execution pipeline is connected yet
- No mobile native release pipeline has been validated yet

## Current Status

The repository is in an honest bootstrap state. Foundations are present so later phases can add real business logic without changing the core repository layout or trust model. The detailed checkpoint is recorded in [docs/BOOTSTRAP_STATUS.md](/D:/Operator-OS-Dev/docs/BOOTSTRAP_STATUS.md).
