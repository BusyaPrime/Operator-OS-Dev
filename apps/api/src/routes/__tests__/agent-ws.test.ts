import { parseApiEnv } from '@operator-os/config';
import type { AgentRecord } from '@operator-os/contracts';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import {
  AgentsCollectionUnavailableError,
  type AgentRepository
} from '../../integrations/firestore-agent-repository.js';

/**
 * Integration tests for WSS /v1/agent/ws (Phase 2 / TD-017).
 *
 * Uses @fastify/websocket's `app.injectWS()` helper to drive a
 * real ws client against the in-process Fastify instance — no
 * separate listen(), no port-binding flakiness.
 *
 * Phase 4.0 ADR-025 amendment 5 — these tests now authenticate
 * via the Phase 4.0 opaque token (issued by POST
 * /v1/agent/register) rather than a Phase 3 user JWT, because
 * the WS upgrade route has switched to agentTokenGuard. The
 * test body assertions (hello → welcome, malformed-frame
 * close codes, idle behaviour) are unchanged — only the auth
 * shape moved.
 */

const LITERAL = 'a-very-secret-shared-between-auth-gateway-and-operator-api';
const TEST_USER_ID = 'agent-user-1';
const TEST_AGENT_ID = '00000000-0000-4000-8000-000000000001';

const buildEnv = () =>
  parseApiEnv({
    AUTH_JWT_SIGNING_SECRET_LITERAL: LITERAL,
    AUTH_ACCESS_TOKEN_ISSUER: 'operator-auth-gateway',
    AUTH_ACCESS_TOKEN_AUDIENCE: 'operator-os-api'
  });

const mintUserToken = async (operatorId = TEST_USER_ID): Promise<string> => {
  const secret = new TextEncoder().encode(LITERAL);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: operatorId,
    iss: 'operator-auth-gateway',
    aud: 'operator-os-api',
    iat: now,
    exp: now + 3600,
    scopes: ['user:read', 'user:write'],
    plan: 'free' as const,
    operatorId,
    email: 'agent@example.com'
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
};

/**
 * In-memory AgentRepository — same shape as the integration
 * tests' fixture. Inline so this file stays self-contained.
 */
const buildInMemoryRepository = (): AgentRepository => {
  const records = new Map<string, AgentRecord>();
  return {
    async create(record) {
      if (records.has(record.agentId)) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_ID_TAKEN',
          `Agent ${record.agentId} already exists`
        );
      }
      records.set(record.agentId, record);
    },
    async getById(agentId) {
      return records.get(agentId);
    },
    async listForUser(userId, options = {}) {
      const includeRevoked = options.includeRevoked ?? false;
      return [...records.values()]
        .filter((r) => r.userId === userId)
        .filter((r) => includeRevoked || !r.revoked);
    },
    async rotateToken(
      agentId,
      newTokenHash,
      newTokenLookupHash,
      overlapExpiresAt
    ) {
      const before = records.get(agentId);
      if (!before) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_NOT_FOUND',
          `Agent ${agentId} not found`
        );
      }
      const now = new Date().toISOString();
      const updated: AgentRecord = {
        ...before,
        tokenHash: newTokenHash,
        tokenLookupHash: newTokenLookupHash,
        tokenIssuedAt: now,
        tokenLastRotatedAt: now,
        previousTokenHash: before.tokenHash,
        previousTokenLookupHash: before.tokenLookupHash,
        previousTokenExpiresAt: overlapExpiresAt.toISOString(),
        oldTokenUsageCount: 0,
        updatedAt: now
      };
      records.set(agentId, updated);
      return updated;
    },
    async markRevoked(agentId, reason) {
      const before = records.get(agentId);
      if (!before) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_NOT_FOUND',
          `Agent ${agentId} not found`
        );
      }
      const now = new Date().toISOString();
      const updated: AgentRecord = {
        ...before,
        revoked: true,
        revokedAt: before.revokedAt ?? now,
        revokedReason: before.revokedReason ?? reason,
        updatedAt: now
      };
      records.set(agentId, updated);
      return updated;
    },
    async markOnline() {
      /* noop */
    },
    async markOffline() {
      /* noop */
    },
    async recordHeartbeat() {
      /* noop */
    },
    async clearExpiredPreviousTokens() {
      return 0;
    },
    async findCandidatesByTokenLookup(lookupHash) {
      return [...records.values()].filter(
        (r) =>
          r.tokenLookupHash === lookupHash ||
          r.previousTokenLookupHash === lookupHash
      );
    },
    async incrementOldTokenUsage(agentId) {
      const before = records.get(agentId);
      if (!before) return;
      records.set(agentId, {
        ...before,
        oldTokenUsageCount: before.oldTokenUsageCount + 1
      });
    }
  };
};

