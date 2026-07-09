import { parseDesktopAgentEnv } from '@operator-os/config';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesktopApiClient } from '../api-client.js';
import {
  AGENT_TOKEN_TARGET,
  InMemoryCredentialStore
} from '../auth/credential-store.js';
import type {
  TokenAuthSignals,
  UnauthorizedContext
} from '../auth/auth-signals.js';

/**
 * Phase 4.0 Part 4.D — REST client auth wiring.
 *
 * The existing controlled-fallback contract tests live in
 * runtime + integration suites; this file specifically
 * exercises the new auth path:
 *
 *   - Authorization header attached from CredentialStore
 *   - Header read fresh on every request (rotation pickup)
 *   - X-Token-Rotation-Recommended → onRotationHinted
 *   - 401 → onUnauthorized (with source='rest')
 */

const silentLogger = pino({ level: 'silent' });

const buildEnv = () =>
  parseDesktopAgentEnv({
    NODE_ENV: 'development',
    API_BASE_URL: 'http://localhost:8080',
    AGENT_ID: 'agent-test',
    DEVICE_ID: 'device-test'
  });

const buildSignals = (): TokenAuthSignals & {
  rotationCalls: number;
  unauthorizedCalls: UnauthorizedContext[];
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

const installFetchSpy = (
  responder: (
    url: string,
    init: RequestInit
  ) => { status: number; body?: unknown; headers?: Record<string, string> }
): {
  spy: ReturnType<typeof vi.spyOn>;
  calls: Array<{ url: string; init: RequestInit }>;
} => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
    (async (
      url: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const urlString = typeof url === 'string' ? url : url.toString();
      const safeInit = init ?? {};
      calls.push({ url: urlString, init: safeInit });
      const fx = responder(urlString, safeInit);
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(fx.headers ?? {})
      };
      return new Response(JSON.stringify(fx.body ?? {}), {
        status: fx.status,
        headers
      });
    }) as typeof globalThis.fetch
  );
  return { spy, calls };
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DesktopApiClient — Authorization header', () => {
  it('attaches Bearer <token> read fresh from the credential store', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'first-token');
    const signals = buildSignals();
    const { calls } = installFetchSpy(() => ({
      status: 200,
      body: {
        operation: 'device-state.heartbeat',
        accepted: true,
        resourceId: 'd1',
        dataSource: 'live',
        message: 'ok',
        timestamp: '2026-04-28T12:00:00.000Z'
      }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      credentialStore: store,
      authSignals: signals
    });
    await client.publishAlert({
      id: 'a1',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);

    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer first-token');
  });

  it('reads the token fresh on every request (rotation pickup, no caching)', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'token-A');
    const signals = buildSignals();
    const { calls } = installFetchSpy(() => ({
      status: 200,
      body: {
        operation: 'alert.emit',
        accepted: true,
        resourceId: 'a',
        dataSource: 'live',
        message: 'ok',
        timestamp: '2026-04-28T12:00:00.000Z'
      }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      credentialStore: store,
      authSignals: signals
    });
    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);
    expect(
      (calls[0]!.init.headers as Record<string, string>).authorization
    ).toBe('Bearer token-A');

    // Simulate a rotation between calls.
    await store.storeToken(AGENT_TOKEN_TARGET, 'token-B');

    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);
    expect(
      (calls[1]!.init.headers as Record<string, string>).authorization
    ).toBe('Bearer token-B');
  });

  it('omits Authorization header when no credentialStore was supplied (legacy path)', async () => {
    const signals = buildSignals();
    const { calls } = installFetchSpy(() => ({
      status: 200,
      body: {
        operation: 'alert.emit',
        accepted: true,
        resourceId: 'a',
        dataSource: 'live',
        message: 'ok',
        timestamp: '2026-04-28T12:00:00.000Z'
      }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      authSignals: signals
      // no credentialStore
    });
    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);

    const headers = calls[0]!.init.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.authorization).toBeUndefined();
  });

  it('sends request unauthenticated (warns) when credential store throws', async () => {
    const flakyStore = {
      async storeToken() {
        /* unused */
      },
      async getToken() {
        throw new Error('credential read failed');
      },
      async deleteToken() {
        /* unused */
      }
    };
    const signals = buildSignals();
    const { calls } = installFetchSpy(() => ({
      status: 200,
      body: {
        operation: 'alert.emit',
        accepted: true,
        resourceId: 'a',
        dataSource: 'live',
        message: 'ok',
        timestamp: '2026-04-28T12:00:00.000Z'
      }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      credentialStore: flakyStore,
      authSignals: signals
    });
    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);

    expect(calls).toHaveLength(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});

describe('DesktopApiClient — X-Token-Rotation-Recommended', () => {
  it('fires onRotationHinted when the response sets the header', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'tok');
    const signals = buildSignals();
    installFetchSpy(() => ({
      status: 200,
      body: {
        operation: 'alert.emit',
        accepted: true,
        resourceId: 'a',
        dataSource: 'live',
        message: 'ok',
        timestamp: '2026-04-28T12:00:00.000Z'
      },
      headers: {
        'x-token-rotation-recommended': 'true'
      }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      credentialStore: store,
      authSignals: signals
    });
    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);

    expect(signals.rotationCalls).toBe(1);
  });

  it('does NOT fire onRotationHinted when the header is absent', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'tok');
    const signals = buildSignals();
    installFetchSpy(() => ({
      status: 200,
      body: {
        operation: 'alert.emit',
        accepted: true,
        resourceId: 'a',
        dataSource: 'live',
        message: 'ok',
        timestamp: '2026-04-28T12:00:00.000Z'
      }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      credentialStore: store,
      authSignals: signals
    });
    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);

    expect(signals.rotationCalls).toBe(0);
  });
});

describe('DesktopApiClient — 401 cascade', () => {
  it('fires onUnauthorized with source=rest on a 401', async () => {
    const store = new InMemoryCredentialStore();
    await store.storeToken(AGENT_TOKEN_TARGET, 'tok');
    const signals = buildSignals();
    installFetchSpy(() => ({
      status: 401,
      body: { code: 'unauthorized' }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      credentialStore: store,
      authSignals: signals
    });
    // The route falls back via mutationReceiptSchema in
    // CONTROLLED_FALLBACK mode; we only care about whether
    // the signal fires. Suppress the route's own throw.
    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);

    expect(signals.unauthorizedCalls).toHaveLength(1);
    expect(signals.unauthorizedCalls[0]!).toMatchObject({
      source: 'rest',
      method: 'POST',
      reason: 'rest_401'
    });
    expect(signals.unauthorizedCalls[0]!.url).toContain('/v1/agent/alerts');
  });

  it('does NOT fire onUnauthorized when the credential store is absent (legacy mode)', async () => {
    const signals = buildSignals();
    installFetchSpy(() => ({
      status: 401,
      body: { code: 'unauthorized' }
    }));

    const client = new DesktopApiClient(buildEnv(), silentLogger, {
      authSignals: signals
      // no credentialStore — agent never authenticated, 401
      // is just a noisy log, not a fatal-trigger.
    });
    await client.publishAlert({
      id: 'a',
      severity: 'info',
      source: 'agent',
      title: 't',
      message: 'm',
      status: 'open',
      createdAt: '2026-04-28T12:00:00.000Z',
      metadata: {}
    } as never);

    expect(signals.unauthorizedCalls).toHaveLength(0);
  });
});
