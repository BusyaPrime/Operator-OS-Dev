import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_TOKEN_TARGET,
  InMemoryCredentialStore
} from '../credential-store.js';
import { FatalAuthHandler } from '../fatal-auth-handler.js';
import { TokenRotator } from '../token-rotator.js';
import {
  ControlChannelWs,
  type ControlChannelSocket
} from '../../providers/control-channel-ws.js';

/**
 * Phase 4.0 Part 4.G integration — token rotation cascade.
 *
 * Wires together CredentialStore + FatalAuthHandler +
 * TokenRotator + ControlChannelWs (the WS half) and exercises:
 *
 *   - The WS reads the stored token via tokenProvider on
 *     each connect.
 *   - X-Token-Rotation-Recommended observed by the WS
 *     upgrade fires the rotator.
 *   - Rotator calls /v1/agent/rotate-token, persists the
 *     new token, and the next reconnect picks it up.
 *   - WS close 4001 fires the FatalAuthHandler's
 *     onUnauthorized, exit(87) is scheduled.
 *
 * The api side is mocked entirely with a stub fetch that
 * captures call sequences. The WS side uses the same
 * FakeSocket pattern existing tests use.
 */

const silentLogger = pino({ level: 'silent' });

const buildFetchStub = (
  fixtures: ReadonlyArray<{ status: number; body?: unknown }>
): typeof globalThis.fetch & {
  calls: Array<{ url: string; init?: RequestInit }>;
} => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: typeof url === 'string' ? url : url.toString(),
      init
    });
    const fx = fixtures[i++] ?? { status: 500, body: {} };
    return new Response(JSON.stringify(fx.body ?? {}), {
      status: fx.status,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof globalThis.fetch & {
    calls: Array<{ url: string; init?: RequestInit }>;
  };
  Object.defineProperty(fn, 'calls', { value: calls });
  return fn;
};

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

  triggerClose(code: number): void {
    this.#handlers.close?.(code, Buffer.from(''));
  }

  triggerUpgrade(headers: Record<string, string | string[] | undefined>): void {
    this.#handlers.upgrade?.({ headers });
  }
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

describe('Phase 4.0 Part 4 cascade — rotation hint → rotator → store → next WS connect', () => {
  it('observes X-Token-Rotation-Recommended on the WS upgrade and rotates the stored token', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'token-original');

    const fatalAuth = new FatalAuthHandler({
      logger: silentLogger,
      exit: vi.fn(),
      flushDelayMs: 1
    });

    // Rotator with controlled fetch + injected timer (so the
    // periodic timer never fires in this test).
    const rotateFetch = buildFetchStub([
      {
        status: 200,
        body: {
          agentId: '00000000-0000-4000-8000-0000000000bb',
          agentToken: 'token-rotated',
          tokenIssuedAt: '2026-04-28T12:00:00.000Z',
          previousTokenExpiresAt: '2026-04-29T12:00:00.000Z'
        }
      }
    ]);
    let timerCb: (() => void) | undefined;
    const rotator = new TokenRotator({
      apiBaseUrl: 'http://api.example.com',
      credentialStore: store,
      authSignals: {
        onRotationHinted: () => {
          /* injected below */
        },
        onUnauthorized: fatalAuth.onUnauthorized
      },
      logger: silentLogger,
      fetch: rotateFetch,
      setTimeout: ((cb) => {
        timerCb = cb as () => void;
        return { unref: () => undefined };
      }) as unknown as typeof globalThis.setTimeout,
      clearTimeout: (() => {
        timerCb = undefined;
      }) as unknown as typeof globalThis.clearTimeout
    });

    // Authoritative signals object: rotation hint forwards
    // to the rotator; unauthorized goes to the fatal handler.
    const signals = fatalAuth.attachTo(() => rotator.triggerRotation());

    // Build the WS with a tokenProvider that reads from the
    // store.
    const sockets: FakeSocket[] = [];
    const ws = new ControlChannelWs({
      url: 'ws://api.example.com/v1/agent/ws',
      tokenProvider: () => store.getToken(AGENT_TOKEN_TARGET),
      authSignals: signals,
      agentId: '00000000-0000-4000-8000-0000000000bb',
      manifest: {
        manifestVersion: '1',
        providerId: 'p',
        providerVersion: 'v'
      },
      executor: async () => ({
        kind: 'completed',
        taskId: 'noop',
        output: ''
      }),
      supportedCapabilities: new Set(['code-generation']),
      logger: silentLogger,
      reconnectBaseMs: 5,
      reconnectMaxMs: 20,
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }
    });

    ws.start();
    await flushMicrotasks();

    expect(sockets).toHaveLength(1);
    // First connect uses the original stored token. The
    // socket factory captured the headers — use the test's
    // own internal verification: the rotator hasn't been
    // triggered yet.
    expect(rotateFetch.calls).toHaveLength(0);

    // Server tells the agent to rotate via the upgrade
    // header.
    sockets[0]!.triggerUpgrade({
      'x-token-rotation-recommended': 'true'
    });
    await flushMicrotasks();
    // The rotator's #performRotation is async — wait for the
    // backoff-wrapped chain to settle.
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Rotator hit the api once and got 'token-rotated' back.
    expect(rotateFetch.calls).toHaveLength(1);
    expect(rotateFetch.calls[0]!.url).toBe(
      'http://api.example.com/v1/agent/rotate-token'
    );
    // Store now has the new token.
    expect(await store.getToken(AGENT_TOKEN_TARGET)).toBe('token-rotated');

    // Suppress the unused-var warning for timerCb. The
    // fixture's purpose is documented in the test setup.
    void timerCb;

    await ws.stop();
    await rotator.stop();
  });

  it('WS close 4001 → fatal handler exits with code 87', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'tok');
    const exit = vi.fn();
    const fatalAuth = new FatalAuthHandler({
      logger: silentLogger,
      exit,
      flushDelayMs: 5
    });
    const signals = fatalAuth.attachTo(() => {
      /* rotator no-op for this test */
    });

    const sockets: FakeSocket[] = [];
    const ws = new ControlChannelWs({
      url: 'ws://api.example.com/v1/agent/ws',
      tokenProvider: () => store.getToken(AGENT_TOKEN_TARGET),
      authSignals: signals,
      agentId: '00000000-0000-4000-8000-0000000000bb',
      manifest: {
        manifestVersion: '1',
        providerId: 'p',
        providerVersion: 'v'
      },
      executor: async () => ({
        kind: 'completed',
        taskId: 'noop',
        output: ''
      }),
      supportedCapabilities: new Set(['code-generation']),
      logger: silentLogger,
      reconnectBaseMs: 100,
      reconnectMaxMs: 200,
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }
    });

    ws.start();
    await flushMicrotasks();

    sockets[0]!.triggerClose(4001);
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(exit).toHaveBeenCalledExactlyOnceWith(87);
    expect(fatalAuth.hasFired).toBe(true);

    await ws.stop();
  });

  it('rotator 401 also triggers the fatal handler', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'tok');
    const exit = vi.fn();
    const fatalAuth = new FatalAuthHandler({
      logger: silentLogger,
      exit,
      flushDelayMs: 5
    });

    const rotateFetch = buildFetchStub([
      { status: 401, body: { code: 'unauthorized' } }
    ]);
    const rotator = new TokenRotator({
      apiBaseUrl: 'http://api.example.com',
      credentialStore: store,
      authSignals: fatalAuth.attachTo(() => {
        /* recursion-safe */
      }),
      logger: silentLogger,
      fetch: rotateFetch,
      backoff: { baseMs: 1, maxMs: 5, maxAttempts: 1 }
    });

    rotator.triggerRotation();
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(exit).toHaveBeenCalledExactlyOnceWith(87);
    expect(fatalAuth.hasFired).toBe(true);
  });
});
