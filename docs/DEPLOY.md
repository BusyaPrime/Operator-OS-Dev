# Deploy Notes

## Current Truth

As of `2026-04-20`, the API has completed a first real Cloud Build + Cloud Run
deployment from branch `phase3/live-deploy-and-vertex`.

Confirmed deployment:

- Cloud Build id: `44dd3fac-6f49-47f7-a04b-95e663a5f048`
- image:
  `europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:phase3-fix2`
- Cloud Run service: `operator-os-api`
- region: `europe-west4`
- ready revision: `operator-os-api-00003-rzm`
- service URL:
  `https://operator-os-api-m545sz2isq-ez.a.run.app`

The service requires authentication and uses:

- runtime service account:
  `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`

## What Was Fixed During Pass 3

Two deployment blockers were fixed before the first healthy revision came up:

1. `infra/cloudbuild/api.cloudbuild.yaml`
   Cloud Build treated `${IMAGE_URI}` as an invalid substitution key.
2. `apps/api/Dockerfile`
   the runtime image did not include package-local `node_modules` for the API
   workspace and shared workspace packages.
3. `packages/config/src/api.ts`
   an empty `TASKS_TARGET_BASE_URL` was parsed as an invalid URL instead of an
   intentionally unset value.

## Local Build

Workspace validation that currently passes:

```powershell
pnpm test
pnpm build
```

## Local API Container Build

Target command:

```powershell
docker build -f apps/api/Dockerfile -t operator-os-api:local .
```

Current blocker:

- Docker Desktop is installed
- Docker Desktop logs report `wslUpdateRequired=true`
- `wsl --status` still reports that WSL is not installed/available
- the current shell is not elevated, so Windows feature / WSL repair could not
  be completed from this pass
- a truthful local Docker build is still not confirmed

Minimal manual recovery path:

1. open an elevated terminal
2. run `wsl.exe --install`
3. reboot Windows
4. start Docker Desktop
5. re-run:

```powershell
docker version
docker info
docker build -f apps/api/Dockerfile -t operator-os-api:local .
```

## Artifact Registry Target

- repository: `operator-os-docker`
- project: `operator-os-dev`
- image path pattern:
  `europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:<tag>`

## Cloud Build Deployment Flow

The currently working remote build path uses:

- build service account:
  `projects/operator-os-dev/serviceAccounts/deploy-bot@operator-os-dev.iam.gserviceaccount.com`
- source staging dir:
  `gs://operator-os-dev-artifacts/cloud-build/source`
- log dir:
  `gs://operator-os-dev-artifacts/cloud-build/logs`

Repository script:

- [deploy-api.ps1](/D:/Operator-OS-Dev/infra/scripts/deploy-api.ps1)

Example:

```powershell
.\infra\scripts\deploy-api.ps1 -ImageTag pass3 -UseCloudBuild -Deploy
```

## Cloud Run Verification

Repository script:

- [verify-api.ps1](/D:/Operator-OS-Dev/infra/scripts/verify-api.ps1)

Current verified state:

- `/health` returns `200`
- `/ready` currently returns `503`

The readiness result is honest. It remains degraded because:

- `TASKS_TARGET_BASE_URL` is still unset
- command/export delivery paths remain in controlled fallback mode

## Required Next Input

Set a real task target after the service URL is accepted as the canonical API
base URL:

- `TASKS_TARGET_BASE_URL=https://operator-os-api-m545sz2isq-ez.a.run.app`

After that, redeploy and verify that `/ready` moves from `503` to the expected
state for the remaining integrations.

## Repo-Based Continuous Deployment

Not yet claimed as working.

What exists:

- GitHub Actions CI for the monorepo
- Cloud Build config for build + deploy
- Cloud Run manifest and deploy script aligned to the same service assumptions

What is still missing:

- no GitHub-to-Cloud-Build trigger or Developer Connect integration was
  configured or validated in this pass
- no real push-triggered continuous deployment has been verified yet
