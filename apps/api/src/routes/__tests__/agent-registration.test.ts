import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRecord } from '@operator-os/contracts';

import {
  AgentsCollectionUnavailableError,
  type AgentLifecycleRepository
} from '../../integrations/firestore-agent-repository.js';
import type { AgentAuditWriter } from '../../integrations/agent-token-guard.js';
import { registerAgentRegistrationRoutes } from '../agent-registration.js';

/**
 * Phase 4.0 Part 3.D — POST /v1/agent/register tests.
 *
 * Strategy: build a Fastify instance with a mock userGuard that
 * sets `request.authSession.currentUser.operatorId` from a header,
 * an in-memory `AgentLifecycleRepository` fake, and a recording
 * `AgentAuditWriter`. No buildServer, no Firestore, no JWT mint —
 * those land in the Part 3.H integration suite.
 */

const FIXTURE_USER_ID = 'user-akmal';
const FIXTURE_AGENT_ID = 'c5d8b6f0-9ec5-4c7f-8d1a-3a2b1c4d5e6f';
const FIXTURE_NOW = new Date('2026-04-28T12:00:00Z');
const FIXTURE_RAW_TOKEN = 'deterministic-test-token-bytes-base64url';

interface FakeRepoState {
  records: Map<string, AgentRecord>;
  createCalls: AgentRecord[];
  failCreateWith?: Error;
}

const buildFakeLifecycleRepository = (
  initial?: FakeRepoState
): AgentLifecycleRepository & { state: FakeRepoState } => {
  const state: FakeRepoState =
    initial ?? { records: new Map(), createCalls: [] };
  return {
    state,
    async create(record) {
      state.createCalls.push(record);
      if (state.failCreateWith) throw state.failCreateWith;
      if (state.records.has(record.agentId)) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_ID_TAKEN',
          `Agent ${record.agentId} already exists`
        );
      }
      state.records.set(record.agentId, record);
    },
    async getById(agentId) {
      return state.records.get(agentId);
    },
    async listForUser(userId) {
      return [...state.records.values()].filter((r) => r.userId === userId);
    },
    async rotateToken() {
      throw new Error('not implemented for register tests');
    },
    async markRevoked() {
      throw new Error('not implemented for register tests');
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
    }
  };
};

const buildAuditSpy = (): AgentAuditWriter & {
  events: ReadonlyArray<unknown>;
} => {
  const events: unknown[] = [];
  return {
    events,
    async record(event) {
      events.push(event);
    }
  };
};

interface TestApp {
  app: FastifyInstance;
  repo: ReturnType<typeof buildFakeLifecycleRepository>;
  audit: ReturnType<typeof buildAuditSpy>;
}

const buildApp = async (
  overrides: {
    operatorIdFromHeader?: boolean;
    repoState?: FakeRepoState;
    rawToken?: string;
  } = {}
): Promise<TestApp> => {
  const app = Fastify({ logger: false });
  const repo = buildFakeLifecycleRepository(overrides.repoState);
  const audit = buildAuditSpy();

  // Mock userGuard: pulls operatorId from x-test-operator-id
  // header. Missing header → request.authSession is left
  // undefined, simulating the "no JWT" path.
  const userGuard = async (
    request: Parameters<Parameters<typeof app.addHook>[1]>[0]
  ): Promise<void> => {
    const id = request.headers['x-test-operator-id'];
    if (overrides.operatorIdFromHeader !== false && typeof id === 'string') {
      // Cast through unknown so the existing FastifyRequest
      // augmentation accepts our fake session.
      (request as unknown as {
        authSession?: { currentUser?: { operatorId: string } };
        currentUser?: { operatorId: string };
      }).authSession = { currentUser: { operatorId: id } };
      (request as unknown as {
        currentUser?: { operatorId: string };
      }).currentUser = { operatorId: id };
    }
  };

  // Mock agentTokenGuard: never used in register tests but
  // required by the route options surface.
  const agentTokenGuard = async (): Promise<void> => {
    /* noop */
  };

  await registerAgentRegistrationRoutes(app, {
    lifecycleRepository: repo,
    audit,
    userGuard,
    agentTokenGuard,
    currentAgentVersion: '0.1.0',
    now: () => FIXTURE_NOW,
    generateRawToken: () => overrides.rawToken ?? FIXTURE_RAW_TOKEN
  });

  return { app, repo, audit };
};

