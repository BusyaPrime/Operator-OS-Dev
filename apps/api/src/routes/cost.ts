import {
  budgetStatusSchema,
  costEstimateRequestSchema,
  costEstimateSchema,
  costUsageRecordSchema,
  spendingPeriodSchema,
  spendingReportSchema,
  type CostPlan,
  type SpendingPeriod
} from '@operator-os/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { CostService } from '../services/cost.js';

interface CostRoutesOptions {
  readonly costService: CostService;
  readonly repository: FirestoreOperatorRepository;
  /** Agent-issued requests (estimate / record). */
  readonly agentGuard: preHandlerAsyncHookHandler;
  /** User-issued requests (status / spending). */
  readonly userGuard: preHandlerAsyncHookHandler;
  /** Injectable clock for deterministic period math in tests. */
  readonly now?: () => Date;
}

export const registerCostRoutes = async (
  app: FastifyInstance,
  options: CostRoutesOptions
): Promise<void> => {
  const clock = options.now ?? (() => new Date());

  // POST /v1/cost/estimate — agent-issued pre-task guess.
  app.post(
    '/v1/cost/estimate',
    { preHandler: options.agentGuard },
    async (request, reply) => {
      const parsed = costEstimateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return badRequestBody(
          'costEstimateRequestSchema',
          parsed.error.issues
        );
      }
      const estimate = options.costService.estimateCost(parsed.data);
      return costEstimateSchema.parse(estimate);
    }
  );

  // POST /v1/cost/record — agent-issued post-task usage record.
  app.post(
    '/v1/cost/record',
    { preHandler: options.agentGuard },
    async (request, reply) => {
      const parsed = costUsageRecordSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return badRequestBody('costUsageRecordSchema', parsed.error.issues);
      }

      // The agent reports its own costUsd, which we recompute
      // server-side. If the agent's number is within $0.01 of
      // the server recompute we trust it; otherwise we override
      // with the server number. Prevents a misconfigured agent
      // from inflating spend, without rejecting benign float
      // drift.
      const recomputed = options.costService.computeActualCost(
        parsed.data.providerId,
        parsed.data.model,
        parsed.data.usage.promptTokens,
        parsed.data.usage.completionTokens
      );
      const reported = parsed.data.usage.costUsd;
      const accepted =
        Math.abs(reported - recomputed) <= 0.01 ? reported : recomputed;

      const sanitised = {
        ...parsed.data,
        usage: {
          ...parsed.data.usage,
          costUsd: accepted
        }
      };

      const receipt = await options.repository.recordCostUsage(sanitised);
      return { success: true, recordId: receipt.resourceId };
    }
  );

  // GET /v1/cost/status/:userId — budget snapshot.
  app.get<{ Params: { userId: string } }>(
    '/v1/cost/status/:userId',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const requestedUserId = request.params.userId;
      const sessionUserId = request.authSession?.currentUser?.operatorId;
      if (!sessionUserId || sessionUserId !== requestedUserId) {
        reply.status(403);
        return {
          error: 'Forbidden',
          message: 'userId in path must match the authenticated session.'
        };
      }

      const now = clock();
      const monthRange = options.costService.periodRange(now, 'this-month');
      const records = await options.repository.listCostRecordsForUser(
        requestedUserId,
        monthRange
      );
      const spentUsd = records.reduce(
        (acc, r) => acc + r.usage.costUsd,
        0
      );
      const { plan, limitUsd, warnAtPercent } = await resolveBudget(
        options,
        requestedUserId
      );
      const remainingUsd = Math.max(limitUsd - spentUsd, 0);
      const isOverBudget = spentUsd > limitUsd;

      return budgetStatusSchema.parse({
        userId: requestedUserId,
        plan,
        periodStart: monthRange.start.toISOString(),
        periodEnd: monthRange.end.toISOString(),
        spentUsd: round4(spentUsd),
        limitUsd,
        remainingUsd: round4(remainingUsd),
        isOverBudget,
        warnAtPercent
      });
    }
  );

  // GET /v1/cost/spending/:userId — aggregated report.
  app.get<{
    Params: { userId: string };
    Querystring: { period?: string };
  }>(
    '/v1/cost/spending/:userId',
    { preHandler: options.userGuard },
    async (request, reply) => {
      const requestedUserId = request.params.userId;
      const sessionUserId = request.authSession?.currentUser?.operatorId;
      if (!sessionUserId || sessionUserId !== requestedUserId) {
        reply.status(403);
        return {
          error: 'Forbidden',
          message: 'userId in path must match the authenticated session.'
        };
      }

      const rawPeriod = request.query.period ?? 'this-month';
      const periodParsed = spendingPeriodSchema.safeParse(rawPeriod);
      if (!periodParsed.success) {
        reply.status(400);
        return badRequestBody('spendingPeriodSchema', periodParsed.error.issues);
      }
      const period: SpendingPeriod = periodParsed.data;

      const now = clock();
      const range = options.costService.periodRange(now, period);
      const records = await options.repository.listCostRecordsForUser(
        requestedUserId,
        range
      );

      const byProvider: Record<string, number> = {};
      const byModel: Record<string, number> = {};
      let totalUsd = 0;
      for (const record of records) {
        totalUsd += record.usage.costUsd;
        byProvider[record.providerId] =
          (byProvider[record.providerId] ?? 0) + record.usage.costUsd;
        byModel[record.model] =
          (byModel[record.model] ?? 0) + record.usage.costUsd;
      }

      const taskCount = records.length;
      const avgCostPerTaskUsd = taskCount === 0 ? 0 : totalUsd / taskCount;

      return spendingReportSchema.parse({
        userId: requestedUserId,
        period,
        totalUsd: round4(totalUsd),
        byProvider: mapRound4(byProvider),
        byModel: mapRound4(byModel),
        taskCount,
        avgCostPerTaskUsd: round4(avgCostPerTaskUsd)
      });
    }
  );
};

const resolveBudget = async (
  options: CostRoutesOptions,
  userId: string
): Promise<{ plan: CostPlan; limitUsd: number; warnAtPercent: number }> => {
  const override = await options.repository.getUserBudget(userId);
  if (override !== undefined) {
    return {
      plan: override.plan,
      limitUsd: override.monthlyLimitUsd,
      warnAtPercent: override.warnAtPercent
    };
  }
  // No user-specific doc → free plan default. When auth carries a
  // plan claim (currently does; accessTokenPayloadSchema.plan)
  // a later revision will read it and pick a non-free default;
  // kept simple here so status / spending work even when the
  // JWT claim is absent in development fixtures.
  const free = options.costService.defaultBudgetForPlan('free');
  return {
    plan: free.plan,
    limitUsd: free.monthlyLimitUsd,
    warnAtPercent: free.warnAtPercent
  };
};

const badRequestBody = (schemaName: string, issues: unknown) => ({
  error: 'Bad Request',
  message: `${schemaName} validation failed`,
  issues
});

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

const mapRound4 = (obj: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = round4(v);
  return out;
};
