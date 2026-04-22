import {
  AIAgentError,
  type BudgetStatus,
  type CostEstimate,
  type CostEstimateRequest,
  type CostProvider,
  type CostUsageRecord,
  type SpendingPeriod,
  type SpendingReport
} from '@operator-os/contracts';

import type { Logger } from 'pino';

/**
 * CostProvider implementation that (will) delegate to api
 * `/v1/cost/*` endpoints.
 *
 * Phase 1.4 reality: those api endpoints do NOT exist yet
 * (TD-022 tracks the api-side work; Week 3 batch). This
 * provider therefore returns stubs that let the agent operate
 * without crashing — real cost tracking shows up once TD-022
 * lands.
 *
 * Stub behaviour (per 2026-04-24 Decision 1):
 * - estimateCost → returns low-confidence stub, log.warn
 * - recordUsage → log.info only (no network), log.warn that
 *   the record is not persisted yet
 * - checkBudget → returns "infinite budget" stub (spent 0,
 *   limit Number.MAX_SAFE_INTEGER, isOverBudget false)
 * - enforceBudget → no-op (always passes)
 * - getUserSpending → throws AIAgentError
 *   `COST_ENDPOINT_UNAVAILABLE`
 *
 * When the api grows the endpoints, the stub branches are
 * swapped for real HTTP calls; the interface stays identical,
 * so no agent-side change is needed.
 */
export class ApiCostProvider implements CostProvider {
  #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger.child({ component: 'api-cost-provider' });
  }

  async estimateCost(request: CostEstimateRequest): Promise<CostEstimate> {
    this.#logger.warn(
      { providerId: request.providerId, model: request.model },
      'cost estimation not available yet (TD-022); returning low-confidence stub'
    );
    return {
      costUsd: 0,
      breakdown: {
        promptCostUsd: 0,
        completionCostUsd: 0
      },
      confidence: 'low'
    };
  }

  async recordUsage(usage: CostUsageRecord): Promise<void> {
    this.#logger.info(
      {
        taskId: usage.taskId,
        providerId: usage.providerId,
        model: usage.model,
        promptTokens: usage.usage.promptTokens,
        completionTokens: usage.usage.completionTokens,
        costUsd: usage.usage.costUsd
      },
      'cost-usage-record (local only)'
    );
    this.#logger.warn(
      { taskId: usage.taskId },
      'cost recording not yet persisted to api (TD-022); local log only'
    );
  }

  async checkBudget(userId: string): Promise<BudgetStatus> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return {
      userId,
      plan: 'custom',
      periodStart: monthStart.toISOString(),
      periodEnd: nextMonth.toISOString(),
      spentUsd: 0,
      limitUsd: Number.MAX_SAFE_INTEGER,
      remainingUsd: Number.MAX_SAFE_INTEGER,
      isOverBudget: false,
      warnAtPercent: 80
    };
  }

  async enforceBudget(userId: string, estimatedCostUsd: number): Promise<void> {
    // No-op until TD-022 lands api endpoints with real budget
    // state. Logged at debug so noise stays low.
    this.#logger.debug(
      { userId, estimatedCostUsd },
      'enforceBudget stub passthrough (TD-022 pending)'
    );
  }

  async getUserSpending(
    userId: string,
    period: SpendingPeriod
  ): Promise<SpendingReport> {
    // Intentionally NOT returning a stub — unlike estimate /
    // record / budget which are on the agent hot path,
    // spending reports are always a UI-facing read. Returning
    // a zeroed stub would misrepresent the user's spend; an
    // explicit error surfaces "feature not ready" cleanly.
    throw new AIAgentError(
      'COST_ENDPOINT_UNAVAILABLE',
      `getUserSpending(${userId}, ${period}) blocked on TD-022 (api /v1/cost/spending endpoint not implemented yet)`,
      {
        retriable: false,
        details: { userId, period, blockingTd: 'TD-022' }
      }
    );
  }
}
