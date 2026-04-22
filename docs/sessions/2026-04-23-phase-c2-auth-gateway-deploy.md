# Phase C.2 — Auth-Gateway Production Deploy

Live session log. Append-only; timestamps are wall-clock in UTC+0.

## Context

Phase C.2 completes Week 1 by bringing the `operator-auth-gateway`
Cloud Run service online. Phase C.1 (PR #14, `bd5f113`) shipped
all infra source files (manifest, cloudbuild, deploy script, TD-010).
This phase creates the dedicated runtime SA, IAM bindings, builds
the image, deploys the service, and runs end-to-end verification
including signing a real access token with the reused
`operator-jwt-secret`.

Architectural decisions (pre-confirmed by Akmal on 2026-04-23,
embedded in Phase C.1 infra files):

- **D-1** dedicated runtime SA `auth-gateway-runtime`
- **D-2** reuse `operator-jwt-secret` for HS256 signing
- **D-3** `--allow-unauthenticated` (service IS the auth boundary)
- **D-4** region `europe-west4`, port `8081`
- **D-5** split C.1 (infra files PR) → C.2 (deploy)

## Execution log

### Step 1 — gcloud context (silent OK)

```
gcloud config get-value project  -> operator-os-dev
gcloud auth list                  -> xodarevakmal@gmail.com (ACTIVE)
```

### Step 2 — Create auth-gateway-runtime SA

```
gcloud iam service-accounts create auth-gateway-runtime \
  --project=operator-os-dev \
  --display-name="Operator-OS Auth Gateway runtime" \
  --description="Runtime identity for the operator-auth-gateway Cloud Run service"
-> Created service account [auth-gateway-runtime].
```

### Step 3 — Bind roles/datastore.user (project-scope)

```
gcloud projects add-iam-policy-binding operator-os-dev \
  --member="serviceAccount:auth-gateway-runtime@operator-os-dev.iam.gserviceaccount.com" \
  --role="roles/datastore.user" \
  --condition=None
-> OK (binding present in filter)
```

### Step 4 — Bind roles/logging.logWriter (project-scope)

```
gcloud projects add-iam-policy-binding operator-os-dev \
  --member="serviceAccount:auth-gateway-runtime@..." \
  --role="roles/logging.logWriter" \
  --condition=None
-> OK. Project-scope roles for auth-gateway-runtime = {datastore.user, logging.logWriter}
```

### Step 5 — Bind secretAccessor on operator-jwt-secret (resource-scope, D-2)

```
gcloud secrets add-iam-policy-binding operator-jwt-secret \
  --project=operator-os-dev \
  --member="serviceAccount:auth-gateway-runtime@..." \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None
-> OK. No project-wide secret access granted — only this one secret.
```

### Step 6 — Grant deploy-bot serviceAccountUser on auth-gateway-runtime

```
gcloud iam service-accounts add-iam-policy-binding \
  auth-gateway-runtime@operator-os-dev.iam.gserviceaccount.com \
  --project=operator-os-dev \
  --member="serviceAccount:deploy-bot@operator-os-dev.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None
-> OK. deploy-bot can now --service-account=auth-gateway-runtime@...
```

### Step 7 — Safety checklist (awaits Akmal proceed)

Repo:
- `git status` clean on `phase3/live-deploy-and-vertex`
- `git log -1` = `bd5f113 infra(auth-gateway): ...`

Local build:
- `pnpm typecheck` — 8/8 tasks, 17.656s
- `pnpm -F @operator-os/auth-gateway test` — 3 files / 15 tests / 5.24s
- `pnpm -F @operator-os/auth-gateway build` — OK, no errors

gcloud context:
- project = operator-os-dev
- active account = xodarevakmal@gmail.com
- `auth-gateway-runtime` SA exists, enabled, displayName OK
- IAM bindings verified (project + secret + deploy-bot actAs)
- Artifact Registry `operator-os-docker` (europe-west4) present, DOCKER format, 542 MB

**GATE A** posted to chat; awaiting explicit `proceed step 8`
before invoking `gcloud builds submit`.

### Step 8 (first attempt) — Cloud Build + deploy FAILED

Image `auth-gateway:phase3-bd5f113` built and pushed successfully
but the `gcloud run deploy` step failed with:

```
ERROR: (gcloud.run.deploy) spec.template.spec.containers[0].env:
  The following reserved env names were provided: PORT. These
  values are automatically set by the system.
```

Per the Akmal error-handling protocol, stopped immediately.
No Cloud Run service was created (deploy is the last step,
failed before any revision was recorded).

**Hot-fix PR #15** opened on branch
`fix/auth-gateway-reserved-port-envvar`:

- c1 `fix(auth-gateway): remove reserved PORT env var from cloudbuild`
- c2 `fix(auth-gateway): remove reserved PORT env var from deploy script`
- c3 `fix(auth-gateway): remove reserved PORT env var from service yaml`
- c4 `docs(tech-debt): register TD-011 reserved env var pattern`

Squash-merged as `cf778d6`. TD-011 captures the Cloud Run
reserved-env-vars rule (PORT, K_SERVICE, K_REVISION,
K_CONFIGURATION) so every future service (conductor, streamer,
notifications, cost-tracker, audit-logger, ai-router) inherits
the lesson without another retry round.

### Step 8 (retry) — Cloud Build + deploy SUCCESS

Image `auth-gateway:phase3-cf778d6`, digest
`sha256:f791ed5f22f5a9daff5e952a6c8efb73c38107a38ea04501c6a7d2319ea6bce6`,
Cloud Run revision `operator-auth-gateway-00001-j6x` serving
100% traffic. Build 3m37s, deploy ~30s.

### Step 9 — Capture URL + pre-GATE-B sanity

Service URL:
`https://operator-auth-gateway-m545sz2isq-ez.a.run.app`

Pre-verification checks:

- `/health` → HTTP 200 `{status:"ok"}`
- `/ready` → HTTP 200 `{status:"ready"}` with 4/4 checks green
  (config, signing-secret, users-repository, refresh-token-store)

Published GATE B walkthrough + verification 5.5 curl template
to Akmal. Pausing for his live token execution.

### Steps 10-11 — GATE B iterations

Verification 5.5 hit three real-world failures before succeeding.
Each one required a hot-fix PR, rebuild, redeploy; each exposed a
real integration gap that would have bitten us later.

#### Iteration 1 (req-1..req-4): PowerShell encoding

5.5 returned HTTP 500 "Internal server error". Diagnosis traced
to Fastify's JSON body parser rejecting the body
(`FST_ERR_CTP_INVALID_JSON_BODY`). app.ts `setErrorHandler`
masked the library's own 400 as 500 because the fallback branch
doesn't honour `error.statusCode`. Filed **TD-012** for the
masking behaviour; root cause for the 500 was **PowerShell
`\"` escape semantics** — not valid in PowerShell strings
(PowerShell uses backtick escape, not backslash).

Three alternative curl forms (Bash `--data @file`,
Bash+jq inline, PowerShell `Invoke-RestMethod` with
`ConvertTo-Json`) proposed. Akmal retried.

#### Iteration 2 (req-6..req-8): invalid UTF-8 payload

After switching shells, 5.5 returned HTTP 502 `upstream_error`
with `"Can't parse token payload 'eyJhbGc...JKV1QifQ"` — library's
misleading wording (segments[0] shown in message even though
failure was on segments[1]). See
`node_modules/google-auth-library/build/src/auth/oauth2client.js:715`
off-by-one.

Structured diagnostic logging added via **PR #16** (branch
`fix/auth-gateway-signin-diagnostics`, four commits):

