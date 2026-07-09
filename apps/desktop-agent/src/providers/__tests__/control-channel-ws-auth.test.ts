import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ControlChannelWs,
  type ControlChannelSocket,
  type ControlChannelWsOptions,
  type TaskExecutor
} from '../control-channel-ws.js';
import type {
  TokenAuthSignals,
  UnauthorizedContext
} from '../../auth/auth-signals.js';

/**
 * Phase 4.0 Part 4.E — control-channel WS auth wiring.
 *
 * The existing control-channel-ws.test.ts covers the
 * happy-path hello/welcome/task-assign cycle with the
 * legacy `authToken` constructor option. This file adds:
 *
 *   - tokenProvider read-fresh-on-connect path
 *   - authSignals onUnauthorized cascade for:
 *       * close code 4001
 *       * upgrade error with 'Unexpected server response: 401'
 *       * tokenProvider returning null
 *   - upgrade-event observation of
 *     X-Token-Rotation-Recommended header
 */

const silentLogger = pino({ level: 'silent' });
const AGENT_UUID = '00000000-0000-4000-8000-0000000000bb';

class FakeSocket implements ControlChannelSocket {
  sent: string[] = [];
  #handlers: Record<string, (...args: unknown[]) => void> = {};

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.#handlers.close?.(code, Buffer.from(reason));
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    this.#handlers[event] = cb;
  }

  triggerOpen(): void {
    this.#handlers.open?.();
  }

  triggerError(err: Error): void {
    this.#handlers.error?.(err);
  }

  triggerClose(code = 1000): void {
    this.#handlers.close?.(code, Buffer.from(''));
  }

  triggerUpgrade(headers: Record<string, string | string[] | undefined>): void {
    this.#handlers.upgrade?.({ headers });
  }
}

const buildOptions = (
  overrides: Partial<ControlChannelWsOptions> = {}
): { options: ControlChannelWsOptions; sockets: FakeSocket[] } => {
  const sockets: FakeSocket[] = [];
  const noopExecutor: TaskExecutor = async () => ({
    kind: 'completed',
    taskId: 'noop',
    output: 'noop'
  });
  const options: ControlChannelWsOptions = {
    url: 'wss://api.example.com/v1/agent/ws',
    authToken: 'legacy-token',
    agentId: AGENT_UUID,
    manifest: { providerId: 'p', providerVersion: 'v', manifestVersion: '1' },
    executor: noopExecutor,
    supportedCapabilities: new Set(['code-generation']),
    logger: silentLogger,
    socketFactory: (_url, _headers) => {
      const fake = new FakeSocket();
      sockets.push(fake);
      return fake;
    },
    reconnectBaseMs: 10,
    reconnectMaxMs: 50,
    ...overrides
  };
  return { options, sockets };
};

const buildSignals = (): TokenAuthSignals & {
  unauthorizedCalls: UnauthorizedContext[];
  rotationCalls: number;
} => {
  let rotationCalls = 0;
  const unauthorizedCalls: UnauthorizedContext[] = [];
  return {
    get rotationCalls() {
      return rotationCalls;
    },
    unauthorizedCalls,
    onRotationHinted() {
      rotationCalls += 1;
    },
    onUnauthorized(ctx) {
      unauthorizedCalls.push(ctx);
    }
  };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ControlChannelWs constructor', () => {
  it('throws if neither authToken nor tokenProvider is supplied', () => {
    const { options } = buildOptions();
    const { authToken: _, ...rest } = options;
    expect(() => new ControlChannelWs(rest as ControlChannelWsOptions)).toThrow(
      /requires either `authToken` or `tokenProvider`/
    );
  });
});

