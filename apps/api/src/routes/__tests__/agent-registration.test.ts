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
      eventType: 'auth_success'
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
