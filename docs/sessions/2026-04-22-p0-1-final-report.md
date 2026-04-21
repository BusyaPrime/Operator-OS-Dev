# P0.1 Final Report (2026-04-21 to 2026-04-22)

Mirror of the chat-side report per R24. Source of truth for the P0.1
work in this repo.

## BLOCK 1: P0.1 STATUS

**RESOLVED** - `/ready` now reports honest state: `tasks=ok`,
`commands=degraded` and `exports=degraded` with explicit
worker-pending messages. Overall HTTP 503, which is the correct
steady state until a durable worker consumer ships.

## BLOCK 2: MERGED PRS

| # | Title | Commits before squash | Merge SHA |
|---|---|---|---|
| #1 | `feat(api): add /internal/tasks/* stub handlers + config env wiring` | 2 | `2b1ba70` |
| #2 | `chore(docs): initial technical debt registry + .claude ignore` | 3 | `2dee709` |
| #3 | `refactor(api): honest readiness for commands and exports (worker not implemented)` | 6 | `bd8f15e` |

`TD-008` (PowerShell deploy script bug) was filed as the first commit
of PR #3, not a separate PR, to stay within the scope the user
approved for Phase E.

## BLOCK 3: CURRENT `/ready` RESPONSE (PRODUCTION)

```json
{
  "status": "degraded",
  "service": "operator-os-api",
  "version": "0.1.0",
  "environment": "production",
  "timestamp": "2026-04-21T20:39:06.161Z",
  "checks": [
    { "name": "config",    "status": "ok" },
    { "name": "auth",      "status": "ok" },
    { "name": "firestore", "status": "ok" },
    { "name": "pubsub",    "status": "ok" },
    { "name": "tasks",     "status": "ok" },
    { "name": "storage",   "status": "ok" },
    { "name": "bigquery",  "status": "ok" },
    { "name": "secrets",   "status": "ok" },
    { "name": "commands",  "status": "degraded",
      "message": "Command intake and Cloud Tasks enqueue are wired. A durable worker consumer is not implemented yet; commands remain in-memory fallback only." },
    { "name": "sessions",  "status": "ok" },
    { "name": "alerts",    "status": "ok" },
    { "name": "exports",   "status": "degraded",
      "message": "Export requests are persisted and enqueued, but a durable worker consumer is not implemented yet." },
    { "name": "vertex",    "status": "ok" }
  ]
}
```

HTTP: **503** (by design, until durable worker lands).

## BLOCK 4: DEPLOY DETAILS

- New revision: `operator-os-api-00005-7rk`
- Image: `europe-west4-docker.pkg.dev/operator-os-dev/operator-os-docker/operator-os-api:phase3-bd8f15e`
- Image digest: `sha256:4f790c934f7df1f81d8814e95fa3039945728f1ec144c67824ffe99e5006fa30`
- Cloud Build id: `8f0223de-9bc2-49a7-8114-6f10d81a94c9` (4m 10s)
- Traffic: 100% -> `operator-os-api-00005-7rk`
- Deployed via `gcloud builds submit` directly (the PowerShell script
  fails on `$ServiceName:$ImageTag` interpolation - see TD-008).

Previous revisions for rollback (in order of preference):

| Revision | State of `/ready` | Rollback command |
|---|---|---|
| `operator-os-api-00004-84h` | Cosmetic `ok` on all checks, HTTP 200 (PR-1 only). | `gcloud run services update-traffic operator-os-api --region=europe-west4 --to-revisions=operator-os-api-00004-84h=100 --project=operator-os-dev` |
| `operator-os-api-00003-rzm` | Pass-3 baseline, `tasks=not_configured`, HTTP 503. | Swap the revision name above. |

Reverting further than `00003-rzm` is not supported without a
dedicated plan.

## BLOCK 5: TECH DEBT REGISTERED

All eight entries live in `docs/TECH_DEBT.md`.