describe('ControlChannelWs — tokenProvider', () => {
  it('reads the token via tokenProvider on each connect', async () => {
    const headers: Record<string, string>[] = [];
    let providerCalls = 0;
    const tokenProvider = async (): Promise<string | null> => {
      providerCalls += 1;
      return providerCalls === 1 ? 'token-A' : 'token-B';
    };

    const { options } = buildOptions({
      authToken: undefined,
      tokenProvider,
      socketFactory: (_url, hdr) => {
        headers.push(hdr);
        return new FakeSocket();
      }
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();

    expect(providerCalls).toBe(1);
    expect(headers[0]!.authorization).toBe('Bearer token-A');

    await ws.stop();
  });

  it('fires onUnauthorized when tokenProvider returns null', async () => {
    const tokenProvider = async (): Promise<string | null> => null;
    const signals = buildSignals();
    const { options } = buildOptions({
      authToken: undefined,
      tokenProvider,
      authSignals: signals
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();

    expect(signals.unauthorizedCalls).toHaveLength(1);
    expect(signals.unauthorizedCalls[0]!).toMatchObject({
      source: 'ws',
      reason: 'no_token_in_credential_store'
    });

    await ws.stop();
  });

  it('schedules a reconnect when tokenProvider throws', async () => {
    let providerCalls = 0;
    const tokenProvider = async (): Promise<string | null> => {
      providerCalls += 1;
      if (providerCalls === 1) throw new Error('credential read failed');
      return 'token-recovery';
    };
    const signals = buildSignals();
    const headers: Record<string, string>[] = [];
    const { options } = buildOptions({
      authToken: undefined,
      tokenProvider,
      authSignals: signals,
      socketFactory: (_url, hdr) => {
        headers.push(hdr);
        return new FakeSocket();
      }
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();

    expect(providerCalls).toBe(1);
    expect(signals.unauthorizedCalls).toHaveLength(0);
    // Wait for the reconnect to fire (base 10ms).
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(providerCalls).toBeGreaterThanOrEqual(2);

    await ws.stop();
  });
});

describe('ControlChannelWs — onRotationHinted via upgrade header', () => {
  it('fires onRotationHinted when the upgrade response carries the header', async () => {
    const signals = buildSignals();
    const { options, sockets } = buildOptions({
      authSignals: signals
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();

    sockets[0]!.triggerUpgrade({
      'x-token-rotation-recommended': 'true'
    });
    expect(signals.rotationCalls).toBe(1);

    await ws.stop();
  });

  it('does NOT fire onRotationHinted when the header is absent', async () => {
    const signals = buildSignals();
    const { options, sockets } = buildOptions({
      authSignals: signals
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();
    sockets[0]!.triggerUpgrade({});
    expect(signals.rotationCalls).toBe(0);

    await ws.stop();
  });

  it('handles the array-form of the upgrade header (Node http typing)', async () => {
    const signals = buildSignals();
    const { options, sockets } = buildOptions({ authSignals: signals });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();
    sockets[0]!.triggerUpgrade({
      'x-token-rotation-recommended': ['true']
    });
    expect(signals.rotationCalls).toBe(1);

    await ws.stop();
  });
});

describe('ControlChannelWs — onUnauthorized via close code 4001', () => {
  it('fires onUnauthorized with source=ws on close 4001', async () => {
    const signals = buildSignals();
    const { options, sockets } = buildOptions({
      authSignals: signals
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();
    sockets[0]!.triggerClose(4001);

    expect(signals.unauthorizedCalls).toHaveLength(1);
    expect(signals.unauthorizedCalls[0]!).toMatchObject({
      source: 'ws',
      agentId: AGENT_UUID,
      reason: 'ws_close_4001_unauthorized'
    });

    // No reconnect after 4001 — agent is expected to exit.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sockets).toHaveLength(1);

    await ws.stop();
  });

  it('does NOT fire onUnauthorized on a normal 1000 close', async () => {
    const signals = buildSignals();
    const { options, sockets } = buildOptions({
      authSignals: signals
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();
    sockets[0]!.triggerClose(1000);

    expect(signals.unauthorizedCalls).toHaveLength(0);

    await ws.stop();
  });
});

describe('ControlChannelWs — onUnauthorized via upgrade-error 401', () => {
  it('fires onUnauthorized when the error message contains "Unexpected server response: 401"', async () => {
    const signals = buildSignals();
    const { options, sockets } = buildOptions({
      authSignals: signals
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();
    sockets[0]!.triggerError(new Error('Unexpected server response: 401'));

    expect(signals.unauthorizedCalls).toHaveLength(1);
    expect(signals.unauthorizedCalls[0]!).toMatchObject({
      source: 'ws',
      reason: 'ws_upgrade_401'
    });

    await ws.stop();
  });

  it('does NOT fire onUnauthorized on a generic transport error', async () => {
    const signals = buildSignals();
    const { options, sockets } = buildOptions({
      authSignals: signals
    });

    const ws = new ControlChannelWs(options);
    ws.start();
    await flushMicrotasks();
    sockets[0]!.triggerError(new Error('ECONNRESET'));

    expect(signals.unauthorizedCalls).toHaveLength(0);

    await ws.stop();
  });
});
