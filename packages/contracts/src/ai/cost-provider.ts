import type { AIAgentUsage } from './ai-agent.js';

/** Input for a cost estimate before task execution. */
export interface CostEstimateRequest {
  readonly providerId: string;
  readonly model: string;
  readonly promptTokens: number;
  /** Caller's best guess — used to pick a pricing tier. */
  readonly expectedCompletionTokens: number;
}

/** Estimated cost for a planned task invocation. */
export interface CostEstimate {
  readonly costUsd: number;
  readonly breakdown: {
    readonly promptCostUsd: number;
    readonly completionCostUsd: number;
    /** Other fees, e.g. cache-miss surcharges. */
    readonly otherCostUsd?: number;
  };
  /** Subjective accuracy signal for the router. */
  readonly confidence: 'high' | 'medium' | 'low';
}

/** Record of actual token + cost usage after task completion. */
export interface CostUsageRecord {
  readonly userId: string;
  readonly taskId: string;
  readonly providerId: string;
  readonly model: string;
  readonly usage: AIAgentUsage;
  /** ISO8601 timestamp of the completed task. */
  readonly timestamp: string;
}

/** Plan tier that determines budget limits. */
export type CostPlan = 'free' | 'pro' | 'enterprise' | 'custom';

/** Budget status for a user over the current billing window. */
export interface BudgetStatus {
  readonly userId: string;
  readonly plan: CostPlan;
  /** ISO8601 timestamp the current window started. */
  readonly periodStart: string;
  /** ISO8601 timestamp the current window ends. */
  readonly periodEnd: string;
  readonly spentUsd: number;
  readonly limitUsd: number;
  readonly remainingUsd: number;
  readonly isOverBudget: boolean;
  /** Threshold (0-100) at which caller should warn the user. */
  readonly warnAtPercent: number;
}

/** Reporting windows supported by getUserSpending. */
export type SpendingPeriod =
  | 'today'
  | 'this-week'
  | 'this-month'
  | 'all-time';

/** Aggregated spending for a user over a SpendingPeriod. */
export interface SpendingReport {
  readonly userId: string;
  readonly period: SpendingPeriod;
  readonly totalUsd: number;
  /** Total USD grouped by providerId. */
  readonly byProvider: Record<string, number>;
  /** Total USD grouped by model name. */
  readonly byModel: Record<string, number>;
  readonly taskCount: number;
  readonly avgCostPerTaskUsd: number;
}

/**
 * Provider-agnostic cost tracking + budget enforcement. Each
 * AIAgent owns its own CostProvider (AIAgent.cost), so agents
 * can ship with specialised pricing models:
 *
 * - Anthropic / OpenAI / Google agents each have their own
 *   per-vendor pricing tables and cache-discount rules.
 * - Cursor CLI uses a quota-based CostProvider that reports
 *   $0 per-task but surfaces remaining seat quota.
 * - Local models (Ollama, LM Studio) use a zero-cost provider
 *   that still records token counts for volume-tracking UIs.
 *
 * Callers (router, conductor, agent itself) use the same
 * interface regardless.
 */
export interface CostProvider {
  /** Estimate cost before executing a task. */
  estimateCost(request: CostEstimateRequest): Promise<CostEstimate>;
  /** Record actual usage after task completion. Idempotent per taskId. */
  recordUsage(usage: CostUsageRecord): Promise<void>;

  /** Return the user's current budget state. */
  checkBudget(userId: string): Promise<BudgetStatus>;
  /**
   * Throw BudgetExceededError if `estimatedCostUsd` would take
   * the user over their budget. Called before expensive tasks.
   */
  enforceBudget(userId: string, estimatedCostUsd: number): Promise<void>;

  /** Aggregate spending for a reporting period. */
  getUserSpending(userId: string, period: SpendingPeriod): Promise<SpendingReport>;
}
