import { EventEmitter } from 'node:events';

import type {
  AIAgent,
  AIAgentState
} from '@operator-os/contracts';

import type { Logger } from 'pino';

/**
 * Events emitted by AgentRegistry as it loads / unloads agents
 * and observes state changes. Typed as a discriminated union
 * so listener signatures stay compile-time safe.
 */
export type AgentRegistryEvent =
  | { type: 'agent:registered'; agentId: string; providerId: string }
  | { type: 'agent:unregistered'; agentId: string; reason: 'user' | 'shutdown' | 'error' }
  | { type: 'agent:state-changed'; agentId: string; state: AIAgentState };

export type AgentRegistryListener = (event: AgentRegistryEvent) => void;

export interface AgentRegistrySubscription {
  unsubscribe(): void;
}

/**
 * In-memory registry of installed `AIAgent` instances. Keyed by
 * `AIAgent.identity.id` (the stable UUID, not providerId), so
 * multiple instances of the same provider can coexist if that
 * ever becomes useful.
 *
 * Phase 1.4 scope: read-only after bootstrap. The registry is
 * populated once at DesktopRuntime startup; runtime agent
 * install / uninstall per SPEC § 27.5 is Week 3+ work.
 */
export class AgentRegistry {
  #agents = new Map<string, AIAgent>();
  #emitter = new EventEmitter();
  #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger.child({ component: 'agent-registry' });
    // Disable default max-listener warning - subscribers are
    // in-process code we control, not arbitrary callers.
    this.#emitter.setMaxListeners(0);
  }

  register(agent: AIAgent): void {
    const id = agent.identity.id;
    if (this.#agents.has(id)) {
      throw new Error(
        `AgentRegistry: agent id '${id}' already registered` +
          ` (providerId='${agent.identity.providerId}')`
      );
    }
    this.#agents.set(id, agent);
    this.#logger.info(
      { agentId: id, providerId: agent.identity.providerId },
      'agent registered'
    );
    this.#emit({
      type: 'agent:registered',
      agentId: id,
      providerId: agent.identity.providerId
    });
  }

  unregister(
    agentId: string,
    reason: 'user' | 'shutdown' | 'error' = 'user'
  ): void {
    if (!this.#agents.has(agentId)) return;
    this.#agents.delete(agentId);
    this.#logger.info({ agentId, reason }, 'agent unregistered');
    this.#emit({ type: 'agent:unregistered', agentId, reason });
  }

  get(agentId: string): AIAgent | undefined {
    return this.#agents.get(agentId);
  }

  list(): readonly AIAgent[] {
    return [...this.#agents.values()];
  }

  size(): number {
    return this.#agents.size;
  }

  /**
   * Called by DesktopRuntime (or by an agent wrapper) when an
   * agent's status changes. The registry fans the signal out
   * to subscribers without needing to poll `agent.getStatus()`.
   */
  notifyStateChanged(agentId: string, state: AIAgentState): void {
    if (!this.#agents.has(agentId)) return;
    this.#emit({ type: 'agent:state-changed', agentId, state });
  }

  subscribe(listener: AgentRegistryListener): AgentRegistrySubscription {
    const wrapped = (event: AgentRegistryEvent): void => {
      try {
        listener(event);
      } catch (err) {
        this.#logger.warn(
          { err, eventType: event.type },
          'registry listener threw; continuing'
        );
      }
    };
    this.#emitter.on('event', wrapped);
    return {
      unsubscribe: () => {
        this.#emitter.off('event', wrapped);
      }
    };
  }

  #emit(event: AgentRegistryEvent): void {
    this.#emitter.emit('event', event);
  }
}