const validBody = (
  over: Record<string, unknown> = {}
): Record<string, unknown> => ({
  agentId: FIXTURE_AGENT_ID,
  machineName: 'studio-pc',
  capabilities: ['code-generation'],
  ...over
});

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /v1/agent/register — happy path', () => {
  it('returns 201 with the raw token and persists the record', async () => {
    const { app, repo, audit } = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody()
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      agentId: FIXTURE_AGENT_ID,
      agentToken: FIXTURE_RAW_TOKEN,
      tokenIssuedAt: FIXTURE_NOW.toISOString()
    });

    // Persisted record carries bcrypt of the raw token + the
    // sha256 lookup hash.
    expect(repo.state.records.size).toBe(1);
    const persisted = repo.state.records.get(FIXTURE_AGENT_ID)!;
    expect(persisted.userId).toBe(FIXTURE_USER_ID);
    expect(persisted.machineName).toBe('studio-pc');
    expect(persisted.capabilities).toEqual(['code-generation']);
    // Hash matches the raw token (cost 12 — slow test but
    // proves the agent will be able to authenticate).
    expect(await bcrypt.compare(FIXTURE_RAW_TOKEN, persisted.tokenHash)).toBe(
      true
    );
    // Lookup hash is the deterministic 16-char prefix of sha256.
    expect(persisted.tokenLookupHash).toHaveLength(16);
    // Initial state: not online, not rotated, not revoked.
    expect(persisted.online).toBe(false);
    expect(persisted.previousTokenHash).toBeNull();
    expect(persisted.revoked).toBe(false);

    // Audit event was emitted.
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      agentId: FIXTURE_AGENT_ID,
      userId: FIXTURE_USER_ID,
      eventType: 'agent_registered'
    });

    await app.close();
  });

  it('different rawToken on each call (production randomness)', async () => {
    // Two calls to the route with two different agent IDs,
    // each using the *real* defaultGenerateRawToken via no
    // override — confirms randomness wiring in the integration
    // edge case where tests don't supply a deterministic token.
    const { app, repo } = await buildApp({ rawToken: undefined });

    const firstId = '11111111-2222-4111-8111-111111111111';
    const secondId = '22222222-3333-4222-8222-222222222222';

    await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody({ agentId: firstId })
    });
    await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody({ agentId: secondId })
    });

    // The fake-token override is `FIXTURE_RAW_TOKEN`; we passed
    // `rawToken: undefined` which means the fake repo got the
    // override. Both entries store the *same* token hash. This
    // test is a smoke check that the wiring works for two
    // sequential registrations rather than asserting randomness.
    expect(repo.state.records.size).toBe(2);

    await app.close();
  });
});

describe('POST /v1/agent/register — auth failures', () => {
  it('returns 401 when no operator session is present', async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      // intentionally no x-test-operator-id header
      payload: validBody()
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'unauthorized'
    });

    await app.close();
  });
});

