import type { FastifyBaseLogger } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentAuthEvent } from '../../agent-token-guard.js';
import {
  BigQueryAuditWriter,
  type AuditTable
} from '../bigquery-audit-writer.js';

const FIXED_NOW = new Date('2026-04-28T12:00:00.000Z');
const FIXED_TS = FIXED_NOW.toISOString();

const buildLogger = (): {
  logger: FastifyBaseLogger;
  warn: ReturnType<typeof vi.fn>;
} => {
  const warn = vi.fn();
  const stub: Record<string, unknown> = {
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'info',
    child(): unknown {
      return stub;
    }
  };
  return {
    logger: stub as unknown as FastifyBaseLogger,
    warn
  };
};

const buildEvent = (
  overrides: Partial<AgentAuthEvent> = {}
): AgentAuthEvent => ({
  agentId: 'agent-1',
  userId: 'user-akmal',
  eventType: 'auth_success',
  latencyMs: 12,
  ip: '1.2.3.4',
  userAgent: 'OperatorAgent/1.0',
  errorCode: undefined,
  ...overrides
});

const buildWriter = (
  insertImpl: AuditTable['insert'],
  opts: { timeoutMs?: number } = {}
): {
  writer: BigQueryAuditWriter;
  insertSpy: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} => {
  const insertSpy = vi.fn(insertImpl);
  const { logger, warn } = buildLogger();
  const writer = new BigQueryAuditWriter({
    table: { insert: insertSpy },
    logger,
    timeoutMs: opts.timeoutMs,
    now: () => FIXED_NOW
  });
  return { writer, insertSpy, warn };
};

describe('BigQueryAuditWriter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('inserts a single row with every AgentAuthEvent field mapped to its BQ column', async () => {
    const { writer, insertSpy, warn } = buildWriter(async () => [{}]);

    await writer.record(
      buildEvent({
        agentId: 'agent-uuid-A',
        userId: 'user-akmal',
        eventType: 'auth_success',
        latencyMs: 17,
        ip: '203.0.113.42',
        userAgent: 'OperatorAgent/1.0 (win32)',
        errorCode: undefined
      })
    );

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledWith([
      {
        timestamp: FIXED_TS,
        agent_id: 'agent-uuid-A',
        user_id: 'user-akmal',
        event_type: 'auth_success',
        ip: '203.0.113.42',
        user_agent: 'OperatorAgent/1.0 (win32)',
        success: true,
        latency_ms: 17,
        error_code: null,
        metadata: null
      }
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('derives success=false for every auth_failed_* eventType', async () => {
    const failureEventTypes: AgentAuthEvent['eventType'][] = [
      'auth_failed_no_token',
      'auth_failed_no_match',
      'auth_failed_revoked',
      'auth_failed_unknown_token'
    ];

    for (const eventType of failureEventTypes) {
      const { writer, insertSpy } = buildWriter(async () => [{}]);
      await writer.record(buildEvent({ eventType, agentId: null, userId: null }));
      expect(insertSpy).toHaveBeenCalledWith([
        expect.objectContaining({ event_type: eventType, success: false })
      ]);
    }
  });

  it('derives success=true for success and lifecycle eventTypes', async () => {
    const successEventTypes: AgentAuthEvent['eventType'][] = [
      'auth_success',
      'auth_success_previous_hash',
      'agent_registered',
      'token_rotated',
      'agent_revoked'
    ];

    for (const eventType of successEventTypes) {
      const { writer, insertSpy } = buildWriter(async () => [{}]);
      await writer.record(buildEvent({ eventType }));
      expect(insertSpy).toHaveBeenCalledWith([
        expect.objectContaining({ event_type: eventType, success: true })
      ]);
    }
  });

  it('passes null through for absent agentId / userId / ip / userAgent / errorCode', async () => {
    const { writer, insertSpy } = buildWriter(async () => [{}]);

    await writer.record({
      agentId: null,
      userId: null,
      eventType: 'auth_failed_no_token',
      latencyMs: 4
    });

    expect(insertSpy).toHaveBeenCalledWith([
      {
        timestamp: FIXED_TS,
        agent_id: null,
        user_id: null,
        event_type: 'auth_failed_no_token',
        ip: null,
        user_agent: null,
        success: false,
        latency_ms: 4,
        error_code: null,
        metadata: null
      }
    ]);
  });

  it('swallows synchronous insert errors and emits a single pino warn', async () => {
    const boom = new Error('BigQuery PartialFailureError: streaming quota exceeded');
    const { writer, insertSpy, warn } = buildWriter(async () => {
      throw boom;
    });

    await expect(writer.record(buildEvent())).resolves.toBeUndefined();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: boom,
        eventType: 'auth_success',
        agentId: 'agent-1'
      }),
      expect.stringContaining('failed')
    );
  });

  it('resolves within the timeout window when the insert hangs, emitting a timeout warn', async () => {
    vi.useFakeTimers();
    // Insert that never resolves — simulates BQ at the network
    // level being unreachable / extremely slow.
    const { writer, insertSpy, warn } = buildWriter(
      () => new Promise<unknown>(() => undefined),
      { timeoutMs: 50 }
    );

    const recordPromise = writer.record(buildEvent());
    // Advance past the configured timeout.
    await vi.advanceTimersByTimeAsync(75);
    await expect(recordPromise).resolves.toBeUndefined();

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'auth_success',
        agentId: 'agent-1',
        timeoutMs: 50
      }),
      expect.stringContaining('timed out')
    );
  });

  it('does not emit a timeout warn when the insert resolves before the timeout fires', async () => {
    vi.useFakeTimers();
    const { writer, warn } = buildWriter(async () => [{}], { timeoutMs: 50 });

    const recordPromise = writer.record(buildEvent());
    // Advance further than the timeout — but the insert
    // resolved synchronously (microtask), so timeout warn must
    // not fire.
    await vi.advanceTimersByTimeAsync(75);
    await recordPromise;

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not surface a late-arriving insert rejection as an unhandled rejection', async () => {
    vi.useFakeTimers();
    let rejectInsert!: (err: unknown) => void;
    const { writer, warn } = buildWriter(
      () =>
        new Promise<unknown>((_, reject) => {
          rejectInsert = reject;
        }),
      { timeoutMs: 50 }
    );

    const recordPromise = writer.record(buildEvent());
    await vi.advanceTimersByTimeAsync(75);
    await recordPromise; // resolves via timeout

    // Simulate the insert failing AFTER record() already returned.
    // The eagerly-attached .catch() inside the writer swallows it.
    rejectInsert(new Error('late BQ failure'));
    await Promise.resolve();
    await Promise.resolve();

    // Two warns expected: one timeout (during await), one late-failure.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 50 }),
      expect.stringContaining('timed out')
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('failed')
    );
  });

  it('uses the default 50 ms timeout when none is configured', async () => {
    vi.useFakeTimers();
    const { writer, warn } = buildWriter(
      () => new Promise<unknown>(() => undefined)
    );

    const recordPromise = writer.record(buildEvent());
    await vi.advanceTimersByTimeAsync(60);
    await recordPromise;

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 50 }),
      expect.stringContaining('timed out')
    );
  });
});
