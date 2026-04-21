## Summary

Closes the LAW #5 gap left open by PR #1. `CommandsService` and
`ExportsService` no longer inherit their readiness from the Cloud Tasks
transport. Both are pinned to `degraded` with an explicit
worker-pending message until a real durable consumer lands.

Also registers `TD-008` (the `deploy-api.ps1` PowerShell variable
interpolation bug) up front so the next developer touching the deploy
script sees the known issue.

## Root cause (context)

Before PR #1, `TASKS_TARGET_BASE_URL` was empty and `tasks` reported
`not_configured`. `CommandsService` and `ExportsService` inherited that
and reported `degraded`. `/ready` returned HTTP 503 for the right
reason.

PR #1 wired the env var and added stub handlers so Cloud Tasks can
enqueue without 404-retry-storms. That flipped `tasks` to `ok`, and
because commands/exports still inherited from tasks, they flipped to
`ok` too. `/ready` returned HTTP 200 with `status: ready`.

That was cosmetic. No durable worker consumer exists; commands sit in
an in-memory fallback `Map` that is lost on revision restart; exports
never run. External monitors would read 200 and assume end-to-end
delivery works.

PR #3 restores truth: readiness is pinned to `degraded` with a message
that calls out the missing worker explicitly, and the pinning is
enforced by regression tests that fail if anyone re-introduces the
`tasks -> commands/exports` inheritance.

## Changes

- **MODIFIED** `apps/api/src/services/commands.ts` -
  `describeReadiness()` always returns `{ status: 'degraded', message:
  '...durable worker consumer is not implemented...' }`.
- **MODIFIED** `apps/api/src/services/exports.ts` - same for exports
  with its own message.
- **NEW** `apps/api/src/services/commands.test.ts` - asserts the
  honest message and verifies the method never touches the tasks
  queue (regression guard).
- **NEW** `apps/api/src/services/exports.test.ts` - mirror for
  exports.
- **MODIFIED** `docs/DECISIONS.md` - new decision entry explaining
  why `/ready` stays 503, alternatives considered, consequences.
- **MODIFIED** `docs/PASS3_STATUS.md` - P0.1 update section with the
  three PRs, deployed readiness matrix, remaining follow-ups.
- **MODIFIED** `docs/DEPLOY.md` - `/ready` semantics after P0.1, plus
  a direct `gcloud builds submit` fallback for TD-008.
- **MODIFIED** `docs/TECH_DEBT.md` - registers `TD-008`, the
  PowerShell variable-reference bug in `infra/scripts/deploy-api.ps1`.

## Verification

- `pnpm -r typecheck` green.
- `pnpm -r lint` green.
- `pnpm -r test` green, 27 tests across five workspaces (api goes
  from 9 to 13 with the two new service test files; others unchanged).

## Expected `/ready` after deploy

HTTP `503`, body `status: degraded`. The important entries in
`checks`:

- `tasks.status = "ok"` - env var wired, stub handlers accept.
- `commands.status = "degraded"` with message
  `"Command intake and Cloud Tasks enqueue are wired. A durable worker
  consumer is not implemented yet; commands remain in-memory fallback
  only."`
- `exports.status = "degraded"` with message
  `"Export requests are persisted and enqueued, but a durable worker
  consumer is not implemented yet."`

Any other shape means something unexpected happened and the deploy
should be rolled back.

## Rollback plan

```
gcloud run services update-traffic operator-os-api \
  --region=europe-west4 \
  --to-revisions=operator-os-api-00004-84h=100
```

This reverts to the PR-1 revision, which has `/ready=200` cosmetic
green. If we need to go further back, `operator-os-api-00003-rzm` is
the pass-3 baseline.

## Architecture laws alignment

- **LAW #5 (verifiable honesty)**: readiness now reports what the
  system can actually deliver. Commands and exports cannot be
  consumed yet, and the endpoint says so.
- **LAW #4 (security-first)**: no changes to auth surface.
- **LAW #1 (trusted / visible)**: no changes to user-visible
  behaviour.

## Follow-ups

- Next priority is the durable worker (TD-ish, not yet filed as a
  specific TD because it's a feature, not debt - will be planned as
  its own pass).
- TD-008 fix (PowerShell variable interpolation) is a ~30-minute
  chore that unblocks the documented deploy path.
- TD-005 (anonymous `/v1/agent/*` and `/v1/ai/*`) is the highest
  outstanding security item.