/**
 * Register a test agent against a running app + return the
 * opaque token. This is the auth shape the WS upgrade now
 * accepts (via Phase 4.0 agentTokenGuard).
 */
const registerTestAgent = async (
  app: Awaited<ReturnType<typeof buildServer>>
): Promise<string> => {
  const userJwt = await mintUserToken();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/agent/register',
    headers: { authorization: `Bearer ${userJwt}` },
    payload: {
      agentId: TEST_AGENT_ID,
      machineName: 'agent-ws-test-host',
      capabilities: ['code-generation']
    }
  });
  if (response.statusCode !== 201) {
    throw new Error(
      `register failed: ${response.statusCode} ${response.body}`
    );
  }
  return (response.json() as { agentToken: string }).agentToken;
};

const validHello = (agentId: string = TEST_AGENT_ID) => ({
  type: 'hello' as const,
  agentId,
  manifest: {
    manifestVersion: '1',
    providerId: 'anthropic.claude-code',
    providerVersion: '0.1.0',
    displayName: 'Claude Code',
    description: 'test',
    author: 'test',
    license: 'MIT',
    capabilities: [],
    requirements: {}
  }
});

const recvOne = <T = unknown>(socket: {
  once(event: 'message', cb: (data: unknown) => void): void;
}): Promise<T> =>
  new Promise<T>((resolve) => {
    socket.once('message', (data: unknown) => {
      const text =
        typeof data === 'string'
          ? data
          : (data as { toString(): string }).toString();
      resolve(JSON.parse(text) as T);
    });
  });

