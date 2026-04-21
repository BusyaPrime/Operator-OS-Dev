# Day 3 — Deploy Hygiene (TD-003 + TD-008), Day 2 Closure

## Context

This session combined the Day 2 TD-005 deploy verification with the
Day 3 TD-003 + TD-008 bundle. Akmal granted full autonomy for
non-destructive actions, including deploys, so the post-TD-005
verification ran without a deploy-gate pause.

## What landed

### Day 2 deploy (TD-005 live)

- Cloud Build `caa0750d-b4bb-4ba5-9670-2f802ebaef21` (3m 36s).
- Image `operator-os-api:phase3-b7ad606`
  digest `sha256:39ce762cc6642bf36f13fe6a6a375ace4336caecdc31cacbd7dcae0ddffc0aa7`.
- New Cloud Run revision `operator-os-api-00006-zng`, 100% traffic.

Verification probes:
- `/health` → 200.
- `/ready` → 503 (honest), all 13 checks reporting as before:
  `tasks=ok`, `commands=degraded` (worker pending), `exports=degraded`
  (worker pending), everything else `ok`.
- `/v1/ai/summarize/operator-state` no-bearer → 403 (Cloud Run IAM
  rejects before the app sees the request; defense in depth works).
- `/v1/agent/heartbeat` no-bearer → 403 (same Cloud Run IAM gate).
- `/v1/agent/heartbeat` with a valid Google user ID token whose
  audience does not match `AGENT_AUDIENCE` → 401 from
  `createAgentGuard` with the clear message: "Provided bearer token
  is neither a valid Firebase ID token nor a valid Google OIDC ID
  token for this service."
- `/v1/ai/summarize/operator-state` with the same non-Firebase
  token → 502 `upstream_error` (filed as TD-009 for a follow-up
  401 mapping).

### Day 3 bundle (PR #7)

- **TD-005** flipped to `resolved` in `docs/TECH_DEBT.md` with the
  closing revision recorded.
- **TD-009** appended to `docs/TECH_DEBT.md` (502 → 401 mapping).
- **TD-003** (`:latest` image tag) resolved: Cloud Run manifest is
  now a proper template with `${IMAGE_TAG}` placeholder plus a
  header comment documenting the `envsubst` workflow.
- **TD-008** (`deploy-api.ps1` drive-qualified variable) resolved:
  line 17 wrapped in `${}`. PowerShell AST parser reports "parses
  cleanly, no errors". End-to-end dry-run (`-UseCloudBuild:$false
  -Deploy:$false`) produces the expected canonical ImageUri and
  exits cleanly.

PR #7 `c0433d9` squash-merged into `phase3/live-deploy-and-vertex`.
No deploy required — only the TD-005 revision is in traffic.

## Current production state

- Revision: `operator-os-api-00006-zng`
- Image: `phase3-b7ad606`
- `/health` = 200, `/ready` = 503 (honest degraded, workers pending).

## Open tech debt

| ID | Pri | Status |
|---|---|---|
| TD-001 | P3 | open — dead stub (modules/commands) |
| TD-002 | P3 | open — dead stub (modules/exports) |
| TD-003 | P2 | **resolved** |
| TD-004 | P2 | open — OIDC on `/internal/tasks/*` |
| TD-005 | P1 | **resolved** |
| TD-006 | P2 | open — CI `phase3/**` trigger |
| TD-007 | P3 | open — ADR format |
| TD-008 | P2 | **resolved** |
| TD-009 | P3 | open — 502→401 on `/v1/ai/*` invalid tokens |

Net: P1 backlog cleared. P2 backlog at 2 (TD-004 OIDC middleware,
TD-006 CI trigger). P3 at 4.
