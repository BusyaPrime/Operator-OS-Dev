# RULES.md

Engineering standards for all code shipped into Operator-OS.

## Scope

This document is the reference for **how code should be written** in
this repo and every future parallel worktree / stream. It is extracted
from `docs/SPEC.md` Book XV § 137 for freestanding reference.

For **how a Claude agent behaves** (language, git workflow, commit
style, communication, autonomy), see `CLAUDE.md` at the repo root.

For the **full narrative** (vision, architecture, personas, design
system, orchestration, security, 6-week plan), see `docs/SPEC.md`.

Every PR is checked against these rules. A rule is either satisfied,
or an explicit exception is documented in the PR body /
`docs/DECISIONS.md`.

## Source of truth hierarchy

1. Explicit instruction from Akmal in the current session.
2. `docs/SPEC.md` — full narrative.
3. This file (`docs/RULES.md`) — R1-R50.
4. `CLAUDE.md` — operating harness.
5. Individual `docs/*.md` (DECISIONS, TECH_DEBT, DEPLOY, IAM_PLAN).

## The 5 Architectural Laws

Every rule below serves one or more of these laws. Full text lives in
`docs/SPEC.md` § 4.

1. **Trusted / Visible / No-Stealth.**
2. **User Sovereignty.**
3. **Multi-AI Agnostic.**
4. **Security-First.**
5. **Verifiable Honesty.**

---

## R1-R50

### R1. TypeScript strict mode always.

No `any`. Zod validation at every external boundary (HTTP input,
Pub/Sub payload, Firestore document shape, third-party API response).
Applies to: backend, mobile, desktop, shared packages.

### R2. Atomic commits.

One concern per commit. Conventional Commits format (`feat`, `fix`,
`chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`).

### R3. Never commit without passing local checks.

`pnpm typecheck`, `pnpm test`, `pnpm lint` all green before `git
commit`. For production paths, `pnpm build` also green.

### R4. No AI attribution in commits.

No "Co-authored-by: Claude", no "Generated with Claude Code", no
"Anthropic" mentions. Every commit authored as
`Akmal <hujdarovakmal@gmail.com>`.

### R5. Never secrets in code.

Only Secret Manager + `.env` (gitignored). If a secret ends up in git
history, stop, rotate, rewrite history, tell Akmal.

### R6. Large tasks require a plan.

Anything > 30 lines or > 3 files needs a written plan and explicit go
before implementation. Trivial changes (typo fixes, pure formatting)
exempted.

### R7. Planning then Implementation then Testing then Docs.

No shortcuts. No "I will write tests later".

### R8. GCP changes require double-check.

Deploy, IAM, secrets — show the command, wait for confirmation.
Applies to: any `gcloud`, `bq`, `gsutil` command that mutates state.

### R9. Image tags: explicit git SHA.

Never `:latest` in production. Cloud Run manifest and deploy script
must substitute an explicit SHA-derived tag.

### R10. HTTP endpoints: Zod in, typed out.

Every HTTP handler parses input through a Zod schema before touching
business logic. Response shapes are Zod-validated before sending.

### R11. Structured error handling.

`try` / `catch` with structured logging. Required context: request id,
trace id, user id, task id. No silent catches.

### R12. No `console.log`.

Structured logger only (Pino). Log levels per `docs/SPEC.md` § 88.

### R13. Tests for every new business logic function.

Unit tests required. Integration tests for critical paths (auth, task
dispatch, cost tracking, agent coordination).

### R14. External API calls: bounded and observable.

Timeout `<=` 30s. Retry `<=` 3 with exponential backoff. Rate-limit
per provider. Categorise errors into taxonomy (`retriable`, `fatal`,
`user_error`).

### R15. Docs updated in the same commit as code.

If a code change invalidates a doc, the doc change ships in the same
commit or the PR does not merge.

### R16. Long responses archived under `docs/sessions/`.

Anything > ~500 words (plans, diagnostics, BLOCK reports) mirrors
into `docs/sessions/YYYY-MM-DD-HHMM-topic.md`.

### R17. Prompt templates in `packages/prompts/`.

Never hardcoded into service code. Versioned. Per use case, per
provider.

### R18. Voice rules in `packages/voice/`.

One file per niche / context. Never hardcoded.

### R19. Firestore reads cached where possible.

10 min for config, 1 h for learning insights. Explicit invalidation
on write paths that touch cached collections.