- c1 `feat(auth-gateway): sanitize idToken before google verification`
  (new `sanitizedJwtSchema` in `@operator-os/contracts` with Zod
  transform + 3-segment base64url refinement)
- c2 `feat(auth-gateway): structured logging around google verifier`
  (threads `request.log` from route -> service -> verifier; emits
  permanent `verify.idToken diagnostic shape` log with token shape
  metadata — no content)
- c3 `test(auth-gateway): cover token sanitization edge cases`
  (16 new unit tests)
- c4 `fix(auth-gateway): swap control-char regex for charCode scan`
  (ESLint no-control-regex fix)

Squash-merged as `9222416`. Redeployed to
`operator-auth-gateway-00002-q27`.

Diagnostic entries for req-7 / req-8 then revealed that Akmal's
token arrived clean (no whitespace, 3 segments, proper base64url)
but the last 16 chars of the payload segment decoded to
`c4 dc dc d8 e0 dc d0 cc d8 c1 f4` — **invalid UTF-8**. Hand-
crafted well-formed test JWT (my side, curl with known-good
ASCII JSON) produced a DIFFERENT error ("No pem found for
envelope"), proving the library works on healthy input. Root
cause: PowerShell copy-path had contaminated the payload bytes.

Akmal switched to Git Bash for the next retry.

#### Iteration 3 (req-3 on rev 00003): Firestore undefined

5.5 finally passed google-id-token-verifier but hit
`users-repository` with `"Cannot use 'undefined' as a Firestore
value (found in field 'displayName')"`. Google ID tokens from
OAuth Playground's refresh-grant flow (and signin flows without
the `profile` scope) omit optional identity claims.

**PR #17** opened, single commit
`fix(auth-gateway): enable ignoreUndefinedProperties in Firestore`
adding the flag to both `users-repository.ts` and
`refresh-token-store.ts` for symmetric write semantics.

Squash-merged as `ceded57`. Redeployed to
`operator-auth-gateway-00003-f7h`.

