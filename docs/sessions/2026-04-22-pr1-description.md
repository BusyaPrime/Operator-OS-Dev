## Summary

Wires up `TASKS_TARGET_BASE_URL` across the deploy pipeline and adds
three Fastify stub handlers under `/internal/tasks/*` to receive Cloud
Tasks dispatches. Handlers validate payloads via Zod, log
`task_received` events, and return 204 No Content. This eliminates the
404 retry-storm risk that would occur if we only set the env var
without endpoints.

## Root cause (context)

Cloud Run revision `operator-os-api-00003-rzm` had an empty
`TASKS_TARGET_BASE_URL`, so `TasksQueueClient.describeReadiness()`
reported `not_configured`. That status was inherited by
`CommandsService` and `ExportsService` (they bubble tasks status into
`degraded`), and the readiness aggregator (`any degraded -> overall
degraded`) returned HTTP 503 on `/ready`.

PR-1 fixes the env wiring and prevents the retry-storm that would
otherwise start the moment the env var is set. PR-2 (next) will adjust
`CommandsService` / `ExportsService` readiness messages to be honest
about worker-not-implemented state, in line with LAW #5.

## Changes

- **NEW** `apps/api/src/routes/internal-tasks.ts` - three `POST`
  handlers (`/commands`, `/approvals`, `/exports`), Zod-validated
  payloads, `task_received` structured logging, 204 responses.
- **NEW** `apps/api/src/routes/internal-tasks.test.ts` - six vitest
  tests: three happy-path, three validation-reject.
- **MODIFIED** `apps/api/src/app.ts` - registers the new routes after
  the AI routes in the composition root.
- **MODIFIED** `infra/cloud-run/api.service.yaml` -
  `TASKS_TARGET_BASE_URL: "https://operator-os-api-m545sz2isq-ez.a.run.app"`.
- **MODIFIED** `infra/scripts/deploy-api.ps1` - default parameter
  `$TasksTargetBaseUrl` set to the production URL so unparameterised
  deploys stay correct.

## Verification

- `pnpm -r typecheck` green across five workspaces.
- `pnpm -r lint` green.
- `pnpm -r test` green - 23 tests across five workspaces:
  `api` 9 (two new files contribute 6 of those), `config` 4,
  `contracts` 6, `desktop-agent` 2, `mobile` 2.
- `pnpm build` green, 5/5 tasks.

## Not included (intentional)

- `CLAUDE.md` operating contract - separate chore PR.
- `.claude/` harness directory - will be added to `.gitignore`
  separately.
- `docs/TECH_DEBT.md` - follow-up chore PR: dead code in
  `apps/api/src/modules/commands/index.ts` and
  `modules/exports/index.ts`, `:latest` image tag in
  `api.service.yaml`, missing OIDC verification middleware on
  `/internal/tasks/*`.
- `CommandsService` / `ExportsService` readiness message updates -
  PR-2 (`feat/honest-readiness`).

## Rollback plan

If the new revision misbehaves in production:

```
gcloud run services update-traffic operator-os-api \
  --region=europe-west4 \
  --to-revisions=operator-os-api-00003-rzm=100
```

This reverts traffic to the current good revision in under a minute.

## Post-merge actions

1. Deploy to Cloud Run with the merge SHA.
2. `curl /ready` - expect `tasks=ok`, `commands=degraded`,
   `exports=degraded` (overall still 503 until PR-2).
3. Verify no 404 spam in Cloud Logging for `/internal/tasks/*`.
4. Proceed with PR-2 (readiness message honesty).

## Architecture laws alignment

- **LAW #1 (trusted / visible)**: every accepted task is logged as
  `task_received` with queue / id / device fields.
- **LAW #4 (security-first)**: Zod validation on all payload paths;
  no payload reaches business logic unvalidated.
- **LAW #5 (verifiable honesty)**: handlers are explicit stubs - no
  durable work yet - and follow-up PR-2 will surface that honestly in
  readiness instead of claiming `commands=ok`.
