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
 * Phase 4.0 ADR-025 amendment 5 — WS upgrade auth coverage.
 *
 * Pins the wiring contract that the prior code lacked: WSS
 * `/v1/agent/ws` MUST accept Phase 4.0 opaque tokens (issued
 * by `POST /v1/agent/register`) and MUST reject every other
 * auth shape — including the legacy Phase 3 user JWTs the
 * old wiring used to accept.
 *
 * TD-066 captures the process gap that let this slip through
 * the original Part 3 integration test.
 */

const LITERAL = 'phase-4-0-ws-auth-test-secret';

const buildEnv = () =>
  parseApiEnv({
    AUTH_JWT_SIGNING_SECRET_LITERAL: LITERAL,
    AUTH_ACCESS_TOKEN_ISSUER: 'operator-auth-gateway',
    AUTH_ACCESS_TOKEN_AUDIENCE: 'operator-os-api'
  });

const TEST_USER_ID = 'ws-auth-test-user';
const TEST_AGENT_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const mintUserToken = async (operatorId = TEST_USER_ID): Promise<string> => {
  const secret = new TextEncoder().encode(LITERAL);
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    sub: operatorId,
    iss: 'operator-auth-gateway',
    aud: 'operator-os-api',
    iat: now,
    exp: now + 3_600,
    scopes: ['user:read', 'user:write'],
    plan: 'free' as const,
    operatorId,
    email: 'ws-auth-test@example.com'
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
};

/**
 * Minimal in-memory AgentRepository — copy of the integration-
 * test version, scoped to the assertions this file needs. Kept
 * inline (not extracted to a helper) so the wiring contract is
 * self-evident on read.
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

interface FixtureApp {
  app: Awaited<ReturnType<typeof buildServer>>;
  agentRepository: AgentRepository;
  /** Fresh user JWT — used only for register/revoke. */
  userJwt: string;
}

/**
 * Build a server + register a fresh agent. Returns the
 * `agentToken` (the opaque per-machine token the WS should
 * accept) plus the agentId. Subsequent tests upgrade with
 * `Authorization: Bearer <agentToken>` and expect 200 (or
 * upstream behaviour past the upgrade).
 */
const setupAndRegister = async (): Promise<
  FixtureApp & { agentToken: string; agentId: string }
> => {
  const agentRepository = buildInMemoryRepository();
  const app = buildServer(buildEnv(), {
    agentRepository,
    trustProxy: false
  });
  await app.ready();
  const userJwt = await mintUserToken();

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/v1/agent/register',
    headers: { authorization: `Bearer ${userJwt}` },
    payload: {
      agentId: TEST_AGENT_ID,
      machineName: 'ws-auth-test-host',
      capabilities: ['code-generation']
    }
  });
  if (registerResponse.statusCode !== 201) {
    throw new Error(
      `Register failed in fixture: ${registerResponse.statusCode} ${registerResponse.body}`
    );
  }
  const body = registerResponse.json() as {
    agentId: string;
    agentToken: string;
  };
  return { app, agentRepository, userJwt, agentToken: body.agentToken, agentId: body.agentId };
};

/**
 * Inject a WS upgrade with the provided Authorization header.
 * Returns either { socket } on success, or { error } on
 * upgrade rejection. The fastify/websocket plugin surfaces
 * a guard rejection as a promise rejection on `injectWS`,
 * carrying the HTTP status code in the message.
 */
const injectWsUpgrade = async (
  app: FixtureApp['app'],
  authorization: string | undefined
): Promise<{ socket: Awaited<ReturnType<typeof app.injectWS>> } | { error: Error }> => {
  try {
    const socket = await app.injectWS(
      '/v1/agent/ws',
      authorization === undefined
        ? {}
        : { headers: { authorization } }
    );
    return { socket };
  } catch (err) {
    return { error: err as Error };
  }
};

describe('Phase 4.0 amendment 5 — WS upgrade auth wiring', () => {
  let fixture: Awaited<ReturnType<typeof setupAndRegister>>;

  beforeEach(async () => {
    fixture = await setupAndRegister();
  });

  afterEach(async () => {
    await fixture.app.close();
  });

  it('accepts a valid Phase 4.0 opaque agent token', async () => {
    const result = await injectWsUpgrade(
      fixture.app,
      `Bearer ${fixture.agentToken}`
    );
    expect('socket' in result).toBe(true);
    if ('socket' in result) result.socket.close();
  });

  it('rejects an invalid opaque token (no matching record)', async () => {
    const result = await injectWsUpgrade(
      fixture.app,
      'Bearer not-a-real-token-just-bytes'
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.message).toMatch(/401/);
    }
  });

  it('rejects a Phase 3 user JWT (security regression guard)', async () => {
    // The legacy createAgentGuard would have accepted this. The
    // amendment-5 wiring rejects it because the JWT isn't an
    // opaque agent token in the agentTokenGuard sense — its
    // sha256 lookup hash matches no agent record.
    const result = await injectWsUpgrade(
      fixture.app,
      `Bearer ${fixture.userJwt}`
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.message).toMatch(/401/);
    }
  });

  it('rejects an upgrade with no Authorization header', async () => {
    const result = await injectWsUpgrade(fixture.app, undefined);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.message).toMatch(/401/);
    }
  });

  it('rejects a malformed Authorization scheme (not Bearer)', async () => {
    const result = await injectWsUpgrade(
      fixture.app,
      `Basic ${fixture.agentToken}`
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.message).toMatch(/401/);
    }
  });

  it('rejects a revoked token', async () => {
    // Revoke via the repo directly (simulating DELETE
    // /v1/agent/:id) — the next WS upgrade attempt with the
    // (now-revoked) token must 401.
    await fixture.agentRepository.markRevoked(
      fixture.agentId,
      'test-revoke'
    );

    const result = await injectWsUpgrade(
      fixture.app,
      `Bearer ${fixture.agentToken}`
    );
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.message).toMatch(/401/);
    }
  });

  it('accepts the new token after rotation, rejects an unrelated random token', async () => {
    // Rotate via the REST route to mint a new agentToken.
    const rotateResponse = await fixture.app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: `Bearer ${fixture.agentToken}` },
      payload: {}
    });
    expect(rotateResponse.statusCode).toBe(200);
    const newAgentToken = (rotateResponse.json() as {
      agentToken: string;
    }).agentToken;
    expect(newAgentToken).not.toBe(fixture.agentToken);

    // New token: WS accepts.
    const acceptResult = await injectWsUpgrade(
      fixture.app,
      `Bearer ${newAgentToken}`
    );
    expect('socket' in acceptResult).toBe(true);
    if ('socket' in acceptResult) acceptResult.socket.close();

    // Unrelated random token: WS rejects (no matching lookup
    // hash, regardless of bcrypt cache state).
    const rejectResult = await injectWsUpgrade(
      fixture.app,
      'Bearer unrelated-fake-token-bytes-xyz'
    );
    expect('error' in rejectResult).toBe(true);
  });
});
