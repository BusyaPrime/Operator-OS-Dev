# Documentation Map

Navigation for the Operator-OS repo.

## Read first

Source-of-truth hierarchy runs top to bottom. When two docs disagree,
the higher one wins.

- [SPEC.md](/D:/Operator-OS-Dev/docs/SPEC.md) — **Master Technical
  Specification v1.0.** Vision, architecture, the 5 Architectural
  Laws, backend / desktop / mobile specs, AI router, orchestration,
  security, observability, cost intelligence, 6-week sprint plan,
  R1-R50 operational rules. Canonical source of truth for all product
  work.
- [RULES.md](/D:/Operator-OS-Dev/docs/RULES.md) — **R1-R50 engineering
  standards.** Standalone reference extracted from SPEC Book XV for
  fast lookup during code review.
- [CLAUDE.md](/D:/Operator-OS-Dev/CLAUDE.md) — **Operating harness**
  for Claude Code agents. Language, git workflow, commit style,
  communication protocol, identity verification, autonomy boundaries.
- [SECURITY_MODEL.md](/D:/Operator-OS-Dev/docs/SECURITY_MODEL.md) —
  trust boundaries and explicit prohibitions (no stealth, no hidden
  control, no keylogging).

## Living state

Updated as the project evolves. Always current.

- [TECH_DEBT.md](/D:/Operator-OS-Dev/docs/TECH_DEBT.md) — TD-001
  through TD-NNN, tracked over time with type, priority, status, fix
  plan.
- [DECISIONS.md](/D:/Operator-OS-Dev/docs/DECISIONS.md) — architecture
  decision records (ADRs).
- [PASS3_STATUS.md](/D:/Operator-OS-Dev/docs/PASS3_STATUS.md) — pass 3
  plus P0.1 status record (deploy state, `/ready` semantics,
  remaining follow-ups).
- [IAM_PLAN.md](/D:/Operator-OS-Dev/docs/IAM_PLAN.md) — IAM
  least-privilege plan, per service account, per resource.
- [DEPLOY.md](/D:/Operator-OS-Dev/docs/DEPLOY.md) — deploy runbook,
  Cloud Build / Cloud Run flow, `/ready` contract.
- [GCP_RESOURCES.md](/D:/Operator-OS-Dev/docs/GCP_RESOURCES.md) —
  existing GCP resources the repo is allowed to assume.

## Integration reference

- [VERTEX.md](/D:/Operator-OS-Dev/docs/VERTEX.md) — Vertex AI usage
  model and manual setup notes.
- [ARCHITECTURE.md](/D:/Operator-OS-Dev/docs/ARCHITECTURE.md) —
  earlier architecture narrative. Superseded by `SPEC.md` but kept
  for historical context.

## Archive

Historical snapshots from earlier passes. Kept for context; not
actively maintained.

- [HANDOFF.md](/D:/Operator-OS-Dev/docs/HANDOFF.md) — branch state
  and recommended next actions at end of phase 2.
- [BOOTSTRAP_STATUS.md](/D:/Operator-OS-Dev/docs/BOOTSTRAP_STATUS.md) —
  audit and bootstrap checkpoint.
- [PASS2_STATUS.md](/D:/Operator-OS-Dev/docs/PASS2_STATUS.md) — pass 2
  status record.
- [CLAUDE_CODE_EXPORT.md](/D:/Operator-OS-Dev/docs/CLAUDE_CODE_EXPORT.md) —
  original 18-section handoff document written by OpenAI Codex.
- [ROADMAP.md](/D:/Operator-OS-Dev/docs/ROADMAP.md) — earlier staged
  delivery plan. Superseded by SPEC Book XIV.
- [sessions/](/D:/Operator-OS-Dev/docs/sessions/) — BLOCK-format
  session archives (`YYYY-MM-DD-topic.md`).