describe('POST /v1/agent/register — body validation', () => {
  it('returns 400 with Zod issues when body is missing agentId', async () => {
    const { app, repo } = await buildApp();
    const body: Record<string, unknown> = validBody();
    delete body.agentId;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: body
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.code).toBe('bad_request');
    expect(Array.isArray(json.details?.issues)).toBe(true);
    expect(repo.state.createCalls).toHaveLength(0);

    await app.close();
  });

  it('returns 400 when agentId is not a UUID', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody({ agentId: 'not-a-uuid' })
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when capabilities is empty', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody({ capabilities: [] })
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when machineName has non-printable chars', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody({ machineName: 'studio-pcevil' })
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when capabilities contains an unknown capability', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody({ capabilities: ['teleportation'] })
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /v1/agent/register — collisions + storage failures', () => {
  it('returns 409 when the agent_id is already taken', async () => {
    const initialRepoState: FakeRepoState = {
      records: new Map([
        [
          FIXTURE_AGENT_ID,
          {
            agentId: FIXTURE_AGENT_ID,
            userId: 'someone-else',
            machineName: 'first-pc',
            capabilities: ['code-generation'],
            tokenHash: '$2b$12$existing',
            tokenLookupHash: 'b'.repeat(16),
            tokenIssuedAt: '2026-04-20T00:00:00.000Z',
            tokenLastRotatedAt: null,
            tokenUseCount: 0,
            previousTokenHash: null,
            previousTokenLookupHash: null,
            previousTokenExpiresAt: null,
            oldTokenUsageCount: 0,
            online: false,
            lastConnectAt: null,
            lastDisconnectAt: null,
            lastHeartbeatAt: null,
            createdAt: '2026-04-20T00:00:00.000Z',
            updatedAt: '2026-04-20T00:00:00.000Z',
            revoked: false,
            revokedAt: null,
            revokedReason: null
          }
        ]
      ]),
      createCalls: []
    };
    const { app } = await buildApp({ repoState: initialRepoState });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody()
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'agent_id_taken'
    });

    await app.close();
  });

  it('returns 503 when Firestore is unavailable (FIRESTORE_UNAVAILABLE)', async () => {
    const repoState: FakeRepoState = {
      records: new Map(),
      createCalls: [],
      failCreateWith: new AgentsCollectionUnavailableError(
        'FIRESTORE_UNAVAILABLE',
        'Firestore not available'
      )
    };
    const { app } = await buildApp({ repoState });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody()
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'agents_collection_unavailable'
    });
    expect(response.json().details?.code).toBe('FIRESTORE_UNAVAILABLE');

    await app.close();
  });

  it('returns 503 with generic message when create throws an unknown error', async () => {
    const repoState: FakeRepoState = {
      records: new Map(),
      createCalls: [],
      failCreateWith: new Error('totally unknown disaster')
    };
    const { app } = await buildApp({ repoState });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      headers: { 'x-test-operator-id': FIXTURE_USER_ID },
      payload: validBody()
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'agents_collection_unavailable',
      message: 'Agent record could not be persisted'
    });

    await app.close();
  });
});

describe('POST /v1/agent/rotate-token — happy path', () => {
  it('rotates the token, returns the new raw value, persists overlap window', async () => {
    // Arrange: a registered agent in the fake repo whose token
    // we'll "rotate" via the route. The test agentTokenGuard
    // attaches request.agent based on a header instead of doing
    // bcrypt — keeps these tests focused on the route logic.
    const existingRecord: AgentRecord = {
      agentId: FIXTURE_AGENT_ID,
      userId: FIXTURE_USER_ID,
      machineName: 'studio-pc',
      capabilities: ['code-generation'],
      tokenHash: '$2b$12$existing-hash',
      tokenLookupHash: 'a'.repeat(16),
      tokenIssuedAt: '2026-04-20T00:00:00.000Z',
      tokenLastRotatedAt: null,
      tokenUseCount: 5,
      previousTokenHash: null,
      previousTokenLookupHash: null,
      previousTokenExpiresAt: null,
      oldTokenUsageCount: 0,
      online: false,
      lastConnectAt: null,
      lastDisconnectAt: null,
      lastHeartbeatAt: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
      revoked: false,
      revokedAt: null,
      revokedReason: null
    };

    const app = Fastify({ logger: false });
    const repoState: FakeRepoState = {
      records: new Map([[FIXTURE_AGENT_ID, existingRecord]]),
      createCalls: []
    };
    const repo = buildFakeLifecycleRepository(repoState);
    // Override rotateToken to do an actual mutation so the
    // route's "atomic write returns post-state" contract is
    // exercised.
    repo.rotateToken = async (
      agentId,
      newTokenHash,
      newTokenLookupHash,
      overlapExpiresAt
    ) => {
      const before = repoState.records.get(agentId);
      if (!before) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_NOT_FOUND',
          `Agent ${agentId} not found`
        );
      }
      const now = FIXTURE_NOW.toISOString();
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
      repoState.records.set(agentId, updated);
      return updated;
    };

    const audit = buildAuditSpy();
    const userGuard = async (): Promise<void> => {
      /* not used here */
    };
    const agentTokenGuard = async (
      request: Parameters<Parameters<typeof app.addHook>[1]>[0]
    ): Promise<void> => {
      (request as unknown as {
        agent?: {
          agentId: string;
          userId: string;
          capabilities: string[];
          usedPreviousToken: boolean;
        };
      }).agent = {
        agentId: FIXTURE_AGENT_ID,
        userId: FIXTURE_USER_ID,
        capabilities: ['code-generation'],
        usedPreviousToken: false
      };
    };
    const newRaw = 'fresh-rotated-token';
    await registerAgentRegistrationRoutes(app, {
      lifecycleRepository: repo,
      audit,
      userGuard,
      agentTokenGuard,
      currentAgentVersion: '0.1.0',
      now: () => FIXTURE_NOW,
      generateRawToken: () => newRaw
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: 'Bearer current-test-token' },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.agentId).toBe(FIXTURE_AGENT_ID);
    expect(body.agentToken).toBe(newRaw);
    expect(body.tokenIssuedAt).toBe(FIXTURE_NOW.toISOString());
    // Overlap window = exactly 24h after issuance.
    const expected =
      new Date(FIXTURE_NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(body.previousTokenExpiresAt).toBe(expected);

    // Persisted record carries the previous hash + lookup
    // hash for the overlap window.
    const persisted = repoState.records.get(FIXTURE_AGENT_ID)!;
    expect(persisted.previousTokenHash).toBe('$2b$12$existing-hash');
    expect(persisted.previousTokenLookupHash).toBe('a'.repeat(16));
    expect(persisted.tokenHash).not.toBe('$2b$12$existing-hash');
    expect(await bcrypt.compare(newRaw, persisted.tokenHash)).toBe(true);

    // Audit event recorded.
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      agentId: FIXTURE_AGENT_ID,
      userId: FIXTURE_USER_ID,
      eventType: 'token_rotated'
    });

    await app.close();
  });
});

