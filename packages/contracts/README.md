# @operator-os/contracts

Type-safe contracts shared across every runtime in Operator-OS.
Every app in this monorepo (`apps/api`, `apps/auth-gateway`,
`apps/desktop-agent`, `apps/mobile`) imports from this package;
no runtime service depends on another service's types directly.

## Exports

### Universal AI Platform (`src/ai/`)

Four provider-agnostic interfaces that every AI agent in
Operator-OS implements. Canonical definitions for LAW #3 (Multi-AI
Agnostic). See [`docs/SPEC.md`](../../docs/SPEC.md) §61-66.7 and
the `ai/` source files for full docs.

```typescript
import type {
  AIAgent,              // master agent interface
  FileSystemProvider,   // scoped filesystem access
  StreamProvider,       // response streaming transport
  CostProvider,         // cost tracking + budget enforcement
  AgentManifest,        // plugin descriptor for registry
  AgentCapability       // narrow union of supported capabilities
} from '@operator-os/contracts';

import {
  AIAgentError,                  // base class for agent errors
  BudgetExceededError,
  CapabilityNotSupportedError,
  PathNotAllowedError
} from '@operator-os/contracts';
```

The `AIAgent` interface carries readonly `fs`, `stream`, `cost`
fields — each concrete agent (ClaudeCodeAgent, CodexAgent,
CursorCLIAgent, OllamaAgent, …) ships with its own specialised
providers via DI at construction time.

### Agent protocol (`src/agent/`)

Zod schemas for agent-to-api HTTP contracts.

```typescript
import {
  agentHeartbeatRequestSchema,
  agentHeartbeatResponseSchema,
  type AgentHeartbeatRequest,
  type AgentHeartbeatResponse
} from '@operator-os/contracts';
```

Additive to the existing `deviceStateSchema` in `src/operator.ts`
— agent heartbeat and device state are separate concerns. See
`docs/DECISIONS.md` entry *Agent Heartbeat Schema Is Additive, Not
Replacement* for why.

### Auth gateway (`src/auth-gateway.ts`)

Zod schemas for sign-in / refresh / sign-out flows, plus the
`sanitizedJwtSchema` that the auth-gateway verifies id tokens
against before handing them to `google-auth-library`.

### Operator domain (`src/operator.ts`, `src/runtime.ts`,
`src/messaging.ts`, `src/health.ts`, `src/common.ts`, `src/auth.ts`)

Everything else: devices, sessions, alerts, costs, commands,
heartbeats (device-level), auth sessions, health responses,
operator dashboards. Pre-existing from Day 1 bootstrap; see the
files themselves for inventory.

## Testing convention

Type-level enforcement is the load-bearing test strategy here.
Every interface file has a sibling test under `src/<domain>/__tests__/`:

```
src/ai/ai-agent.ts
src/ai/__tests__/ai-agent.test.ts        # expectTypeOf assertions
```

The `.test.ts` suffix (not `.test-d.ts`) matches vitest's default
include glob. Type assertions use `expectTypeOf` from vitest; no
additional tooling required.

Run:

```
pnpm -F @operator-os/contracts test
pnpm -F @operator-os/contracts typecheck
pnpm -F @operator-os/contracts build
```

113 tests across 8 test files at time of writing. See
`docs/DECISIONS.md` entry *Type-Level Tests Are The Contract
Enforcement Mechanism For packages/contracts* for the full
rationale.

## Invariants

- **Type-only except for error classes.** Every non-error export
  is a TypeScript type or Zod schema. No runtime logic beyond
  error constructor bodies. If you find yourself writing a
  function body in this package, it probably belongs in an app.
- **Zero workspace dependencies.** The package imports only
  `zod` from the broader ecosystem; no `@operator-os/*`
  cross-package imports. This keeps it the foundational layer
  everything else builds on.
- **No side-effect imports.** Barrel imports (`export *`) fan out
  to individual modules; no module executes top-level code at
  import time.
- **SPEC mirrors contracts.** `docs/SPEC.md` §61-66.7 code blocks
  are kept in lockstep with `src/ai/*.ts`. If you change an
  interface shape here, update the SPEC in the same PR (see the
  ADR pair on SPEC evolution + type-level tests).

## File layout

```
packages/contracts/
├── README.md                           ← this file
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                        ← top-level barrel
    ├── agent/
    │   ├── index.ts
    │   └── heartbeat.ts                ← agent heartbeat Zod schemas
    ├── ai/                             ← Universal AI Platform
    │   ├── index.ts
    │   ├── ai-agent.ts
    │   ├── agent-errors.ts
    │   ├── agent-manifest.ts
    │   ├── capabilities.ts
    │   ├── cost-provider.ts
    │   ├── filesystem-provider.ts
    │   ├── stream-provider.ts
    │   └── __tests__/                  ← type-level tests (6 files, 90+ assertions)
    ├── auth.ts
    ├── auth-gateway.ts
    ├── auth-gateway.test.ts
    ├── common.ts
    ├── health.ts
    ├── index.test.ts
    ├── messaging.ts
    ├── operator.ts
    └── runtime.ts
```
