import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { AIAgentUsage } from '../ai-agent.js';
import {
  aiAgentUsageSchema,
  budgetStatusSchema,
  costEstimateRequestSchema,
  costEstimateSchema,
  costPlanSchema,
  costUsageRecordSchema,
  spendingPeriodSchema,
  spendingReportSchema,
  type BudgetStatus,
  type CostEstimate,
  type CostEstimateRequest,
  type CostPlan,
  type CostProvider,
  type CostUsageRecord,
  type SpendingPeriod,
  type SpendingReport
} from '../cost-provider.js';

describe('Cost enums', () => {
  it('CostPlan is 4-variant union', () => {
    expectTypeOf<CostPlan>().toEqualTypeOf<
      'free' | 'pro' | 'enterprise' | 'custom'
    >();
  });

  it('SpendingPeriod is 4-variant union', () => {
    expectTypeOf<SpendingPeriod>().toEqualTypeOf<
      'today' | 'this-week' | 'this-month' | 'all-time'
    >();
  });
});

describe('CostEstimateRequest + CostEstimate', () => {
  it('request carries providerId, model, prompt + expected completion tokens', () => {
    expectTypeOf<CostEstimateRequest['providerId']>().toEqualTypeOf<string>();
    expectTypeOf<CostEstimateRequest['model']>().toEqualTypeOf<string>();
    expectTypeOf<CostEstimateRequest['promptTokens']>().toEqualTypeOf<number>();
    expectTypeOf<
      CostEstimateRequest['expectedCompletionTokens']
    >().toEqualTypeOf<number>();
  });

  it('estimate carries costUsd + breakdown + confidence', () => {
    expectTypeOf<CostEstimate['costUsd']>().toEqualTypeOf<number>();
    expectTypeOf<CostEstimate['confidence']>().toEqualTypeOf<
      'high' | 'medium' | 'low'
    >();
    expectTypeOf<CostEstimate['breakdown']['promptCostUsd']>().toEqualTypeOf<number>();
    expectTypeOf<CostEstimate['breakdown']['completionCostUsd']>().toEqualTypeOf<number>();
    expectTypeOf<CostEstimate['breakdown']['otherCostUsd']>().toEqualTypeOf<
      number | undefined
    >();
  });
});

describe('CostUsageRecord', () => {
  it('embeds AIAgentUsage in usage field', () => {
    expectTypeOf<CostUsageRecord['usage']>().toEqualTypeOf<AIAgentUsage>();
  });

  it('requires userId, taskId, providerId, model, timestamp', () => {
    expectTypeOf<CostUsageRecord['userId']>().toEqualTypeOf<string>();
    expectTypeOf<CostUsageRecord['taskId']>().toEqualTypeOf<string>();
    expectTypeOf<CostUsageRecord['providerId']>().toEqualTypeOf<string>();
    expectTypeOf<CostUsageRecord['model']>().toEqualTypeOf<string>();
    expectTypeOf<CostUsageRecord['timestamp']>().toEqualTypeOf<string>();
  });
});

describe('BudgetStatus', () => {
  it('carries plan, period bounds, spent/limit/remaining, isOverBudget, warnAt', () => {
    expectTypeOf<BudgetStatus['plan']>().toEqualTypeOf<CostPlan>();
    expectTypeOf<BudgetStatus['periodStart']>().toEqualTypeOf<string>();
    expectTypeOf<BudgetStatus['periodEnd']>().toEqualTypeOf<string>();
    expectTypeOf<BudgetStatus['spentUsd']>().toEqualTypeOf<number>();
    expectTypeOf<BudgetStatus['limitUsd']>().toEqualTypeOf<number>();
    expectTypeOf<BudgetStatus['remainingUsd']>().toEqualTypeOf<number>();
    expectTypeOf<BudgetStatus['isOverBudget']>().toEqualTypeOf<boolean>();
    expectTypeOf<BudgetStatus['warnAtPercent']>().toEqualTypeOf<number>();
  });
});

describe('SpendingReport', () => {
  it('carries byProvider + byModel as Record<string, number>', () => {
    expectTypeOf<SpendingReport['byProvider']>().toEqualTypeOf<
      Record<string, number>
    >();
    expectTypeOf<SpendingReport['byModel']>().toEqualTypeOf<
      Record<string, number>
    >();
  });

  it('bundles totalUsd, taskCount, avgCostPerTaskUsd', () => {
    expectTypeOf<SpendingReport['totalUsd']>().toEqualTypeOf<number>();
    expectTypeOf<SpendingReport['taskCount']>().toEqualTypeOf<number>();
    expectTypeOf<SpendingReport['avgCostPerTaskUsd']>().toEqualTypeOf<number>();
  });
});