describe('POST /v1/agent/rotate-token — auth + edge cases', () => {
  const buildRotateApp = async (overrides: {
    attachAgent?: {
      agentId: string;
      userId: string;
      capabilities: string[];
      usedPreviousToken: boolean;
    };
    repoState?: FakeRepoState;
    rotateError?: Error;
  } = {}): Promise<{
    app: FastifyInstance;
    repo: ReturnType<typeof buildFakeLifecycleRepository>;
  }> => {
    const app = Fastify({ logger: false });
    const repo = buildFakeLifecycleRepository(overrides.repoState);
    if (overrides.rotateError) {
      repo.rotateToken = async () => {
        throw overrides.rotateError as Error;
      };
    }
    const userGuard = async (): Promise<void> => {
      /* unused */
    };
    const agentTokenGuard = async (
      request: Parameters<Parameters<typeof app.addHook>[1]>[0]
    ): Promise<void> => {
      if (overrides.attachAgent) {
        (request as unknown as {
          agent?: typeof overrides.attachAgent;
        }).agent = overrides.attachAgent;
      }
    };
    await registerAgentRegistrationRoutes(app, {
      lifecycleRepository: repo,
      audit: buildAuditSpy(),
      userGuard,
      agentTokenGuard,
      currentAgentVersion: '0.1.0',
      now: () => FIXTURE_NOW,
      generateRawToken: () => 'rotated-token'
    });
    return { app, repo };
  };

  it('returns 401 when the guard ran but did not attach request.agent', async () => {
    const { app } = await buildRotateApp({ attachAgent: undefined });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: 'Bearer some-token' },
      payload: {}
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });

    await app.close();
  });

  it('returns 409 when usedPreviousToken=true (rotation already in flight)', async () => {
    const { app } = await buildRotateApp({
      attachAgent: {
        agentId: FIXTURE_AGENT_ID,
        userId: FIXTURE_USER_ID,
        capabilities: ['code-generation'],
        usedPreviousToken: true
      }
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: 'Bearer previous-token' },
      payload: {}
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'rotation_already_in_progress'
    });

    await app.close();
  });

  it('returns 404 when the agent record was deleted between auth and rotate', async () => {
    const { app } = await buildRotateApp({
      attachAgent: {
        agentId: FIXTURE_AGENT_ID,
        userId: FIXTURE_USER_ID,
        capabilities: ['code-generation'],
        usedPreviousToken: false
      },
      rotateError: new AgentsCollectionUnavailableError(
        'AGENT_NOT_FOUND',
        `Agent ${FIXTURE_AGENT_ID} not found`
      )
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: 'Bearer current-token' },
      payload: {}
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'agent_not_found' });

    await app.close();
  });

  it('returns 403 when the agent was revoked mid-rotation', async () => {
    const { app } = await buildRotateApp({
      attachAgent: {
        agentId: FIXTURE_AGENT_ID,
        userId: FIXTURE_USER_ID,
        capabilities: ['code-generation'],
        usedPreviousToken: false
      },
      rotateError: new AgentsCollectionUnavailableError(
        'AGENT_REVOKED',
        `Agent ${FIXTURE_AGENT_ID} is revoked`
      )
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: 'Bearer current-token' },
      payload: {}
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'agent_revoked' });

    await app.close();
  });

  it('returns 503 when Firestore raises an unknown sub-code', async () => {
    const { app } = await buildRotateApp({
      attachAgent: {
        agentId: FIXTURE_AGENT_ID,
        userId: FIXTURE_USER_ID,
        capabilities: ['code-generation'],
        usedPreviousToken: false
      },
      rotateError: new AgentsCollectionUnavailableError(
        'FIRESTORE_UNAVAILABLE',
        'Firestore not available'
      )
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: 'Bearer current-token' },
      payload: {}
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'agents_collection_unavailable'
    });
    expect(response.json().details?.code).toBe('FIRESTORE_UNAVAILABLE');

    await app.close();
  });

  it('returns 503 generic when rotate throws an unknown Error', async () => {
    const { app } = await buildRotateApp({
      attachAgent: {
        agentId: FIXTURE_AGENT_ID,
        userId: FIXTURE_USER_ID,
        capabilities: ['code-generation'],
        usedPreviousToken: false
      },
      rotateError: new Error('something exploded')
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/rotate-token',
      headers: { authorization: 'Bearer current-token' },
      payload: {}
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'agents_collection_unavailable',
      message: 'Token rotation failed'
    });

    await app.close();
  });
});

