import {
  type CostEstimate,
  type CostEstimateRequest,
  type CostPlan,
  type SpendingPeriod
} from '@operator-os/contracts';

/**
 * Flat pricing row. All amounts are USD per 1M tokens. Entries
 * sourced from public pricing pages (Anthropic, Google Vertex,
 * OpenAI) as of 2026-04 — the commit that updates this table
 * carries the source-of-truth URL in its message so future drift
 * is traceable.
 *
 * Unknown (providerId, model) pairs degrade to zero cost +
 * confidence 'low'; callers treat that as "route anyway but
 * flag telemetry".
 */
export interface PricingRow {
  readonly providerId: string;
  readonly model: string;
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
}

/**
 * Pricing table. Lives in code (not Firestore) so that a price
 * change is a deploy — which is what the ADR calls for. Keeps
 * the hot path off a DB read per estimate.
 */
export const PRICING_TABLE: readonly PricingRow[] = [
  // Anthropic — used by ClaudeCodeAgent
  {
    providerId: 'anthropic.claude-code',
    model: 'claude-sonnet-4',
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15
  },
  {
    providerId: 'anthropic.claude-code',
    model: 'claude-sonnet-4-5',
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15
  },
  {
    providerId: 'anthropic.claude-code',
    model: 'claude-opus-4',
    inputPerMillionUsd: 15,
    outputPerMillionUsd: 75
  },
  {
    providerId: 'anthropic.claude-code',
    model: 'claude-opus-4-7',
    inputPerMillionUsd: 15,
    outputPerMillionUsd: 75
  },
  {
    providerId: 'anthropic.claude-code',
    model: 'claude-haiku-4-5',
    inputPerMillionUsd: 0.8,
    outputPerMillionUsd: 4
  },

  // Google Vertex AI — used by VertexAIProvider
  {
    providerId: 'google.vertex',
    model: 'gemini-2.5-flash',
    inputPerMillionUsd: 0.075,
    outputPerMillionUsd: 0.3
  },
  {
    providerId: 'google.vertex',
    model: 'gemini-2.5-pro',
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 5
  },

  // OpenAI — rows carried for forward-compat; no integration yet.
  {
    providerId: 'openai.chat',
    model: 'gpt-4.1',
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10
  },
  {
    providerId: 'openai.chat',
    model: 'gpt-5',
    // Placeholder — update when OpenAI publishes gpt-5 pricing.
    inputPerMillionUsd: 10,
    outputPerMillionUsd: 30
  }
] as const;

/** Default monthly limit + warn threshold per plan tier. */
export interface PlanBudget {
  readonly plan: CostPlan;
  readonly monthlyLimitUsd: number;
  readonly warnAtPercent: number;
}

export const PLAN_BUDGETS: Readonly<Record<CostPlan, PlanBudget>> = {
  free: { plan: 'free', monthlyLimitUsd: 1, warnAtPercent: 80 },
  pro: { plan: 'pro', monthlyLimitUsd: 50, warnAtPercent: 80 },
  enterprise: { plan: 'enterprise', monthlyLimitUsd: 5000, warnAtPercent: 90 },
  // `custom` is the marker for "enterprise user with a
  // user_budgets override"; real monthlyLimitUsd comes from
  // the Firestore doc at read time.
  custom: { plan: 'custom', monthlyLimitUsd: 0, warnAtPercent: 80 }
} as const;

/**
 * Pure cost service. No I/O. Route handlers wire it to the
 * Firestore repository; tests exercise it directly.
 */
export class CostService {
  /**
   * Estimate cost for a planned invocation. Unknown pricing →
   * zero cost + `confidence: 'low'`. Known pricing → `'high'`
   * (pricing table is deterministic; the only "uncertainty" is
   * the caller's expected-completion-tokens guess, which we
   * surface as `medium` when the multiplier is meaningfully
   * large — kept `'high'` as a simplification for now).
   */
  estimateCost(request: CostEstimateRequest): CostEstimate {
    const row = findPricing(request.providerId, request.model);
    if (row === undefined) {
      return {
        costUsd: 0,
        breakdown: {
          promptCostUsd: 0,
          completionCostUsd: 0
        },
        confidence: 'low'
      };
    }

    const promptCostUsd = round6(
      (request.promptTokens / 1_000_000) * row.inputPerMillionUsd
    );
    const completionCostUsd = round6(
      (request.expectedCompletionTokens / 1_000_000) *
        row.outputPerMillionUsd
    );

    return {
      costUsd: round6(promptCostUsd + completionCostUsd),
      breakdown: {
        promptCostUsd,
        completionCostUsd
      },
      confidence: 'high'
    };
  }

  /**
   * Compute the real cost of an actual usage record (distinct
   * from estimateCost — this one is deterministic since we
   * know the exact completion tokens). Used by POST
   * /v1/cost/record to sanity-check the cost value the agent
   * submitted; if the agent-reported cost is within 1 cent of
   * our recompute it's accepted as-is, otherwise the server
   * overrides with its own number. That's how we prevent a
   * misconfigured agent from inflating spend.
   */
  computeActualCost(
    providerId: string,
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    const row = findPricing(providerId, model);
    if (row === undefined) return 0;
    return round6(
      (promptTokens / 1_000_000) * row.inputPerMillionUsd +
        (completionTokens / 1_000_000) * row.outputPerMillionUsd
    );
  }

  /**
   * UTC-anchored period boundaries so timezone behaviour is
   * consistent regardless of where the api is running. Every
   * boundary is an inclusive start, exclusive end.
   */
  periodRange(now: Date, period: SpendingPeriod): { start: Date; end: Date } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    switch (period) {
      case 'today': {
        const start = new Date(Date.UTC(y, m, d));
        const end = new Date(Date.UTC(y, m, d + 1));
        return { start, end };
      }
      case 'this-week': {
        // Week starts Monday in UTC. now.getUTCDay(): Sun=0..Sat=6.
        // Distance back to Monday: (day + 6) % 7.
        const day = now.getUTCDay();
        const back = (day + 6) % 7;
        const start = new Date(Date.UTC(y, m, d - back));
        const end = new Date(Date.UTC(y, m, d - back + 7));
        return { start, end };
      }
      case 'this-month': {
        const start = new Date(Date.UTC(y, m, 1));
        const end = new Date(Date.UTC(y, m + 1, 1));
        return { start, end };
      }
      case 'all-time': {
        // Unix epoch → far future. `periodStart` is well-defined
        // but essentially informational for the UI.
        const start = new Date(0);
        const end = new Date(Date.UTC(9999, 0, 1));
        return { start, end };
      }
    }
  }

  /**
   * Default monthly limit for a plan. `custom` plan callers
   * should read their real limit from the user_budgets doc
   * BEFORE asking this method; this returns 0 for `custom` as
   * a deliberate "no default — please override".
   */
  defaultBudgetForPlan(plan: CostPlan): PlanBudget {
    return PLAN_BUDGETS[plan];
  }
}

const findPricing = (
  providerId: string,
  model: string
): PricingRow | undefined =>
  PRICING_TABLE.find(
    (row) => row.providerId === providerId && row.model === model
  );

/** Round to 6 decimal places — avoids 1e-18 float noise in responses. */
const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;