describe('CostProvider interface', () => {
  it('estimateCost takes request, returns Promise<CostEstimate>', () => {
    type Arg = Parameters<CostProvider['estimateCost']>[0];
    expectTypeOf<Arg>().toEqualTypeOf<CostEstimateRequest>();
    type Ret = ReturnType<CostProvider['estimateCost']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<CostEstimate>>();
  });

  it('recordUsage is Promise<void>, idempotent by convention', () => {
    type Ret = ReturnType<CostProvider['recordUsage']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<void>>();
  });

  it('checkBudget + enforceBudget async', () => {
    type CheckRet = ReturnType<CostProvider['checkBudget']>;
    expectTypeOf<CheckRet>().toEqualTypeOf<Promise<BudgetStatus>>();
    type EnforceRet = ReturnType<CostProvider['enforceBudget']>;
    expectTypeOf<EnforceRet>().toEqualTypeOf<Promise<void>>();
  });

  it('getUserSpending takes period, returns Promise<SpendingReport>', () => {
    type PeriodArg = Parameters<CostProvider['getUserSpending']>[1];
    expectTypeOf<PeriodArg>().toEqualTypeOf<SpendingPeriod>();
    type Ret = ReturnType<CostProvider['getUserSpending']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<SpendingReport>>();
  });
});

describe('Cost Zod schemas (Phase 2 / TD-022 — no drift vs interfaces)', () => {
  // Schema → interface drift guards. If a field is added to the
  // interface without a matching schema field (or vice versa), the
  // `satisfies` style assertions below fail at compile time.

  it('aiAgentUsageSchema validates the AIAgentUsage shape', () => {
    type Inferred = z.infer<typeof aiAgentUsageSchema>;
    expectTypeOf<Inferred>().toExtend<AIAgentUsage>();
    expectTypeOf<AIAgentUsage>().toExtend<Inferred>();

    expect(
      aiAgentUsageSchema.parse({
        promptTokens: 100,
        completionTokens: 25,
        totalTokens: 125,
        costUsd: 0.0042
      })
    ).toMatchObject({ costUsd: 0.0042 });
  });

  it('costPlanSchema matches the CostPlan enum', () => {
    type Inferred = z.infer<typeof costPlanSchema>;
    expectTypeOf<Inferred>().toEqualTypeOf<CostPlan>();
  });

  it('spendingPeriodSchema matches the SpendingPeriod enum', () => {
    type Inferred = z.infer<typeof spendingPeriodSchema>;
    expectTypeOf<Inferred>().toEqualTypeOf<SpendingPeriod>();
  });

  it('costEstimateRequestSchema matches CostEstimateRequest', () => {
    type Inferred = z.infer<typeof costEstimateRequestSchema>;
    expectTypeOf<Inferred>().toExtend<CostEstimateRequest>();
    expectTypeOf<CostEstimateRequest>().toExtend<Inferred>();
  });

  it('costEstimateSchema matches CostEstimate', () => {
    type Inferred = z.infer<typeof costEstimateSchema>;
    expectTypeOf<Inferred>().toExtend<CostEstimate>();
    expectTypeOf<CostEstimate>().toExtend<Inferred>();
  });

  it('costUsageRecordSchema matches CostUsageRecord', () => {
    type Inferred = z.infer<typeof costUsageRecordSchema>;
    expectTypeOf<Inferred>().toExtend<CostUsageRecord>();
    expectTypeOf<CostUsageRecord>().toExtend<Inferred>();
  });

  it('budgetStatusSchema matches BudgetStatus', () => {
    type Inferred = z.infer<typeof budgetStatusSchema>;
    expectTypeOf<Inferred>().toExtend<BudgetStatus>();
    expectTypeOf<BudgetStatus>().toExtend<Inferred>();
  });

  it('spendingReportSchema matches SpendingReport', () => {
    type Inferred = z.infer<typeof spendingReportSchema>;
    expectTypeOf<Inferred>().toExtend<SpendingReport>();
    expectTypeOf<SpendingReport>().toExtend<Inferred>();
  });

  it('costEstimateRequestSchema rejects negative token counts', () => {
    expect(() =>
      costEstimateRequestSchema.parse({
        providerId: 'anthropic',
        model: 'claude-sonnet-4',
        promptTokens: -1,
        expectedCompletionTokens: 100
      })
    ).toThrow();
  });

  it('costUsageRecordSchema requires an ISO8601 timestamp', () => {
    expect(() =>
      costUsageRecordSchema.parse({
        userId: 'user-1',
        taskId: 'task-1',
        providerId: 'anthropic',
        model: 'claude-sonnet-4',
        usage: {
          promptTokens: 100,
          completionTokens: 25,
          totalTokens: 125,
          costUsd: 0.01
        },
        timestamp: '2026-04-24'
      })
    ).toThrow();
  });

  it('budgetStatusSchema caps warnAtPercent between 0 and 100', () => {
    expect(() =>
      budgetStatusSchema.parse({
        userId: 'u',
        plan: 'free',
        periodStart: '2026-04-01T00:00:00.000Z',
        periodEnd: '2026-05-01T00:00:00.000Z',
        spentUsd: 0,
        limitUsd: 1,
        remainingUsd: 1,
        isOverBudget: false,
        warnAtPercent: 150
      })
    ).toThrow();
  });
});
