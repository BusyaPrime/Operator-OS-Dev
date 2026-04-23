import { z } from 'zod';

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

// ---------------------------------------------------------------------
// Zod schemas (additive, Phase 2 / TD-022)
//
// Wire-level validation for the api's `/v1/cost/*` endpoints.
// Every schema mirrors the TypeScript interface above 1:1; the
// __tests__/cost-provider.test.ts sibling asserts that
// `z.infer<schema>` is assignable to the corresponding interface,
// so a drift in either direction fails at compile time.
//
// Exporting from `@operator-os/contracts` keeps the api + desktop-
// agent + (future) mobile on exactly one Zod representation —
// same rule as the auth-gateway schemas.
// ---------------------------------------------------------------------

/** Usage counts + cost paid for one task invocation. */
export const aiAgentUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative()
});

export const costPlanSchema = z.enum(['free', 'pro', 'enterprise', 'custom']);

export const spendingPeriodSchema = z.enum([
  'today',
  'this-week',
  'this-month',
  'all-time'
]);

export const costEstimateRequestSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  promptTokens: z.number().int().nonnegative(),
  expectedCompletionTokens: z.number().int().nonnegative()
});

export const costEstimateSchema = z.object({
  costUsd: z.number().nonnegative(),
  breakdown: z.object({
    promptCostUsd: z.number().nonnegative(),
    completionCostUsd: z.number().nonnegative(),
    otherCostUsd: z.number().nonnegative().optional()
  }),
  confidence: z.enum(['high', 'medium', 'low'])
});

export const costUsageRecordSchema = z.object({
  userId: z.string().min(1),
  taskId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  usage: aiAgentUsageSchema,
  timestamp: z.string().datetime()
});

export const budgetStatusSchema = z.object({
  userId: z.string().min(1),
  plan: costPlanSchema,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  spentUsd: z.number().nonnegative(),
  limitUsd: z.number().nonnegative(),
  remainingUsd: z.number(),
  isOverBudget: z.boolean(),
  warnAtPercent: z.number().min(0).max(100)
});

export const spendingReportSchema = z.object({
  userId: z.string().min(1),
  period: spendingPeriodSchema,
  totalUsd: z.number().nonnegative(),
  byProvider: z.record(z.string(), z.number().nonnegative()),
  byModel: z.record(z.string(), z.number().nonnegative()),
  taskCount: z.number().int().nonnegative(),
  avgCostPerTaskUsd: z.number().nonnegative()
});
