# Deploy Notes

## Local Build

- `pnpm install`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Local API Container Build

```powershell
docker build -f apps/api/Dockerfile -t operator-os-api:local .
```

If this command fails before the build starts, verify that the Docker Desktop daemon is running locally.

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

## Deployment Approach

The bootstrap repo includes:

- Cloud Build configuration for building and optionally deploying the API image
- local PowerShell deployment and verification scripts
- a Cloud Run service manifest baseline under `infra/cloud-run`

The intended flow is:

1. build and push the API image
2. deploy to Cloud Run with authentication required
3. verify `/health` and `/ready` with an authenticated caller

## Not Completed Yet

- no production deployment has been executed from this branch
- no GitHub-to-Cloud-Build trigger has been configured yet
- no rollout strategy or staged environment matrix has been validated yet
- local Docker verification depends on the workstation daemon being available
