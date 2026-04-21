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

## P0.1 Update (2026-04-22)

Follow-up to the pass 3 checkpoint, completed across three PRs on
`phase3/live-deploy-and-vertex`:

- **PR #1** (`feat(api): add /internal/tasks/* stub handlers + config env wiring`)
  - landed Zod-validated stub handlers for `/internal/tasks/commands`,
    `/internal/tasks/approvals`, `/internal/tasks/exports`.
  - wired `TASKS_TARGET_BASE_URL=https://operator-os-api-m545sz2isq-ez.a.run.app`
    into the Cloud Run manifest and the deploy script default.
- **PR #2** (`chore(docs): initial technical debt registry + .claude ignore`)
  - seeded `docs/TECH_DEBT.md` with seven starter items.
  - excluded the Claude Code harness directory from git.
- **PR #3** (`refactor(api): commands/exports readiness worker-pending`)
  - pinned `CommandsService.describeReadiness()` and
    `ExportsService.describeReadiness()` to `degraded` with an explicit
    worker-pending message, independent of tasks queue state.

After PR #1 landed and deployed (revision `operator-os-api-00004-84h`),
`/ready` returned HTTP 200 with every check reporting `ok`. That was
cosmetic: the transport was configured but no worker drained the queue.
PR #3 restored honest reporting.

### Deployed Readiness Matrix (post-P0.1)

| Check | Status | Notes |
|---|---|---|
| config | ok | env parsing passes |
| auth | ok | Firebase Admin via metadata ADC |
| firestore | ok | clients initialise; no live smoke write test yet |
| pubsub | ok | publishers initialise; no live smoke publish yet |
| tasks | ok | `TASKS_TARGET_BASE_URL` configured; Cloud Tasks can dispatch |
| storage | ok | bucket mappings configured |
| bigquery | ok | writer configured; dataset IAM still manual (pass-3 follow-up) |
| secrets | ok | accessor configured |
| commands | degraded (honest) | worker consumer not implemented yet |
| sessions | ok | persistence + fan-out configured |
| alerts | ok | persistence + fan-out configured |
| exports | degraded (honest) | worker consumer not implemented yet |
| vertex | ok | ADC + project/location/model configured; no live inference smoke yet |

Overall status: `degraded` -> HTTP `503`. This is the correct steady
state until a durable worker is implemented.

### Remaining Pass-3 Follow-ups

Unchanged from the original checkpoint:

- dataset-level `roles/bigquery.dataEditor` on `ops_analytics` still manual.
- live Vertex inference smoke test still pending.
- live Firestore / Pub/Sub / Cloud Tasks / Storage / Secret Manager smoke
  tests still pending as an end-to-end matrix.
- local Docker build still blocked (WSL is now up, Docker Desktop engine
  still not starting; see original Docker Status section).

## Post-P0.1 Update (2026-04-22)

P0.1 closed the readiness path in two landings on
`phase3/live-deploy-and-vertex`:

- **PR #1** (`feat(api): add /internal/tasks/* stub handlers + config env wiring`)
  added the three stub handlers, set `TASKS_TARGET_BASE_URL` to the
  production service URL, and pointed the deploy pipeline at the same URL.
- **PR #3** (`refactor(api): honest readiness for commands and exports`)
  pinned `CommandsService` / `ExportsService` readiness to `degraded`
  with a worker-pending message instead of inheriting the now-green
  tasks queue status.

Deployed revisions:

- Previous: `operator-os-api-00003-rzm` (pass 3 baseline).
- Post-PR-1: `operator-os-api-00004-84h`
  (image `phase3-2dee709`, Cloud Build `0799e1d6-4847-4091-bbae-85352ff34f9c`).
- Post-PR-3: tracked in the Phase E deploy log.

Current `/ready` contract:

- `tasks` = `ok` - env var is wired, stub handlers accept the dispatch.
- `commands` = `degraded` - "A durable worker consumer is not
  implemented yet; commands remain in-memory fallback only."
- `exports` = `degraded` - "Export requests are persisted and
  enqueued, but a durable worker consumer is not implemented yet."
- Overall `/ready` stays at HTTP 503 by design until the durable
  worker lands; this is the honest state, not a regression.

Git identity was corrected during P0.1 from `xodarevakmal@gmail.com`
to `hujdarovakmal@gmail.com` in the repo-local git config so commits
author as the BusyaPrime GitHub identity.

Tech debt discovered during P0.1 is registered in
[TECH_DEBT.md](/D:/Operator-OS-Dev/docs/TECH_DEBT.md) as TD-001
through TD-008.