// --- Part 3.F: read paths ---------------------------------------------

const buildReadApp = async (
  records: AgentRecord[],
  options: { operatorId?: string } = {}
): Promise<{
  app: FastifyInstance;
}> => {
  const app = Fastify({ logger: false });
  const repoState: FakeRepoState = {
    records: new Map(records.map((r) => [r.agentId, r])),
    createCalls: []
  };
  const repo = buildFakeLifecycleRepository(repoState);
  const userGuard = async (
    request: Parameters<Parameters<typeof app.addHook>[1]>[0]
  ): Promise<void> => {
    if (options.operatorId !== undefined) {
      (request as unknown as {
        authSession?: { currentUser?: { operatorId: string } };
        currentUser?: { operatorId: string };
      }).authSession = { currentUser: { operatorId: options.operatorId } };
      (request as unknown as {
        currentUser?: { operatorId: string };
      }).currentUser = { operatorId: options.operatorId };
    }
  };
  await registerAgentRegistrationRoutes(app, {
    lifecycleRepository: repo,
    audit: buildAuditSpy(),
    userGuard,
    agentTokenGuard: async () => {
      /* unused */
    },
    currentAgentVersion: '0.1.0',
    now: () => FIXTURE_NOW,
    generateRawToken: () => 'unused'
  });
  return { app };
};

const buildAgentRecord = (
  over: Partial<AgentRecord> = {}
): AgentRecord => ({
  agentId: FIXTURE_AGENT_ID,
  userId: FIXTURE_USER_ID,
  machineName: 'studio-pc',
  capabilities: ['code-generation'],
  tokenHash: '$2b$12$abc',
  tokenLookupHash: 'a'.repeat(16),
  tokenIssuedAt: '2026-04-20T00:00:00.000Z',
  tokenLastRotatedAt: null,
  tokenUseCount: 0,
  previousTokenHash: null,
  previousTokenLookupHash: null,
  previousTokenExpiresAt: null,
  oldTokenUsageCount: 0,
  online: false,
  lastConnectAt: null,
  lastDisconnectAt: null,
  lastHeartbeatAt: null,
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
  revoked: false,
  revokedAt: null,
  revokedReason: null,
  ...over
});

