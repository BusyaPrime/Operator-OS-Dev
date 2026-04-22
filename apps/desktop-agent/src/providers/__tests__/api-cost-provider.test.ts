import {
  AIAgentError,
  type CostEstimateRequest,
  type CostUsageRecord
} from '@operator-os/contracts';
import pino from 'pino';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiCostProvider } from '../api-cost-provider.js';

/**
 * Collect log-level invocations into an in-memory recorder so
 * tests can assert what the stub said without spamming stdout
 * or coupling to pino internals.
 */
interface LoggerRecorder {
  logger: Logger;
  warns: Array<{ obj: unknown; msg: string }>;
  infos: Array<{ obj: unknown; msg: string }>;
  debugs: Array<{ obj: unknown; msg: string }>;
}

const buildRecorder = (): LoggerRecorder => {
  const warns: LoggerRecorder['warns'] = [];
  const infos: LoggerRecorder['infos'] = [];
  const debugs: LoggerRecorder['debugs'] = [];
  const base = pino({ level: 'silent' });
  const logger = {
    ...base,
    child: () => logger,
    warn: vi.fn((obj: unknown, msg?: string) => {
      warns.push({ obj, msg: msg ?? '' });
    }),
    info: vi.fn((obj: unknown, msg?: string) => {
      infos.push({ obj, msg: msg ?? '' });
    }),
    debug: vi.fn((obj: unknown, msg?: string) => {
      debugs.push({ obj, msg: msg ?? '' });
    })
  } as unknown as Logger;
  return { logger, warns, infos, debugs };
};

describe('ApiCostProvider (TD-022 stub)', () => {
  let rec: LoggerRecorder;

  beforeEach(() => {
    rec = buildRecorder();
  });

  describe('estimateCost', () => {
    const baseRequest: CostEstimateRequest = {
      providerId: 'anthropic.claude-code',
      model: 'claude-sonnet-4-5',
      promptTokens: 100,
      expectedCompletionTokens: 500
    };

    it('returns a zero-cost low-confidence stub estimate', async () => {
      const provider = new ApiCostProvider(rec.logger);
      const result = await provider.estimateCost(baseRequest);
      expect(result.costUsd).toBe(0);
      expect(result.confidence).toBe('low');
      expect(result.breakdown.promptCostUsd).toBe(0);
      expect(result.breakdown.completionCostUsd).toBe(0);
    });

    it('logs a warn per call so the telemetry gap is visible', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await provider.estimateCost(baseRequest);
      expect(rec.warns).toHaveLength(1);
      expect(rec.warns[0].msg).toMatch(/TD-022/);
    });
  });

  describe('recordUsage', () => {
    const baseRecord: CostUsageRecord = {
      userId: 'user-1',
      taskId: 'task-abc',
      providerId: 'anthropic.claude-code',
      model: 'claude-sonnet-4-5',
      usage: {
        promptTokens: 120,
        completionTokens: 340,
        totalTokens: 460,
        costUsd: 0.0123
      },
      timestamp: '2026-04-24T00:00:00.000Z'
    };

    it('logs an info line with the full usage detail', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await provider.recordUsage(baseRecord);
      expect(rec.infos).toHaveLength(1);
      const logged = rec.infos[0].obj as Record<string, unknown>;
      expect(logged.taskId).toBe('task-abc');
      expect(logged.providerId).toBe('anthropic.claude-code');
      expect(logged.costUsd).toBe(0.0123);
    });

    it('logs a warn that the record is not persisted', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await provider.recordUsage(baseRecord);
      expect(rec.warns).toHaveLength(1);
      expect(rec.warns[0].msg).toMatch(/not yet persisted/);
      expect(rec.warns[0].msg).toMatch(/TD-022/);
    });

    it('resolves void (no return value)', async () => {
      const provider = new ApiCostProvider(rec.logger);
      const result = await provider.recordUsage(baseRecord);
      expect(result).toBeUndefined();
    });
  });

  describe('checkBudget', () => {
    it('returns an infinite-budget stub with MAX_SAFE_INTEGER limit', async () => {
      const provider = new ApiCostProvider(rec.logger);
      const status = await provider.checkBudget('user-abc');
      expect(status.userId).toBe('user-abc');
      expect(status.limitUsd).toBe(Number.MAX_SAFE_INTEGER);
      expect(status.remainingUsd).toBe(Number.MAX_SAFE_INTEGER);
      expect(status.spentUsd).toBe(0);
      expect(status.isOverBudget).toBe(false);
      expect(status.warnAtPercent).toBe(80);
      expect(status.plan).toBe('custom');
    });

    it('anchors the period to the current calendar month', async () => {
      const provider = new ApiCostProvider(rec.logger);
      const status = await provider.checkBudget('user-abc');
      const start = new Date(status.periodStart);
      const end = new Date(status.periodEnd);
      expect(start.getUTCDate()).toBe(1);
      expect(end.getUTCDate()).toBe(1);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    });

    it('does not log a warn on every call (UI polls this)', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await provider.checkBudget('user-abc');
      expect(rec.warns).toHaveLength(0);
    });
  });

  describe('enforceBudget', () => {
    it('always passes (no-op during the stub window)', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await expect(
        provider.enforceBudget('user-1', 9999.99)
      ).resolves.toBeUndefined();
    });

    it('logs at debug so noise stays low', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await provider.enforceBudget('user-1', 0.5);
      expect(rec.debugs.length).toBe(1);
      expect(rec.debugs[0].obj).toMatchObject({
        userId: 'user-1',
        estimatedCostUsd: 0.5
      });
    });
  });

  describe('getUserSpending', () => {
    it('throws AIAgentError with code COST_ENDPOINT_UNAVAILABLE', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await expect(
        provider.getUserSpending('user-1', 'this-month')
      ).rejects.toThrow(AIAgentError);
    });

    it('error carries retriable=false and the blocking TD', async () => {
      const provider = new ApiCostProvider(rec.logger);
      let caught: AIAgentError | undefined;
      try {
        await provider.getUserSpending('user-1', 'this-month');
      } catch (err) {
        caught = err as AIAgentError;
      }
      expect(caught).toBeInstanceOf(AIAgentError);
      expect(caught!.code).toBe('COST_ENDPOINT_UNAVAILABLE');
      expect(caught!.retriable).toBe(false);
      expect(caught!.details).toMatchObject({
        userId: 'user-1',
        period: 'this-month',
        blockingTd: 'TD-022'
      });
    });

    it('error message includes both userId and period', async () => {
      const provider = new ApiCostProvider(rec.logger);
      await expect(
        provider.getUserSpending('user-xyz', 'today')
      ).rejects.toThrow(/user-xyz/);
      await expect(
        provider.getUserSpending('user-xyz', 'today')
      ).rejects.toThrow(/today/);
    });
  });
});
