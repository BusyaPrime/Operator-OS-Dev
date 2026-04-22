# Week 2 Phase 1.2 — CI Auto-Deploy (TD-015 + TD-016 closure)

R24 session log. Captures the 5-iteration path from "open PR #20
for CD workflow" to "first fully-automated production deploy
observed on Cloud Run".

## Context

Phase 1.1 (PR #19) resolved TD-014 by swapping
`--no-allow-unauthenticated` → `--allow-unauthenticated` in
`infra/cloudbuild/api.cloudbuild.yaml` + `infra/scripts/deploy-api.ps1`.
This alignment was the precondition: without it, every CI-driven
api deploy would silently drop the `allUsers → roles/run.invoker`
binding that the api service relies on to reach Fastify's own
auth middleware.

Phase 1.2 goal: close TD-015 (no CI auto-deploy) and the coupled
TD-016 (WIF migration from JSON-key auth). Adopt WIF from day 1
because `constraints/iam.disableServiceAccountKeyCreation`
prevented JSON-key provisioning in the first place; the original
"JSON now, WIF later" plan collapsed into "WIF immediately".

## Decisions codified mid-phase

- ADR *Adopt Workload Identity Federation From Day 1 (TD-016
  Preempted)* (2026-04-24) — pool + provider + attribute
  condition (`repository_owner == 'BusyaPrime'`) + deploy-bot
  `roles/iam.workloadIdentityUser` binding for the principalSet.
  Three GitHub Secrets (`GCP_PROJECT_ID`,
  `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`) carry
  no credentials — only public provider coordinates.
- ADR *Canonical Cloud Build Flag Set For CI And Manual Deploy
  Parity* (2026-04-24) — every `gcloud builds submit` in this
  repo (CI or manual) must pass `--service-account`,
  `--gcs-source-staging-dir`, `--gcs-log-dir`.
- Clarification ADR superseding the earlier V0-alias ADR on
  heartbeat schema (no existing schema to alias — additive design
  applies; TD-020 collapsed to wontfix).

## 5-iteration run

### Run 1 — PR #20 merges, PR #21 smoke triggers CD

CD workflow fired. Both `deploy-api` and `deploy-auth-gateway`
jobs failed on `Submit Cloud Build`:

```
ERROR: (gcloud.builds.submit) INVALID_ARGUMENT: could not
resolve source: googleapi: Error 403:
1016254604177-compute@developer.gserviceaccount.com does not
have storage.objects.get access to the Google Cloud Storage
object.
```

Root cause: my workflow dropped three flags that the manual
scripts carried. Without `--service-account=deploy-bot`, Cloud
Build ran the build under the default Compute Engine SA
(`1016254604177-compute@developer.gserviceaccount.com`), which
has no access to `operator-os-dev-artifacts` (only deploy-bot
does).

### Run 2 — PR #22 adds canonical flags, PR #23 retriggers

Different error:

```
ERROR: (gcloud.builds.submit) PERMISSION_DENIED:
generic::permission_denied: caller does not have permission to
act as service account projects/***/serviceAccounts/112288884898868582499.
```

Root cause identified: WIF impersonation collapses the caller
identity into deploy-bot itself. Cloud Build then checks whether
the caller (deploy-bot) has `iam.serviceAccounts.actAs` on the
target (also deploy-bot). By default, a service account does NOT
have `iam.serviceAccountUser` on itself.

My first IAM fix recommendation was wrong — I proposed granting
the **WIF principalSet** `iam.serviceAccountUser` on deploy-bot.
After impersonation, the caller is deploy-bot, not the WIF
principal; the grant on the principalSet doesn't help.

### Run 3 — Akmal applied wrong-target binding, failure identical

Same `PERMISSION_DENIED` error on `actAs`. I re-diagnosed
carefully: the correct binding is a **self-binding** —
deploy-bot has `iam.serviceAccountUser` on deploy-bot.

### Run 4 — Self-binding applied, PR #25 retriggers

Cloud Build this time **succeeded** (build + push to Artifact
Registry). But `gcloud builds log c5f8aca9-73f3-4852-8fd6-0002d81463de`
showed:

```
Step #2: "Skipping Cloud Run deploy step because _DEPLOY=false."
```

Root cause: the cloudbuild.yaml deploy step gates on `_DEPLOY=true`;
my workflow wasn't passing it. Images were built + pushed, but no
Cloud Run revision was created.

Also: the GitHub Actions UI stayed `in_progress` for 40+ minutes
after Cloud Build returned SUCCESS. `gcloud builds submit`'s
log-streaming tail hung in the runner. I cancelled manually. Not
a functional issue (builds were done), but a signal-quality
issue. Filed as TD-021 with this session closure.

### Run 5 — PR #26 adds `_DEPLOY=true`, PR #27 retriggers

**Worked end-to-end:**

- Both `gcloud builds submit` submissions authenticated via WIF,
  dispatched Cloud Builds under deploy-bot's identity, used the
  canonical staging bucket + log dir.
- Cloud Build ran docker build + push + `gcloud run deploy`.
- New Cloud Run revisions created at ~19:31 UTC:
  - `operator-os-api-00008-pcc` (image `phase3-51ed361`)
  - `operator-auth-gateway-00004-775` (image `phase3-51ed361`)
- Anonymous `curl $SERVICE/health` on both services returned
  HTTP 200 with `status:"ok"`.
- `allUsers → roles/run.invoker` on api **still present**
  post-deploy (TD-014 proven in production, not just via merged
  code).
- GitHub Actions UI once again hung on streaming after Cloud
  Build / Cloud Run were both done — same TD-021 pattern. I
  verified deploy outcome directly via `gcloud run services
  describe` + `gcloud run revisions list`, then cancelled the
  stuck workflow.

## Closure evidence

Final production state at phase 1.2 close:

```
operator-os-api
  revision: operator-os-api-00008-pcc   (100% traffic)
  image:    europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:phase3-51ed361
  IAM:      allUsers → roles/run.invoker (preserved by --allow-unauthenticated)
  /health:  HTTP 200, status:"ok"

operator-auth-gateway
  revision: operator-auth-gateway-00004-775   (100% traffic)
  image:    europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/auth-gateway:phase3-51ed361
  IAM:      allUsers → roles/run.invoker (unchanged — service is the auth boundary)
  /health:  HTTP 200, status:"ok"
```

Both services are now on the latest phase3 HEAD (at the time of
smoke 5 = `51ed361`) via pure CI automation — zero human hands on
`gcloud builds submit`.

## PR ledger for Phase 1.2

| # | Branch | Merge SHA | Scope |
|---|---|---|---|
| #19 | `fix/td-014-api-preserve-iam-on-deploy` | `1405ae7` | Precondition (Phase 1.1) |
| — | `chore/week-1-closure` (direct push `b06256b`) | — | Week 2 kickoff ADRs |
| #20 | `feat/td-015-ci-auto-deploy` | `6ca0ea0` | Initial CD workflow (WIF) |
| #21 | `chore/trigger-api-auto-deploy-smoke` | `1fb267e` | Smoke 1 trigger |
| #22 | `fix/cd-deploy-cloud-build-flags` | `f02c859` | Canonical Cloud Build flags |
| #23 | `chore/cd-deploy-smoke-test-2` | `a4f7070` | Smoke 2 trigger |
| #24 | `chore/cd-deploy-smoke-test-3` | `5ec81d9` | Smoke 3 trigger (after WIF-principal binding) |
| #25 | `chore/cd-deploy-smoke-test-4` | `33d4e1f` | Smoke 4 trigger (after deploy-bot self-binding) |
| #26 | `fix/cd-deploy-enable-deploy-substitution` | `b50fc4d` | `_DEPLOY=true` fix |
| #27 | `chore/cd-deploy-smoke-test-5` | `51ed361` | Smoke 5 — **green deploy** |
| #28 | `chore/phase-1-2-closure` | (this PR) | TD updates + session log + TD-021 file |

9 PRs in this phase. Should have been 2–3; the iteration count is
captured here so future auto-deploy setups skip the traps.

## IAM bindings added this phase

All on `deploy-bot@operator-os-dev.iam.gserviceaccount.com`:

- Pool binding (Akmal applied before Phase 1.2):
  `roles/iam.workloadIdentityUser` for principalSet
  `attribute.repository/BusyaPrime/Operator-OS-Dev`.
- Principal binding (incorrect recommendation, applied on run 3
  attempt): `roles/iam.serviceAccountUser` for the same
  principalSet. Kept for now; slated for optional cleanup.
- Self-binding (correct, applied on run 4 attempt):
  `roles/iam.serviceAccountUser` for
  `serviceAccount:deploy-bot@operator-os-dev.iam.gserviceaccount.com`.

No other SA touched. No IAM elsewhere in the project moved.

## TD movement summary

- **TD-014** — resolved (Phase 1.1 PR #19), verified in production
  (this phase's smoke 5).
- **TD-015** — resolved (PR #20 + #22 + #26), verified in
  production (smoke 5).
- **TD-016** — closed preemptively (ADR 2026-04-24); full auth
  chain verified in production (smoke 5).
- **TD-020** — wontfix (superseded by additive heartbeat ADR;
  nothing to remove).
- **TD-021** — filed this phase. `gcloud builds submit` stream
  hangs in GitHub Actions. P3 CI-ergonomics. Fix options
  documented (async flag or shell timeout). Does not block
  Phase 1.3+.

## Meta-learnings

1. **WIF + impersonation is a two-call auth chain.** First call
   exchanges OIDC for a federated token; second impersonates the
   target SA. The caller identity after step 2 is the target SA,
   not the WIF principal. IAM bindings that need to affect "what
   the caller can do" must target the resulting identity, not
   the WIF principal.
2. **Cloud Build substitutions default to `_DEPLOY: "false"`** in
   this repo's cloudbuild.yaml files. Any CI that wants a deploy
   to actually happen must pass `_DEPLOY=true` explicitly. A
   workflow that builds + pushes without deploying will appear
   to succeed end-to-end (SUCCESS in Cloud Build, SUCCESS in
   gcloud CLI) without creating a Cloud Run revision — the
   symptom is "deploy green, service not updated" which is
   easily missed.
3. **gcloud builds submit log streaming is flaky on CI runners.**
   Direct API verification (`gcloud run revisions list`) is the
   reliable signal; GitHub Actions `status: completed` is not.
   TD-021 captures the fix path.
4. **Keep CI deploy config bit-identical to manual deploy
   scripts.** Three flags dropped from the CI workflow caused two
   separate failure modes (Compute SA Storage access, then
   missing `_DEPLOY=true`). The canonical-flag-set ADR prevents
   the next new service from repeating the trap.

## Phase 1.2 wall time

- Start: ~15:00 UTC (WIF setup by Akmal)
- End: ~19:50 UTC (Phase 1.2 closure post)
- Active iteration: ~2.5 hours of back-and-forth Claude ↔ Akmal
- Human time on Akmal's side: ~30 min (IAM bindings, GH Secrets
  setup, go signals)

## What Phase 1.3 inherits

- `@operator-os/contracts` is the next target. Four interfaces
  (AIAgent, FileSystemProvider, StreamProvider, CostProvider) +
  supporting types + ADR SPEC update.
- No IAM or deploy-path work needed.
- Every merge that touches `packages/contracts/**` will now also
  auto-redeploy api + auth-gateway per the filter in
  `cd-deploy.yml`. Plan Phase 1.3 PR to be small and reviewable,
  knowing a deploy fires on merge.
