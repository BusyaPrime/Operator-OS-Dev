import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_TOKEN_REVOKED_EXIT_CODE,
  FatalAuthHandler
} from '../fatal-auth-handler.js';

describe('FatalAuthHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes exit code 87 as AGENT_TOKEN_REVOKED_EXIT_CODE', () => {
    expect(AGENT_TOKEN_REVOKED_EXIT_CODE).toBe(87);
  });

  it('calls exit(87) after the flush delay on the first onUnauthorized', () => {
    const exit = vi.fn();
    const logger = pino({ level: 'silent' });
    const handler = new FatalAuthHandler({
      logger,
      exit,
      flushDelayMs: 50
    });

    handler.onUnauthorized({
      source: 'rest',
      agentId: 'a1',
      url: 'http://api/v1/agent/heartbeat',
      method: 'POST',
      reason: 'rest_401'
    });
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(exit).toHaveBeenCalledExactlyOnceWith(87);
  });

  it('is idempotent — second onUnauthorized after firing is a no-op', () => {
    const exit = vi.fn();
    const handler = new FatalAuthHandler({
      logger: pino({ level: 'silent' }),
      exit,
      flushDelayMs: 10
    });

    handler.onUnauthorized({
      source: 'rest',
      reason: 'rest_401'
    });
    handler.onUnauthorized({
      source: 'ws',
      reason: 'ws_close_4001'
    });

    vi.advanceTimersByTime(50);
    expect(exit).toHaveBeenCalledExactlyOnceWith(87);
    expect(handler.hasFired).toBe(true);
  });

  it('records lastSuccessfulAuthAt and surfaces it via the fatal log', () => {
    const exit = vi.fn();
    const logSpy = vi.fn();
    // Build a logger whose `fatal` we can spy on.
    const fakeLogger = {
      fatal: logSpy,
      child: () => fakeLogger
    } as unknown as pino.Logger;

    const handler = new FatalAuthHandler({
      logger: fakeLogger,
      exit,
      flushDelayMs: 1
    });

    const successAt = new Date('2026-04-28T11:00:00Z');
    handler.recordSuccessfulAuth(successAt);
    handler.onUnauthorized({
      source: 'rest',
      agentId: 'agent-x',
      url: 'http://api/v1/agent/heartbeat',
      method: 'POST',
      reason: 'rest_401'
    });

    expect(logSpy).toHaveBeenCalledOnce();
    const [meta] = logSpy.mock.calls[0]!;
    expect(meta).toMatchObject({
      agentId: 'agent-x',
      reason: 'rest_401',
      authSource: 'rest',
      lastSuccessfulAuthAt: successAt.toISOString(),
      exitCode: AGENT_TOKEN_REVOKED_EXIT_CODE
    });
  });

  it('attachTo() wires into a TokenAuthSignals shape', () => {
    const exit = vi.fn();
    const handler = new FatalAuthHandler({
      logger: pino({ level: 'silent' }),
      exit,
      flushDelayMs: 1
    });
    const rotationHandler = vi.fn();
    const signals = handler.attachTo(rotationHandler);

    signals.onRotationHinted();
    expect(rotationHandler).toHaveBeenCalledOnce();

    signals.onUnauthorized({ source: 'ws', reason: 'ws_upgrade_401' });
    vi.advanceTimersByTime(50);
    expect(exit).toHaveBeenCalledExactlyOnceWith(87);
  });

  it('lastSuccessfulAuthAt is null when no successful auth was recorded', () => {
    const logSpy = vi.fn();
    const fakeLogger = {
      fatal: logSpy,
      child: () => fakeLogger
    } as unknown as pino.Logger;
    const handler = new FatalAuthHandler({
      logger: fakeLogger,
      exit: vi.fn(),
      flushDelayMs: 1
    });

    handler.onUnauthorized({ source: 'rest', reason: 'rest_401' });

    const [meta] = logSpy.mock.calls[0]!;
    expect(meta).toMatchObject({
      lastSuccessfulAuthAt: null
    });
  });
});