5.5 next retry — HTTP 200 with full
`{accessToken, refreshToken, user}` payload. User
`b14c9bce-6bb1-4cf4-b2ed-a1e518e31271` created in Firestore
(first-ever real user).

### Step 10 — Auto-verification 5.1-5.4 from my side

Ran on rev 00003-f7h:

- 5.1 `GET /health` -> HTTP 200, `status:"ok"`, 1 check ok
- 5.2 `GET /ready` -> HTTP 200, `status:"ready"`, 4/4 checks
- 5.3 `POST /v1/auth/signin {}` -> HTTP 400 `invalid_request`,
  1 Zod issue
- 5.4 `POST /v1/auth/signin {idToken:"<bad JWT>"}` -> HTTP 502
  `upstream_error` (consistent with TD-009 pattern; not 200; ok
  for our gate definition)

### Step 11 — Verification 5.6 (first attempt: HTML 401)

First 5.6 with real accessToken returned HTML 401 from Google
Frontend — Cloud Run IAM was rejecting before the request
reached Fastify, because `operator-os-api` was deployed with
`--no-allow-unauthenticated` and did not grant `allUsers` the
invoker role.

Akmal approved applying `allUsers -> roles/run.invoker` on
operator-os-api (security enforced at Fastify middleware layer
per PR #6 TD-005 closure). Applied and verified. Anonymous
`/health` on api then returned Fastify JSON 200 (confirmed
reach). Anonymous `/v1/ai/summarize/operator-state` returned
Fastify JSON 404 for GET (route is POST — expected).

### Step 11 — Verification 5.6 (second attempt: 502 Firebase)

5.6 with real accessToken via POST returned HTTP 502
`upstreamMessage: "Firebase ID token has no 'kid' claim"`.
Diagnosis: **operator-os-api deployed image was
`phase3-b7ad606` (PR #6) — PRE-DATES PR #11** which added the
HS256 access-token verifier alongside Firebase. The deploy for
PR #11 was never triggered. Not a code gap; a deploy gap.

No PR #18 needed. Built + deployed `operator-os-api:phase3-ceded57`
(current HEAD, includes PR #11's `AccessTokenVerifier` with
`jose.jwtVerify` against `AUTH_ACCESS_TOKEN_ISSUER = operator-auth-gateway`
/ `AUTH_ACCESS_TOKEN_AUDIENCE = operator-os-api`). New revision
`operator-os-api-00007-7q6`. Build 3m27s.

Deploy reset the service IAM policy to default (api
cloudbuild.yaml carries `--no-allow-unauthenticated`), so
reapplied `allUsers -> roles/run.invoker`. Filed **TD-014** for
the deploy/IAM reset trap.

### Step 11 — Verification 5.6 (third attempt: PASS ✅)

5.6 on revision 00007-7q6:

```
HTTP Status: 200
{
  "provider": "vertex-ai",
  "model": "gemini-2.5-flash",
  "text": "No operational state available.",
  "usage": {"promptTokenCount":36, "candidatesTokenCount":5, "totalTokenCount":221}
}
```

Full end-to-end: Google ID token → auth-gateway HS256 JWT issue →
api HS256 verify → Vertex AI Gemini 2.5 Flash → response. Every
layer works. Token usage tracked.

### Step 12 — operator-os-api /ready regression check

After the api redeploy:

```
HTTP 503, status:"degraded"
ok: config, auth, firestore, pubsub, tasks, storage, bigquery, secrets, sessions, alerts, vertex (11)
degraded: commands, exports (2)
```

Identical to pre-Phase-C.2 baseline. Zero regression from the
auth-gateway deploy or the api redeploy.

## Final state

- auth-gateway live at `https://operator-auth-gateway-m545sz2isq-ez.a.run.app`
  revision `operator-auth-gateway-00003-f7h` (image `phase3-ceded57`)
- operator-os-api live at `https://operator-os-api-m545sz2isq-ez.a.run.app`
  revision `operator-os-api-00007-7q6` (image `phase3-ceded57`,
  includes PR #11 HS256 verifier)
- Full auth chain (Google → our JWT → api) verified end-to-end
- First real user record in Firestore
- Four PRs landed during Phase C.2: #15 (PORT env), #16
  (sanitize + diagnostics), #17 (ignoreUndefinedProperties),
  plus the IAM and redeploy (no PR, just operator actions with
  explicit per-step approval)
- Four tech-debt entries registered (TD-011, TD-012, TD-013,
  TD-014) and one Week 2 entry filed (TD-010)

**Wall time:** ≈ 4 hours from first GATE A to Week 1 closure.

**Status:** Week 1 RESOLVED. Phase 1 MVP foundation complete.
Ready for Week 2 kickoff (Desktop Agent + AIAgent contracts).
