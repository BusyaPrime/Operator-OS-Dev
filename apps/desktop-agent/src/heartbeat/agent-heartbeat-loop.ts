import {
  agentHeartbeatRequestSchema,
  agentHeartbeatResponseSchema,
  type AgentHeartbeatRequest,
  type AgentHeartbeatResponse,
  type AIAgent
} from '@operator-os/contracts';
import type { Logger } from 'pino';

import type { AgentRegistry } from '../registry/agent-registry.js';

/**
 * Result of one POST to the agent-heartbeat endpoint. The poster
 * returns the raw HTTP status + body instead of throwing so this
 * loop can branch on auth (`401`) vs. other 4xx/5xx vs. network
 * errors cleanly.
 */
export interface AgentHeartbeatPostResult {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Function that delivers a validated heartbeat request. The
 * default implementation (see `runtime.ts`) POSTs to
 * `/v1/agent/heartbeat/agent` — a new additive endpoint that
 * doesn't exist on the api yet (tracked as TD-024). Until then
 * the default poster may be a stub that returns `{ status: 200,
 * body: { status: 'ok', ... } }`.
 */
export type AgentHeartbeatPoster = (
  request: AgentHeartbeatRequest
) => Promise<AgentHeartbeatPostResult>;

export interface AgentHeartbeatLoopOptions {
  readonly registry: AgentRegistry;
  readonly logger: Logger;
  readonly poster: AgentHeartbeatPoster;
  readonly intervalMs: number;
  readonly degradedFailThreshold?: number;
  readonly offlineFailThreshold?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Called with no args when the poster returns 401. */
  readonly refreshToken?: () => Promise<void>;
  /**
   * Injected current-time source. Tests pass a controllable clock;
   * default is `Date.now`.
   */
  readonly now?: () => number;
}

interface PerAgentState {
  consecutiveFailures: number;
  /** Epoch ms after which the loop may retry this agent. */
  nextAllowedAt: number;
}

const DEGRADED_DEFAULT = 5;
const OFFLINE_DEFAULT = 20;
const BASE_BACKOFF_DEFAULT_MS = 1_000;
const MAX_BACKOFF_DEFAULT_MS = 60_000;
const BACKOFF_EXPONENT_CAP = 10;

/**
 * Periodic loop that posts an additive per-agent heartbeat to
 * the api for every agent in the registry. Independent from the
 * device-state heartbeat — see DECISIONS.md ADR "Agent Heartbeat
 * Schema Is Additive, Not Replacement" (2026-04-24).
 *
 * Failure handling:
 *   • Exponential backoff per agent: the loop skips an agent
 *     whose `nextAllowedAt` is in the future.
 *   • On 401: if a `refreshToken` hook is supplied, refresh and
 *     retry the same request once. A subsequent non-2xx still
 *     counts as one failure; a 2xx resets the failure counter.
 *   • Threshold → registry state transitions:
 *       degraded when consecutiveFailures === degradedFailThreshold
 *       offline  when consecutiveFailures === offlineFailThreshold
 *     Both thresholds emit via `registry.notifyStateChanged` so
 *     observers can surface connectivity issues in the UI
 *     without the agent mutating its own internal state.
 *   • On the first successful heartbeat after any failure, the
 *     registry is notified back to 'idle' (recovery signal).
 *
 * Runtime validation:
 *   • Outbound bodies go through `agentHeartbeatRequestSchema`
 *     so a drift between `AIAgent.getStatus` and the posted
 *     payload is caught locally instead of failing on the
 *     server.
 *   • Inbound responses are parsed against
 *     `agentHeartbeatResponseSchema`; a non-conforming body is
 *     logged + counted as a failure (the loop doesn't try to
 *     handle commands it can't trust).
 */
export class AgentHeartbeatLoop {
  #options: Required<
    Omit<AgentHeartbeatLoopOptions, 'refreshToken'>
  > & {
    refreshToken?: () => Promise<void>;
  };
  #logger: Logger;
  #timer?: NodeJS.Timeout;
  #perAgent = new Map<string, PerAgentState>();

  constructor(options: AgentHeartbeatLoopOptions) {
    this.#options = {
      registry: options.registry,
      logger: options.logger,
      poster: options.poster,
      intervalMs: options.intervalMs,
      degradedFailThreshold:
        options.degradedFailThreshold ?? DEGRADED_DEFAULT,
      offlineFailThreshold:
        options.offlineFailThreshold ?? OFFLINE_DEFAULT,
      baseBackoffMs: options.baseBackoffMs ?? BASE_BACKOFF_DEFAULT_MS,
      maxBackoffMs: options.maxBackoffMs ?? MAX_BACKOFF_DEFAULT_MS,
      now: options.now ?? (() => Date.now()),
      refreshToken: options.refreshToken
    };
    this.#logger = options.logger.child({ component: 'agent-heartbeat-loop' });
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#logger.info(
      { intervalMs: this.#options.intervalMs },
      'starting agent heartbeat loop'
    );
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#options.intervalMs);
    // Don't block process exit on this timer; the runtime stop()
    // call handles graceful shutdown, and during test teardown
    // an outstanding timer would pin the event loop.
    if (typeof this.#timer.unref === 'function') this.#timer.unref();
    // Kick the first tick synchronously so agents aren't silent
    // for a full interval on startup.
    void this.tick();
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /**
   * Iterate all registered agents and emit a heartbeat for each
   * whose backoff window has elapsed. Public so tests can drive
   * it deterministically without relying on real timers.
   */
  async tick(): Promise<void> {
    const agents = this.#options.registry.list();
    const now = this.#options.now();
    for (const agent of agents) {
      const state = this.#stateFor(agent.identity.id);
      if (state.nextAllowedAt > now) {
        this.#logger.debug(
          {
            agentId: agent.identity.id,
            nextAllowedAt: state.nextAllowedAt,
            now
          },
          'heartbeat skipped — backoff window'
        );
        continue;
      }
      try {
        await this.#emitFor(agent, state);
      } catch (err) {
        this.#onFailure(agent, state, err);
      }
    }
  }