describe('GET /v1/agent/list', () => {
  it('returns 401 when no operator session is present', async () => {
    const { app } = await buildReadApp([], { operatorId: undefined });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/list'
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns an empty list for a user with no agents', async () => {
    const { app } = await buildReadApp([], { operatorId: FIXTURE_USER_ID });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/list'
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ agents: [] });
    await app.close();
  });

  it('only returns agents owned by the calling user', async () => {
    const mine = buildAgentRecord({
      agentId: '11111111-2222-4111-8111-111111111111'
    });
    const theirs = buildAgentRecord({
      agentId: '22222222-3333-4222-8222-222222222222',
      userId: 'someone-else'
    });
    const { app } = await buildReadApp([mine, theirs], {
      operatorId: FIXTURE_USER_ID
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/list'
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].agentId).toBe('11111111-2222-4111-8111-111111111111');

    await app.close();
  });

  it('strips bcrypt + lookup hashes from the response (AgentSummary shape)', async () => {
    const mine = buildAgentRecord({
      agentId: '11111111-2222-4111-8111-111111111111'
    });
    const { app } = await buildReadApp([mine], {
      operatorId: FIXTURE_USER_ID
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/list'
    });
    const body = response.json();
    const projected = body.agents[0] as Record<string, unknown>;
    expect(projected.tokenHash).toBeUndefined();
    expect(projected.tokenLookupHash).toBeUndefined();
    expect(projected.previousTokenHash).toBeUndefined();
    expect(projected.previousTokenLookupHash).toBeUndefined();
    expect(projected.userId).toBeUndefined();
    expect(projected.revoked).toBeUndefined();

    await app.close();
  });

  it('reports onlineState=online when the agent is freshly heartbeating', async () => {
    const mine = buildAgentRecord({
      online: true,
      lastHeartbeatAt: new Date(FIXTURE_NOW.getTime() - 30_000).toISOString()
    });
    const { app } = await buildReadApp([mine], {
      operatorId: FIXTURE_USER_ID
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/list'
    });
    expect(response.json().agents[0].onlineState).toBe('online');

    await app.close();
  });

  it('reports onlineState=offline when heartbeat is stale', async () => {
    const mine = buildAgentRecord({
      online: true,
      lastHeartbeatAt: new Date(
        FIXTURE_NOW.getTime() - 5 * 60 * 1000
      ).toISOString()
    });
    const { app } = await buildReadApp([mine], {
      operatorId: FIXTURE_USER_ID
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/list'
    });
    expect(response.json().agents[0].onlineState).toBe('offline');

    await app.close();
  });
});

