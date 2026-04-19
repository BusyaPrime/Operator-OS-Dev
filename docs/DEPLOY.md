# Deploy Notes

## Current Truth

As of `2026-04-20`, the repository has a real build/deploy path prepared for Cloud Run, but no successful deployment has been claimed from this branch.

Prepared artifacts:

- Cloud Build config:
  [infra/cloudbuild/api.cloudbuild.yaml](/D:/Operator-OS-Dev/infra/cloudbuild/api.cloudbuild.yaml)
- Cloud Run manifest:
  [infra/cloud-run/api.service.yaml](/D:/Operator-OS-Dev/infra/cloud-run/api.service.yaml)
- PowerShell deploy script:
  [deploy-api.ps1](/D:/Operator-OS-Dev/infra/scripts/deploy-api.ps1)
- verification script:
  [verify-api.ps1](/D:/Operator-OS-Dev/infra/scripts/verify-api.ps1)

## Local Build

```powershell
pnpm install
pnpm lint
pnpm typecheck
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
- Docker service has been started
- WSL Windows features were enabled during this pass
- the local daemon still returns a `500 Internal Server Error` for `docker version`
- a reboot and Docker engine recovery are still required before a truthful local image build can be claimed

## Artifact Registry Target

- repository: `operator-os-docker`
- project: `operator-os-dev`
- preferred image path:
  `europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:<tag>`

## Cloud Run Target

- service: `operator-os-api`
- region: `europe-west4`
- service account:
  `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`
- auth mode: require authentication

## Deployment Flow

### Option A: Cloud Build

```powershell
.\infra\scripts\deploy-api.ps1 -ImageTag pass2 -UseCloudBuild -Deploy
```

### Option B: Direct gcloud deploy

```powershell
.\infra\scripts\deploy-api.ps1 -ImageTag pass2 -UseCloudBuild:$false -Deploy
```

## Required Manual Inputs

Before a real deploy can be validated, these still need to happen:

1. `gcloud auth login`
2. `gcloud auth application-default login`
3. apply the least-privilege runtime IAM plan
4. repair local Docker / WSL if local image verification is required
5. provide a real `TASKS_TARGET_BASE_URL`

`TASKS_TARGET_BASE_URL` should point at the deployed API base URL once Cloud Run has a stable service URL. Until then, queue dispatch remains in controlled fallback mode.

## Verification Flow

After a real deploy:

```powershell
.\infra\scripts\verify-api.ps1
```

This script expects:

- the Cloud Run service to exist
- the caller to be able to obtain an identity token
- authenticated access to `/health` and `/ready`

## Repo-Based Deploy Path

The repo already contains a workable repo-based path:

- GitHub Actions validates the monorepo
- Cloud Build can build and optionally deploy the API image
- Cloud Run manifest and deploy script share the same service/account assumptions

What is still not finished:

- no GitHub-to-Cloud-Build trigger or Developer Connect path was configured in this pass
- no successful end-to-end deploy verification has been recorded from this branch