### R20. Pub/Sub messages idempotent.

Every subscriber tolerates duplicates. `messageId` used for
deduplication where needed.

### R21. Aggressive push to remote.

Commit + push every atomic unit. Do not sit on local commits.

### R22. Comprehensive commit history.

Commit messages explain **why**, not just what. Reference the problem
being solved, the TD-NNN being addressed, the decision being
implemented.

### R23. Final reports in BLOCK format.

End-of-phase reports use BLOCK 1-8 (status, merged PRs, `/ready`
response, deploy details, tech debt, next work, session meta, URLs).
Copy-paste ready.

### R24. Session logging parallel to terminal output.

Update `docs/sessions/YYYY-MM-DD-HHMM-topic.md` every 10-15 minutes
with `## [HH:MM] Action` blocks while long-running work progresses.

### R25. Security changes STOP before deploy.

Auth, secrets, IAM, rate limits — require explicit "deploy go" even
if the phase itself was pre-approved.

### R26. Cloud Run service defaults.

`min-scale=0`, `max-scale` bounded, `cpu-throttling` on,
`startup-boost` on unless a specific reason to override.

### R27. Honest health endpoints.

`/health` reports process liveness. `/ready` is honest per LAW #5 —
report `degraded` with precise `reason` whenever any dependency is
not fully wired.

### R28. Forward-compatible database migrations.

Old code must work with new schema for at least one release.

### R29. Feature flags via env vars.

Every new feature behind an env-var flag for gradual rollout.

### R30. Platform conventions on mobile.

iOS HIG for iOS, Material Design for Android. No pixel-identical
replicas across platforms.

### R31. Mobile accessibility.

VoiceOver (iOS) and TalkBack (Android) labels on every interactive
element. Tap targets `>=` 44 x 44 pt.

### R32. Desktop agent runs in user session.

Not SYSTEM / root. User session is required for Claude Code to pick
up the user environment and credentials.

### R33. All subprocess output captured.

Desktop agent logs every subprocess it spawns. Output mirrors to
local file and streams to backend.

### R34. Commands validated before execution.

Signature + allowlist. Unsigned or non-allowlisted commands are
rejected by the desktop agent even if the WebSocket connection
delivers them.

### R35. WebSocket auto-reconnect.

Exponential backoff (1 s, 2 s, 4 s, 8 s, cap 60 s). Catchup protocol
on reconnect uses last-seen event id.

### R36. Graceful SIGTERM.

Every service handles SIGTERM: drain in-flight requests, flush logs,
close connections, exit cleanly.

### R37. Blue/green or canary for user-facing services.

No big-bang deploys on anything the user hits directly. Traffic
shift is gradual and observable.

### R38. Rollback within 60 seconds.

Always. Every deploy documents the exact rollback command and the
target revision.

### R39. User data export and delete.

Export always possible. Delete always honored. Hard delete on
account termination; no tombstones that hoard data.

### R40. Privacy in analytics.

No user data enters analytics pipelines without explicit consent.
PII hashed or redacted at source.

### R41. Mobile p95 screen load < 1 s.

Measured and tracked. Regressions block release.

### R42. API p95 latency < 500 ms.

Same — measured, tracked, regressions block.

### R43. WebSocket reconnection < 3 s.

From disconnect detection to resumed stream.

### R44. Human error messages.

Specific, actionable, non-jargon. Tell the user what to do next, not
just what failed.

### R45. Loading states for anything > 300 ms.

Skeleton or spinner. No blank screens waiting for data.

### R46. Empty states for every list.

Friendly, contextual empty state. No blank lists without explanation.

### R47. Error states for every data fetch.

Retry button, clear explanation, offline mode fallback if applicable.

### R48. E2E tests for critical user journeys.

Sign-in, PC pairing, task submission, PR review, merge, cost
dashboard. Run in CI pre-release.

### R49. Self-review before requesting review.

Re-read the diff. Run the checks. Explain the design choices in the
PR body. Do not submit a draft for Akmal to debug.

### R50. When in doubt, stop and ask.

Architectural decisions, ambiguous intent, high-blast-radius
operations — escalate, do not guess.

---

## Living document

New rules are added with a date and a link to the commit / PR that
introduced them. Deprecated rules are struck through with a reason.
`docs/DECISIONS.md` records the ADR that made the change.