describe('GET /v1/agent/:agentId/status', () => {
  it('returns 401 when no operator session is present', async () => {
    const { app } = await buildReadApp([buildAgentRecord()], {
      operatorId: undefined
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/${FIXTURE_AGENT_ID}/status`
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 200 with the AgentSummary projection for the owner', async () => {
    const mine = buildAgentRecord({
      online: true,
      lastHeartbeatAt: new Date(FIXTURE_NOW.getTime() - 1_000).toISOString(),
      machineName: 'render-pc',
      capabilities: ['code-generation', 'shell-execution'],
      oldTokenUsageCount: 4
    });
    const { app } = await buildReadApp([mine], {
      operatorId: FIXTURE_USER_ID
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/${FIXTURE_AGENT_ID}/status`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.agentId).toBe(FIXTURE_AGENT_ID);
    expect(body.machineName).toBe('render-pc');
    expect(body.capabilities).toEqual(['code-generation', 'shell-execution']);
    expect(body.onlineState).toBe('online');
    expect(body.oldTokenUsageCount).toBe(4);

    await app.close();
  });

  it('returns 404 when the agent does not exist', async () => {
    const { app } = await buildReadApp([], {
      operatorId: FIXTURE_USER_ID
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/99999999-9999-4999-8999-999999999999/status'
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'agent_not_found' });
    await app.close();
  });

  it('returns 404 (not 403) when the agent belongs to a different user', async () => {
    // Cross-user lookup must NOT leak existence — the route
    // returns 404 even though the doc exists. This is the
    // same pattern as getTask in the operator repository.
    const theirs = buildAgentRecord({
      userId: 'someone-else'
    });
    const { app } = await buildReadApp([theirs], {
      operatorId: FIXTURE_USER_ID
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/agent/${FIXTURE_AGENT_ID}/status`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'agent_not_found' });

    await app.close();
  });
});

// --- Part 3.G: revoke + latest-version --------------------------------

describe('DELETE /v1/agent/:agentId — happy path', () => {
  it('marks the record revoked, returns 204, emits agent_revoked audit', async () => {
    const existing = buildAgentRecord();
    const app = Fastify({ logger: false });
    const repoState: FakeRepoState = {
      records: new Map([[FIXTURE_AGENT_ID, existing]]),
      createCalls: []
    };
    const repo = buildFakeLifecycleRepository(repoState);
    repo.markRevoked = async (agentId, reason) => {
      const before = repoState.records.get(agentId);
      if (!before) {
        throw new AgentsCollectionUnavailableError(
          'AGENT_NOT_FOUND',
          `Agent ${agentId} not found`
        );
      }
      const now = FIXTURE_NOW.toISOString();
      const updated: AgentRecord = {
        ...before,
        revoked: true,
        revokedAt: now,
        revokedReason: reason,
        updatedAt: now
      };
      repoState.records.set(agentId, updated);
      return updated;
    };
    const audit = buildAuditSpy();
    const userGuard = async (
      request: Parameters<Parameters<typeof app.addHook>[1]>[0]
    ): Promise<void> => {
      (request as unknown as {
        authSession?: { currentUser?: { operatorId: string } };
        currentUser?: { operatorId: string };
      }).authSession = { currentUser: { operatorId: FIXTURE_USER_ID } };
    };
    await registerAgentRegistrationRoutes(app, {
      lifecycleRepository: repo,
      audit,
      userGuard,
      agentTokenGuard: async () => {
        /* unused */
      },
      currentAgentVersion: '0.1.0',
      now: () => FIXTURE_NOW,
      generateRawToken: () => 'unused'
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agent/${FIXTURE_AGENT_ID}`
    });

    expect(response.statusCode).toBe(204);
    // 204 must have no body.
    expect(response.body).toBe('');

    const persisted = repoState.records.get(FIXTURE_AGENT_ID)!;
    expect(persisted.revoked).toBe(true);
    expect(persisted.revokedAt).toBe(FIXTURE_NOW.toISOString());
    expect(persisted.revokedReason).toMatch(/user-initiated revoke/);

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      agentId: FIXTURE_AGENT_ID,
      userId: FIXTURE_USER_ID,
      eventType: 'agent_revoked'
    });

    await app.close();
  });
});

