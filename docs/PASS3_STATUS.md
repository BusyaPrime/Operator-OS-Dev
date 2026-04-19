# Pass 3 Status

## Scope Of This Checkpoint

This checkpoint covers phases A-D:

- local Docker / WSL diagnosis
- gcloud auth + ADC recovery
- least-privilege IAM application
- first real Cloud Build + Cloud Run deployment

Branch:

- `phase3/live-deploy-and-vertex`

## Docker Status

Current result: blocked locally

Confirmed facts:

- Docker Desktop is installed
- `docker version` and `docker info` do not provide a healthy local daemon
- Docker Desktop logs report `wslUpdateRequired=true`
- `wsl --status` and `wsl -l -v` still report that WSL is not installed /
  available
- the current shell is not elevated, so Windows feature recovery could not be
  completed from this pass

Truthful outcome:

- local `docker build -f apps/api/Dockerfile ...` is still **not confirmed**

Safe manual recovery path:

1. open an elevated terminal
2. run `wsl.exe --install`
3. reboot Windows
4. start Docker Desktop
5. re-run `docker version`, `docker info`, and the API image build

## ADC Status

Current result: recovered and confirmed

- `gcloud version` works
- active account:
  `xodarevakmal@gmail.com`
- active project:
  `operator-os-dev`
- ADC file saved at:
  `D:\Data\GoogleCloudCLI\application_default_credentials.json`
- `gcloud auth application-default print-access-token` succeeds
- quota project was set to `operator-os-dev`

## IAM Status

### Auto-Applied

`deploy-bot`:

- `roles/cloudbuild.builds.builder`
- `roles/logging.logWriter`
- `roles/run.admin`
- `roles/artifactregistry.writer` on `operator-os-docker`
- `roles/storage.objectAdmin` on `gs://operator-os-dev-artifacts`
- `roles/iam.serviceAccountUser` on `cloudrun-runtime`
- token-creator plumbing for Cloud Build service agent

`cloudrun-runtime`:

- `roles/aiplatform.user`
- `roles/datastore.user`
- `roles/cloudtasks.enqueuer` on all three queues
- `roles/pubsub.publisher` on all four topics
- `roles/secretmanager.secretAccessor` on:
  `operator-jwt-secret`, `session-signing-secret`
- `roles/storage.objectAdmin` on artifacts/exports buckets
- `roles/storage.objectViewer` on remote bucket

Verification helpers:

- `roles/run.invoker` on `operator-os-api` for:
  `deploy-bot`, `xodarevakmal@gmail.com`
- `roles/iam.serviceAccountTokenCreator` on `deploy-bot` for
  `xodarevakmal@gmail.com`

### Still Manual

- dataset-level `roles/bigquery.dataEditor` on `ops_analytics`

Reason:

- `bq add-iam-policy-binding` returned
  `This feature requires allowlisting.`
- I did not replace it with a broader project-level grant.

## Cloud Build Status

### Failed Attempts

`c35aebda-d184-4499-8d82-c693c56118ee`

- failed because `infra/cloudbuild/api.cloudbuild.yaml` used `${IMAGE_URI}` in a
  way Cloud Build interpreted as an invalid substitution key

`094da8f7-7fec-4a6c-a77c-0a7490af8ce0`

- image build/push succeeded
- deploy failed because the runtime config rejected empty
  `TASKS_TARGET_BASE_URL`

### Successful Build

Build id:

- `44dd3fac-6f49-47f7-a04b-95e663a5f048`

Image:

- `europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:phase3-fix2`

## Cloud Run Deploy Status

Current result: first real deployment succeeded

- service: `operator-os-api`
- region: `europe-west4`
- runtime service account:
  `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`
- latest ready revision: `operator-os-api-00003-rzm`
- service URL:
  `https://operator-os-api-m545sz2isq-ez.a.run.app`
- auth mode: require authentication

## Runtime Verification

Authenticated `/health`:

- HTTP `200`
- body confirms `status: ok`

Authenticated `/ready`:

- HTTP `503`
- body confirms honest degraded readiness instead of a crash

Current degraded causes:

- `tasks` is `not_configured`
- `commands` is degraded because queue delivery remains fallback-only
- `exports` is degraded because worker dispatch remains fallback-only

Root cause:

- `TASKS_TARGET_BASE_URL` is still unset

## Fixes Made In Repo During This Checkpoint

- `infra/cloudbuild/api.cloudbuild.yaml`
  fixed Cloud Build substitution handling
- `apps/api/Dockerfile`
  added workspace-local `node_modules` copies for runtime image
- `packages/config/src/helpers.ts`
  added empty-string-to-undefined URL parsing
- `packages/config/src/api.ts`
  made `TASKS_TARGET_BASE_URL` optional in a Cloud Run-safe way
- `packages/config/src/index.test.ts`
  added regression coverage for blank `TASKS_TARGET_BASE_URL`
- `infra/scripts/deploy-api.ps1`
  updated to use the working `deploy-bot` + artifacts bucket Cloud Build path
- `infra/scripts/verify-api.ps1`
  updated to surface readiness bodies even when the API honestly returns `503`

## Validation Matrix

| Area | Status | Notes |
|---|---|---|
| Local Docker daemon | Blocked | WSL recovery still needed |
| Local API docker build | Not validated | blocked by Docker / WSL |
| gcloud auth | Live | authenticated as `xodarevakmal@gmail.com` |
| ADC | Live | token retrieval confirmed |
| Cloud Build | Live | real build succeeded |
| Cloud Run deploy | Live | service is serving traffic |
| `/health` | Live | verified with auth |
| `/ready` | Live but degraded | honest `503` until tasks target is configured |
| Vertex access path | Initialized | readiness says `ok`, live inference not yet smoke-tested |
| Firestore | Initialized | not yet explicitly smoke-tested in pass 3 |
| Pub/Sub | Initialized | not yet explicitly smoke-tested in pass 3 |
| Cloud Tasks | Partially ready | queues exist, dispatch target still unset |
| Secret Manager | Initialized | not yet explicitly smoke-tested in pass 3 |
| Storage | Initialized | not yet explicitly smoke-tested in pass 3 |
| BigQuery | Partial | code path ready, dataset IAM write grant still manual |

## Exact Next Steps

1. fix local WSL / Docker so the local API image build can be truthfully claimed
2. set `TASKS_TARGET_BASE_URL` to
   `https://operator-os-api-m545sz2isq-ez.a.run.app`
3. redeploy and re-run verification
4. perform pass-3 live smoke tests for:
   Secret Manager, Firestore, Pub/Sub, Cloud Tasks, Storage, BigQuery
5. run the first live Vertex request and capture the result in docs