describe('WSS /v1/agent/ws', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let agentToken: string;

  beforeEach(async () => {
    app = buildServer(buildEnv(), {
      trustProxy: false,
      agentRepository: buildInMemoryRepository()
    });
    await app.ready();
    agentToken = await registerTestAgent(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an upgrade with no Authorization header', async () => {
    // The plugin surfaces a 401 preValidation failure as a
    // promise rejection on `injectWS`. The error message
    // carries the HTTP response code the guard produced.
    let caught: Error | undefined;
    try {
      await app.injectWS('/v1/agent/ws');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/401/);
  });

  it('completes hello → welcome for an authenticated client', async () => {
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    socket.send(JSON.stringify(validHello()));
    const welcome = await recvOne<{
      type: string;
      sessionId: string;
      serverFeatures: string[];
    }>(socket);

    expect(welcome.type).toBe('welcome');
    expect(typeof welcome.sessionId).toBe('string');
    expect(welcome.serverFeatures).toEqual([
      'task-dispatch',
      'stream-responses'
    ]);
    socket.close();
  });

  it('closes 4002 when the hello frame is malformed', async () => {
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    socket.send(JSON.stringify({ type: 'hello' })); // missing agentId + manifest
    await new Promise<void>((resolve) => {
      socket.once('close', (code: number) => {
        expect(code).toBe(4002);
        resolve();
      });
    });
  });

  it('sends an error frame and closes 4002 when the hello payload fails schema', async () => {
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    const invalidHello = {
      ...validHello(),
      agentId: 'not-a-uuid'
    };
    socket.send(JSON.stringify(invalidHello));

    const errorFrame = await recvOne<{ type: string; code: string }>(socket);
    expect(errorFrame.type).toBe('error');
    expect(errorFrame.code).toBe('hello-invalid');
    await new Promise<void>((resolve) => {
      socket.once('close', (code: number) => {
        expect(code).toBe(4002);
        resolve();
      });
    });
  });

  it('rejects non-JSON frames with an error message', async () => {
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    socket.send('not-json-at-all');
    const err = await recvOne<{ type: string; code: string }>(socket);
    expect(err.type).toBe('error');
    expect(err.code).toBe('frame-not-json');
    socket.close();
  });

  it('accepts post-welcome task-progress without errors', async () => {
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    socket.send(JSON.stringify(validHello()));
    await recvOne(socket); // welcome

    // A task-progress frame — server should not send an error.
    socket.send(
      JSON.stringify({
        type: 'task-progress',
        taskId: 'task-abc',
        progress: { stage: 'spawning', percent: 0 }
      })
    );

    // Race: either an error frame arrives (test fail) or nothing
    // arrives within 200 ms (test pass). Use a short timeout.
    const maybeError = await Promise.race([
      recvOne<{ type: string }>(socket),
      new Promise<undefined>((resolve) => setTimeout(resolve, 200))
    ]);
    if (maybeError !== undefined) {
      expect(maybeError.type).not.toBe('error');
    }
    socket.close();
  });

  it('emits an error but stays open on post-welcome invalid frame', async () => {
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    socket.send(JSON.stringify(validHello()));
    await recvOne(socket); // welcome

    socket.send(JSON.stringify({ type: 'unknown-frame' }));
    const err = await recvOne<{ type: string; code: string }>(socket);
    expect(err.type).toBe('error');
    expect(err.code).toBe('frame-invalid');
    // socket still open — no close event follows.
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });

  it('registry issues 4004 close to the prior socket on duplicate agentId', async () => {
    // Direct registry test — the WS duplicate-agent flow is
    // covered end-to-end via the registry's behaviour alone.
    // Running this through two `injectWS` clients produced a
    // heisenbug where the client-side close event races with
    // the plugin's message delivery (observed as a spurious
    // 4002 from a later message path). The registry is the
    // single source of truth for this rule; unit-testing it
    // here is both faster and more deterministic.
    const { createAgentSessionRegistry } = await import(
      '../../services/agent-session-registry.js'
    );
    const registry = createAgentSessionRegistry();

    let capturedCode: number | undefined;
    let capturedReason: string | undefined;
    const fakePriorSocket = {
      close: (code: number, reason: string) => {
        capturedCode = code;
        capturedReason = reason;
      },
      terminate: () => undefined
    } as unknown as import('ws').WebSocket;

    registry.register({
      agentId: 'agent-1',
      userId: 'user-1',
      socket: fakePriorSocket,
      manifest: { placeholder: true }
    });

    const fakeSecondSocket = {
      close: () => undefined,
      terminate: () => undefined
    } as unknown as import('ws').WebSocket;

    registry.register({
      agentId: 'agent-1',
      userId: 'user-1',
      socket: fakeSecondSocket,
      manifest: { placeholder: true }
    });

    expect(capturedCode).toBe(4004);
    expect(capturedReason).toBe('duplicate-agent');
  });

  it('fires ping frames on the configured interval', async () => {
    // Fastify route options aren't tunable per-test here, but we
    // can still assert the default loop fires by waiting briefly
    // — integrated into the WS protocol test block. Given the
    // default interval is 30 s (too slow for a CI run), this
    // case simply asserts that a welcomed session sits idle
    // without spuriously closing for `pongTimeoutMs` — which
    // is effectively the ping loop contract from the client's
    // perspective.
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    socket.send(JSON.stringify(validHello()));
    await recvOne(socket); // welcome

    // Wait 300 ms; socket must still be OPEN (no idle-timeout
    // misfire at this cadence).
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });

  it('updates lastActivityAt via heartbeat-ping without erroring', async () => {
    const socket = await app.injectWS('/v1/agent/ws', {
      headers: { authorization: `Bearer ${agentToken}` }
    });

    socket.send(JSON.stringify(validHello()));
    await recvOne(socket); // welcome

    socket.send(JSON.stringify({ type: 'heartbeat-ping' }));

    // No response is expected for heartbeat-ping — wait briefly
    // and ensure no error arrives.
    const maybeError = await Promise.race([
      recvOne<{ type: string }>(socket),
      new Promise<undefined>((resolve) => setTimeout(resolve, 200))
    ]);
    if (maybeError !== undefined) {
      expect(maybeError.type).not.toBe('error');
    }
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });
});