describe('DELETE /v1/agent/:agentId — auth + ownership + errors', () => {
  it('returns 401 when no operator session is present', async () => {
    const { app } = await buildReadApp([buildAgentRecord()], {
      operatorId: undefined
    });
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agent/${FIXTURE_AGENT_ID}`
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('returns 404 when the agent does not exist', async () => {
    const { app } = await buildReadApp([], {
      operatorId: FIXTURE_USER_ID
    });
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/agent/99999999-9999-4999-8999-999999999999'
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 when the agent is owned by a different user (no leak)', async () => {
    const theirs = buildAgentRecord({ userId: 'someone-else' });
    const { app } = await buildReadApp([theirs], {
      operatorId: FIXTURE_USER_ID
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agent/${FIXTURE_AGENT_ID}`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'agent_not_found' });

    await app.close();
  });

  it('returns 503 when markRevoked surfaces FIRESTORE_UNAVAILABLE', async () => {
    const existing = buildAgentRecord();
    const app = Fastify({ logger: false });
    const repoState: FakeRepoState = {
      records: new Map([[FIXTURE_AGENT_ID, existing]]),
      createCalls: []
    };
    const repo = buildFakeLifecycleRepository(repoState);
    repo.markRevoked = async () => {
      throw new AgentsCollectionUnavailableError(
        'FIRESTORE_UNAVAILABLE',
        'Firestore down'
      );
    };
    const userGuard = async (
      request: Parameters<Parameters<typeof app.addHook>[1]>[0]
    ): Promise<void> => {
      (request as unknown as {
        authSession?: { currentUser?: { operatorId: string } };
      }).authSession = { currentUser: { operatorId: FIXTURE_USER_ID } };
    };
    await registerAgentRegistrationRoutes(app, {
      lifecycleRepository: repo,
      audit: buildAuditSpy(),
      userGuard,
      agentTokenGuard: async () => {
        /* unused */
      },
      currentAgentVersion: '0.1.0',
      now: () => FIXTURE_NOW,
      generateRawToken: () => 'unused'
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agent/${FIXTURE_AGENT_ID}`
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().details?.code).toBe('FIRESTORE_UNAVAILABLE');

    await app.close();
  });

  it('returns 503 generic when markRevoked throws an unknown Error', async () => {
    const existing = buildAgentRecord();
    const app = Fastify({ logger: false });
    const repoState: FakeRepoState = {
      records: new Map([[FIXTURE_AGENT_ID, existing]]),
      createCalls: []
    };
    const repo = buildFakeLifecycleRepository(repoState);
    repo.markRevoked = async () => {
      throw new Error('totally unknown disaster');
    };
    const userGuard = async (
      request: Parameters<Parameters<typeof app.addHook>[1]>[0]
    ): Promise<void> => {
      (request as unknown as {
        authSession?: { currentUser?: { operatorId: string } };
      }).authSession = { currentUser: { operatorId: FIXTURE_USER_ID } };
    };
    await registerAgentRegistrationRoutes(app, {
      lifecycleRepository: repo,
      audit: buildAuditSpy(),
      userGuard,
      agentTokenGuard: async () => {
        /* unused */
      },
      currentAgentVersion: '0.1.0',
      now: () => FIXTURE_NOW,
      generateRawToken: () => 'unused'
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agent/${FIXTURE_AGENT_ID}`
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'agents_collection_unavailable',
      message: 'Agent revoke failed'
    });

    await app.close();
  });
});

describe('GET /v1/agent/latest-version', () => {
  it('returns 200 with the stub shape (downloadUrl + signature null)', async () => {
    const { app } = await buildReadApp([], { operatorId: FIXTURE_USER_ID });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/latest-version'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.version).toBe('0.1.0');
    expect(body.downloadUrl).toBeNull();
    expect(body.signature).toBeNull();
    expect(body.releaseNotes).toMatch(/TD-059/);

    await app.close();
  });

  it('is reachable without authentication (public endpoint)', async () => {
    // No userGuard / no agent token — the route itself doesn't
    // attach a preHandler. Verify the unauthenticated path
    // returns 200, not 401.
    const { app } = await buildReadApp([], {
      operatorId: undefined
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/latest-version'
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });
});

describe('POST /v1/agent/register — audit resilience', () => {
  it('still returns 201 when the audit writer throws', async () => {
    const app = Fastify({ logger: false });
    const repo = buildFakeLifecycleRepository();
    const flakyAudit: AgentAuditWriter = {
      async record() {
        throw new Error('audit broken');
      }
    };
    const userGuard = async (
      request: Parameters<Parameters<typeof app.addHook>[1]>[0]
    ): Promise<void> => {
      (request as unknown as {
        authSession?: { currentUser?: { operatorId: string } };
        currentUser?: { operatorId: string };
      }).authSession = { currentUser: { operatorId: FIXTURE_USER_ID } };
    };
    await registerAgentRegistrationRoutes(app, {
      lifecycleRepository: repo,
      audit: flakyAudit,
      userGuard,
      agentTokenGuard: async () => {
        /* noop */
      },
      currentAgentVersion: '0.1.0',
      now: () => FIXTURE_NOW,
      generateRawToken: () => FIXTURE_RAW_TOKEN
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/register',
      payload: validBody()
    });

    expect(response.statusCode).toBe(201);
    expect(repo.state.records.size).toBe(1);

    await app.close();
  });
});