  // ---------- internals ----------

  #stateFor(agentId: string): PerAgentState {
    let state = this.#perAgent.get(agentId);
    if (state === undefined) {
      state = { consecutiveFailures: 0, nextAllowedAt: 0 };
      this.#perAgent.set(agentId, state);
    }
    return state;
  }

  async #emitFor(agent: AIAgent, state: PerAgentState): Promise<void> {
    const body = await this.#buildBody(agent);
    const validated = agentHeartbeatRequestSchema.parse(body);

    let response = await this.#options.poster(validated);

    if (response.status === 401 && this.#options.refreshToken !== undefined) {
      this.#logger.info(
        { agentId: agent.identity.id },
        '401 on heartbeat — refreshing token and retrying once'
      );
      await this.#options.refreshToken();
      response = await this.#options.poster(validated);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `agent-heartbeat responded with status ${response.status}`
      );
    }

    const parsed: AgentHeartbeatResponse =
      agentHeartbeatResponseSchema.parse(response.body);
    this.#onSuccess(agent, state);
    this.#dispatchCommands(agent, parsed);
  }

  async #buildBody(agent: AIAgent): Promise<AgentHeartbeatRequest> {
    const status = await agent.getStatus();
    return {
      agentId: agent.identity.id,
      providerId: agent.identity.providerId,
      providerVersion: agent.identity.providerVersion,
      platform: agent.identity.platform,
      hostname: agent.identity.hostname,
      state: status.state,
      uptimeSeconds: agent.runtime.uptimeSeconds,
      activeTaskCount: status.currentTaskId ? 1 : 0,
      healthChecks: status.healthChecks,
      timestamp: new Date().toISOString()
    };
  }

  #onSuccess(agent: AIAgent, state: PerAgentState): void {
    if (state.consecutiveFailures > 0) {
      this.#logger.info(
        {
          agentId: agent.identity.id,
          recoveredAfterFailures: state.consecutiveFailures
        },
        'heartbeat recovered'
      );
      this.#options.registry.notifyStateChanged(agent.identity.id, 'idle');
    }
    state.consecutiveFailures = 0;
    state.nextAllowedAt = 0;
  }

  #onFailure(
    agent: AIAgent,
    state: PerAgentState,
    err: unknown
  ): void {
    state.consecutiveFailures += 1;
    const exponent = Math.min(
      state.consecutiveFailures - 1,
      BACKOFF_EXPONENT_CAP
    );
    const delay = Math.min(
      this.#options.baseBackoffMs * 2 ** exponent,
      this.#options.maxBackoffMs
    );
    state.nextAllowedAt = this.#options.now() + delay;

    this.#logger.warn(
      {
        err,
        agentId: agent.identity.id,
        consecutiveFailures: state.consecutiveFailures,
        retryInMs: delay
      },
      'agent heartbeat failed'
    );

    if (state.consecutiveFailures === this.#options.degradedFailThreshold) {
      this.#logger.warn(
        { agentId: agent.identity.id },
        `heartbeat fail count reached ${this.#options.degradedFailThreshold} — marking degraded`
      );
      this.#options.registry.notifyStateChanged(
        agent.identity.id,
        'degraded'
      );
    }
    if (state.consecutiveFailures === this.#options.offlineFailThreshold) {
      this.#logger.warn(
        { agentId: agent.identity.id },
        `heartbeat fail count reached ${this.#options.offlineFailThreshold} — marking offline`
      );
      this.#options.registry.notifyStateChanged(
        agent.identity.id,
        'offline'
      );
    }
  }

  #dispatchCommands(
    agent: AIAgent,
    response: AgentHeartbeatResponse
  ): void {
    for (const cmd of response.commands) {
      // Phase 1.4 scope: log only. Actual pause/resume/shutdown/
      // update-config dispatch into the agent is future work —
      // it needs router integration and the command-executor
      // gating that SPEC § 27 describes. Recording here means
      // the server side of TD-024 can land independently.
      this.#logger.info(
        { agentId: agent.identity.id, commandType: cmd.type },
        'received heartbeat command (unhandled in phase 1.4)'
      );
    }
    for (const taskId of response.pendingTaskIds) {
      this.#logger.info(
        { agentId: agent.identity.id, taskId },
        'heartbeat surfaced pending task id (router wiring pending)'
      );
    }
  }
}