| ID | Type | Priority | Summary |
|---|---|---|---|
| TD-001 | dead-code | P3 | Unused stub in `apps/api/src/modules/commands/index.ts` |
| TD-002 | dead-code | P3 | Unused stub in `apps/api/src/modules/exports/index.ts` |
| TD-003 | compliance | P2 | `:latest` image tag in `api.service.yaml` (R9 violation) |
| TD-004 | security | P2 | Missing OIDC verification middleware on `/internal/tasks/*` |
| TD-005 | security | P1 | Anonymous `/v1/agent/*` and `/v1/ai/*` routes |
| TD-006 | tech-gap | P2 | CI not triggered on `phase3/**` pushes |
| TD-007 | maintainability | P3 | `docs/DECISIONS.md` not in ADR format |
| TD-008 | tech-gap | P2 | `deploy-api.ps1` PowerShell variable interpolation bug |

Priority breakdown: P1=1, P2=4, P3=3.

## BLOCK 6: NEXT RECOMMENDED WORK

1. **TD-005** (anonymous `/v1/agent/*` and `/v1/ai/*`). P1 security
   item. The upcoming Desktop Agent specification will harden phone ->
   cloud -> desktop trust, and landing required-auth on these routes
   first avoids retrofitting later. ~1 day with tests and a small
   desktop-agent token attach.

2. **TD-003 + TD-008** together. Small, high-leverage ops cleanup.
   TD-008 fixes the documented deploy command; TD-003 makes the Cloud
   Run manifest a real manifest instead of a `:latest` placeholder.
   Together they unblock a repeatable, reproducible deploy path.
   ~2-3 hours.

3. **Durable worker consumer** for commands and exports. Real closure
   of the gap that PR-3 reported honestly. This is a feature, not a
   debt item, and is the main unlock for `/ready` eventually becoming
   `ok` and for commands reaching agents end-to-end. Scope this as
   its own pass - it touches Pub/Sub subscription wiring (or a new
   worker service) and Firestore terminal-state persistence.

## BLOCK 7: SESSION META

- **Commits on feature branches before squash**: 11 (PR #1: 2,
  PR #2: 3, PR #3: 6).
- **Merge commits on `phase3/live-deploy-and-vertex`**: 3.
- **Files touched**: 16.
- **Lines**: 1138 added, 14 deleted.
- **PRs opened, merged, branches deleted**: 3.
- **Cloud Build runs**: 2 (PR-1 deploy `0799e1d6-...`, PR-3 deploy
  `8f0223de-...`).
- **Cloud Run revisions produced**: 2 (`00004-84h`, `00005-7rk`).
- **Git identity**: corrected from `xodarevakmal@gmail.com` to
  `hujdarovakmal@gmail.com` in repo-local config; both P0.1 local
  commits amended via `git rebase --exec` before first push. Upstream
  commits (`2f2d5f7`, `35db2db`) left untouched.

## BLOCK 8: URLS

- Production: `https://operator-os-api-m545sz2isq-ez.a.run.app`
- PR #1: `https://github.com/BusyaPrime/Operator-OS-Dev/pull/1`
- PR #2: `https://github.com/BusyaPrime/Operator-OS-Dev/pull/2`
- PR #3: `https://github.com/BusyaPrime/Operator-OS-Dev/pull/3`
- `TECH_DEBT.md`: `https://github.com/BusyaPrime/Operator-OS-Dev/blob/phase3/live-deploy-and-vertex/docs/TECH_DEBT.md`
- `DECISIONS.md` (new entry): `https://github.com/BusyaPrime/Operator-OS-Dev/blob/phase3/live-deploy-and-vertex/docs/DECISIONS.md`
- Session logs:
  - `docs/sessions/2026-04-22-pr1-description.md`
  - `docs/sessions/2026-04-22-pr3-description.md`
  - `docs/sessions/2026-04-22-p0-1-final-report.md` (this file)

## Scope boundaries

The following were deliberately left for later:

- `CLAUDE.md` (root operating contract). Written and left untracked.
  Needs its own chore PR before the next session. Not included in
  PR #1/2/3 to keep those diffs focused.
- Durable worker consumer (see BLOCK 6 item 3).
- All items in `TECH_DEBT.md` TD-001 through TD-008.
- Desktop Agent Specification - next chapter per the user's direction.
