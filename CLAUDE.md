# CLAUDE.md

Operating contract for Claude Code agents working in this repository.
This file defines **how a Claude agent behaves** in this repo: language,
git workflow, commit style, communication protocol, autonomy boundaries.

Product engineering standards (TypeScript, testing, performance, Cloud
Run discipline, R1-R50) live separately in `docs/RULES.md` and the master
spec `docs/SPEC.md`. Do not duplicate them here.

## Source of truth hierarchy

When rules or guidance conflict, this order wins:

1. Explicit instruction from Akmal (BusyaPrime) in the current session.
2. `docs/SPEC.md` — Master Technical Specification v1.0 (vision,
   architecture, 5 Architectural Laws).
3. `docs/RULES.md` — R1-R50 engineering standards extracted from SPEC
   § 137.
4. This file (`CLAUDE.md`) — operating harness.
5. Other `docs/*.md` (DECISIONS, TECH_DEBT, DEPLOY, IAM_PLAN, etc.).

If a session feels out of alignment with any of the above, stop and ask
before proceeding.

## Project one-liner

Operator-OS is a Primary AI Control Platform: a mobile-first system that
lets a single founder command a swarm of AI agents running on their
computers, from anywhere in the world. Full vision in `docs/SPEC.md`
Book I.

Non-negotiable architectural laws (full text in `docs/SPEC.md` § 4):

1. Trusted / Visible / No-stealth.
2. User Sovereignty.
3. Multi-AI Agnostic.
4. Security-First.
5. Verifiable Honesty.

Every feature must pass all five.

## Language rules

- **Chat with Akmal:** Russian.
- **Code, tests, config:** English.
- **Code comments:** English. Minimal — only when the "why" is
  non-obvious (hidden constraint, invariant, workaround).
- **Commit messages:** English, Conventional Commits.
- **PR titles and bodies:** English, first person as the engineer
  ("I refactored…"), never "Claude did…".
- **Docs (`.md`):** English.
- **Product UI copy:** English for MVP. Localization later.

## Identity

Repo-local git config must resolve to:

- `user.name = Akmal`
- `user.email = hujdarovakmal@gmail.com`

Before every commit:

```bash
git config --get user.name
git config --get user.email
```

If either is wrong, fix it before committing (repo-local scope only,
never `--global` unless Akmal explicitly asks).

**Never attribute work to AI.** No "Co-authored-by: Claude", no
"🤖 Generated with Claude Code" footers, no "Anthropic" in commit
messages or PR descriptions. If a commit shows AI attribution, rebase to
strip it **before pushing**.

## Git workflow

### Branch names

- `feat/<short-slug>` — new functionality.
- `fix/<short-slug>` — bug fix.
- `docs/<short-slug>` — docs-only change.
- `chore/<short-slug>` — housekeeping, no behaviour change.
- `refactor/<short-slug>` — internal restructure.
- `test/<short-slug>` — test-only.
- `perf/<short-slug>` — performance.
- `ci/<short-slug>` — CI/build system.

### Base branch

Active development runs on `phase3/live-deploy-and-vertex`. Open PRs
against it. Promotion to `bootstrap/foundation-v1` / `main` happens in
dedicated merge PRs approved by Akmal.

### Commit discipline

- One logical change per commit.
- Multiple atomic commits per PR are fine and encouraged.
- After each atomic commit, push immediately (R21 in `docs/RULES.md`).
- Body explains **why**, not just **what** (R22).

### Never without explicit "go" from Akmal

- `git push --force` on shared branches.
- `git reset --hard` on published commits.
- Rewriting published history.
- Merging straight into `main` or `bootstrap/foundation-v1`.
- Squashing anyone else's commits.
- Skipping hooks (`--no-verify`) or signing (`--no-gpg-sign`).
- Deleting branches that others might be tracking.

## Commit style

Conventional Commits only:

```
feat(scope): subject
fix(scope): subject
chore(scope): subject
docs(scope): subject
refactor(scope): subject
test(scope): subject
perf(scope): subject
build(scope): subject
ci(scope): subject
```

Common scopes: `api`, `mobile`, `desktop`, `infra`, `deploy`, `docs`,
`contract`, `session`, `contracts`, `config`.

Subject line ≤ 72 chars, imperative mood, no trailing period.

Body is optional for trivial changes, required for non-trivial:

```
chore(scope): subject

Explain why this change is needed. Reference the problem being
solved, the constraint being honoured, or the decision being
implemented. Reference other commits or TD-NNN entries when
relevant.

Do NOT include AI attribution.
```

## Communication protocol

### Updates during work

- One brief status (1-2 lines) after each atomic commit or significant
  step.
- Status at phase boundaries: finished branch / opened PR / CI result /
  merged / deployed / verified.
