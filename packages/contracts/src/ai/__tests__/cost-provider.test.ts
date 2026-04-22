import { describe, expectTypeOf, it } from 'vitest';

import type { AIAgentUsage } from '../ai-agent.js';
import type {
  BudgetStatus,
  CostEstimate,
  CostEstimateRequest,
  CostPlan,
  CostProvider,
  CostUsageRecord,
  SpendingPeriod,
  SpendingReport
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
