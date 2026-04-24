import { agentManifestSchema } from '@operator-os/contracts';

import type {
  AgentSession,
  AgentSessionRegistry
} from './agent-session-registry.js';

export interface TaskRoutingRequest {
  /** Capability names the task requires an agent to support. */
  readonly capabilities: readonly string[];
}

export interface TaskRouter {
  /**
   * Picks the next agent whose declared capabilities are a superset of
   * the task's required capabilities, using per-bucket round-robin.
   * Returns null when no registered agent matches. Idempotent with
   * respect to cursor state: cursor advances on each call, so two
   * identical requests receive different agents when ≥2 match.
   */
  findMatchingAgent(request: TaskRoutingRequest): AgentSession | null;

  /**
   * Read-only view of the per-bucket cursor map. Exposed for tests and
   * diagnostics. Keys are canonical bucket strings; values are the
   * index of the LAST-assigned agent within that bucket's sorted
   * candidate list.
   */
  readonly cursors: ReadonlyMap<string, number>;
}

export interface CreateTaskRouterOptions {
  readonly sessionRegistry: AgentSessionRegistry;
}

/**
 * Canonical bucket key — sorted, deduped, `|`-joined. Two tasks whose
 * required capability sets are equal under set semantics share a cursor
 * regardless of array order or duplicate entries from the caller, so
 * round-robin is fair within an equivalence class.
 *
 * Empty required set ⇒ empty string key; represents the "matches any
 * agent" bucket (which still rotates independently of capability-scoped
 * buckets).
 */
const bucketKeyFor = (required: ReadonlySet<string>): string =>
  [...required].sort().join('|');

const extractAgentCapabilities = (
  session: AgentSession
): ReadonlySet<string> | null => {
  const parsed = agentManifestSchema.safeParse(session.manifest);
  if (!parsed.success) {
    return null;
  }
  return new Set(parsed.data.capabilities.map((c) => c.capability));
};

const isSuperset = (
  sup: ReadonlySet<string>,
  sub: ReadonlySet<string>
): boolean => {
  for (const x of sub) {
    if (!sup.has(x)) {
      return false;
    }
  }
  return true;
};

export const createTaskRouter = (
  opts: CreateTaskRouterOptions
): TaskRouter => {
  const cursors = new Map<string, number>();

  const findMatchingAgent = (
    request: TaskRoutingRequest
  ): AgentSession | null => {
    const required = new Set(request.capabilities);
    const candidates: AgentSession[] = [];

    for (const session of opts.sessionRegistry.list()) {
      const agentCaps = extractAgentCapabilities(session);
      if (!agentCaps) {
        // Malformed / unrecognised manifest — exclude rather than crash.
        // Hello-frame validation (c13) rejects malformed manifests at
        // the source; this branch defends against registry state that
        // predates that hardening.
        continue;
      }
      if (isSuperset(agentCaps, required)) {
        candidates.push(session);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Stable ordering by sessionId. Phase 2's in-memory AgentSessionRegistry
    // returns a readonly snapshot from list() but does not contractually
    // guarantee the order across successive calls; sorting explicitly
    // makes round-robin deterministic regardless of registry internals.
    candidates.sort((a, b) => a.sessionId.localeCompare(b.sessionId));

    const key = bucketKeyFor(required);
    const lastIdx = cursors.get(key) ?? -1;
    const nextIdx = (lastIdx + 1) % candidates.length;
    cursors.set(key, nextIdx);
    return candidates[nextIdx] ?? null;
  };

  return {
    findMatchingAgent,
    get cursors() {
      return cursors;
    }
  };
};