- Never narrate internal thinking. Narrate results, decisions, blockers.

### Phase / milestone reports (BLOCK format)

Per R23, end-of-phase reports use this structure:

```
BLOCK 1: STATUS                  (RESOLVED / PARTIAL / FAILED)
BLOCK 2: MERGED PRS              (table: # / title / SHA)
BLOCK 3: CURRENT /ready RESPONSE (production JSON)
BLOCK 4: DEPLOY DETAILS          (revision / image / SHA / rollback)
BLOCK 5: TECH DEBT REGISTERED    (TD-NNN summary)
BLOCK 6: NEXT RECOMMENDED WORK   (top 3)
BLOCK 7: SESSION META            (commits, files, lines, wall time)
BLOCK 8: URLS                    (production, PRs, key files)
```

Mirror the same report into `docs/sessions/YYYY-MM-DD-topic.md` per R24.

### Escalation

Stop and escalate in chat (no autonomous action) when:

- A security issue surfaces.
- Data-loss risk is detected.
- A breaking change is required.
- An architectural decision is ambiguous and not covered in `SPEC.md`.
- User intent is unclear.
- A production dependency fails in a new way.

### Clarifying questions

When ambiguous, use R12 format:

```
I see N paths:
  (A) … Pros: … Cons: …
  (B) … Pros: … Cons: …
My recommendation: X because Y.
Confirm or correct.
```

Max 3 questions at a time. Mark hard blockers `[BLOCKING]`.

## Autonomy boundaries

### Allowed without per-action approval (inside an approved phase)

- Create feature/fix/docs/chore branches.
- Commit and push to those branches.
- Open PRs with pre-approved scope and labels.
- Wait for CI (`gh pr checks --watch`).
- Merge (squash + delete-branch) PRs that you opened yourself,
  once CI is green and scope is within the pre-approved plan.
- Run local `pnpm install / typecheck / lint / test / build`.
- Read Cloud Logging, Firestore, Pub/Sub, BigQuery, Cloud Run state.
- Create / update `docs/TECH_DEBT.md`, `docs/sessions/*`, `docs/DECISIONS.md`
  as part of a landed PR.

### Always requires explicit "go" (even inside an approved phase)

- Deploying to Cloud Run production (R25).
- IAM changes (adding bindings, creating service accounts).
- Secret creation, rotation, deletion.
- Merging a PR that Akmal did not pre-approve.
- Pushing directly to `main` or `bootstrap/foundation-v1`.
- Any `gcloud` command with `--delete`, `--destroy`, `--force`, or
  `--quiet` against a live resource.
- Changes to `.github/workflows/*` that affect CI behaviour for other
  branches.
- Creating new Cloud Run services.
- Spending money (provisioning paid GCP resources that were not already
  in the approved plan).

## File layout reference

- `docs/SPEC.md` — master technical specification (source of truth).
- `docs/RULES.md` — R1-R50 engineering standards.
- `docs/DECISIONS.md` — architecture decision records.
- `docs/TECH_DEBT.md` — TD-001…TD-NNN registry.
- `docs/sessions/` — BLOCK-format session archives.
- `docs/PASS3_STATUS.md` — pass 3 + P0.1 status record.
- `docs/DEPLOY.md` — deploy runbook.
- `docs/IAM_PLAN.md` — IAM least-privilege plan.
- `docs/SECURITY_MODEL.md` — trust boundaries and prohibitions.
- `docs/VERTEX.md` — Vertex AI usage notes.
- `docs/GCP_RESOURCES.md` — existing GCP resources the repo may assume.
- `docs/ARCHITECTURE.md` — earlier architecture narrative (superseded
  by `SPEC.md`, kept for context).
- `docs/HANDOFF.md`, `docs/BOOTSTRAP_STATUS.md`,
  `docs/PASS2_STATUS.md`, `docs/CLAUDE_CODE_EXPORT.md` — historical.

## Host environment

- Windows 11 Pro. Primary shell is Git Bash. Use Unix-style paths
  and syntax in scripts (`/dev/null` not `NUL`, forward slashes).
- `gcloud` SDK at `D:\SDKs\GoogleCloudCLI\google-cloud-sdk`. From Git
  Bash, export
  `CLOUDSDK_PYTHON=/d/SDKs/GoogleCloudCLI/google-cloud-sdk/platform/bundledpython/python.exe`
  to bypass the Windows Python app-execution alias.
- `gh` CLI authenticated as `BusyaPrime` via Windows Credential
  Manager keyring.
- Active GCP project: `operator-os-dev`.
- Runtime service identity:
  `cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com`.
- Build identity:
  `deploy-bot@operator-os-dev.iam.gserviceaccount.com`.

## When in doubt

Stop and ask. Don't guess on architectural decisions. See R50 in
`docs/RULES.md`.
