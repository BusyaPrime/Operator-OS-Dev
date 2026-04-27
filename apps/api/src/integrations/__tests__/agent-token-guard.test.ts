import bcrypt from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRecord } from '@operator-os/contracts';

import {
  createAgentTokenGuard,
  type AgentAuditWriter,
  type AgentAuthEvent,
  type AgentRecordRepository,
  type AuthenticatedAgent
} from '../agent-token-guard.js';

const FIXTURE_AGENT_ID = 'c5d8b6f0-9ec5-4c7f-8d1a-3a2b1c4d5e6f';
const FIXTURE_USER_ID = 'user-akmal';
const FIXTURE_NOW = new Date('2026-04-27T12:00:00Z').getTime();

const tokenLookupHashFor = async (rawToken: string): Promise<string> => {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(rawToken).digest('hex').slice(0, 16);
};

const buildRecord = async (
  rawToken: string,
  overrides: Partial<AgentRecord> = {}
): Promise<AgentRecord> => {
  const tokenHash = await bcrypt.hash(rawToken, 4); // low cost for fast tests
  const tokenLookupHash = await tokenLookupHashFor(rawToken);
  return {
    agentId: FIXTURE_AGENT_ID,
    userId: FIXTURE_USER_ID,
    machineName: 'studio-pc',
    capabilities: ['code-generation'],
    tokenHash,
    tokenLookupHash,
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
    ...overrides
  };
};

const buildRepo = (
  initialRecords: ReadonlyArray<AgentRecord> = []
): AgentRecordRepository & {
  candidatesCalls: number;
  lastLookupHash: string | undefined;
  incrementCalls: string[];
  records: AgentRecord[];
} => {
  const records: AgentRecord[] = [...initialRecords];
  const incrementCalls: string[] = [];
  let candidatesCalls = 0;
  let lastLookupHash: string | undefined;
  return {
    records,
    incrementCalls,
    get candidatesCalls() {
      return candidatesCalls;
    },
    get lastLookupHash() {
      return lastLookupHash;
    },
    async findCandidatesByTokenLookup(lookupHash: string) {
      candidatesCalls += 1;
      lastLookupHash = lookupHash;
      // Filter to records whose current OR previous lookup matches.
      return records.filter(
        (r) =>
          r.tokenLookupHash === lookupHash ||
          r.previousTokenLookupHash === lookupHash
      );
    },
    async incrementOldTokenUsage(agentId: string) {
      incrementCalls.push(agentId);
    }
  };
};

const buildAuditSpy = (): AgentAuditWriter & { events: AgentAuthEvent[] } => {
  const events: AgentAuthEvent[] = [];
  return {
    events,
    async record(e) {
      events.push(e);
    }
  };
};

interface TestApp {
  app: FastifyInstance;
  inject: FastifyInstance['inject'];
  protectedAgent: { agent?: AuthenticatedAgent };
}

const buildApp = (
  options: Parameters<typeof createAgentTokenGuard>[0]
): TestApp => {
  const app = Fastify({ logger: false });
  const protectedAgent: { agent?: AuthenticatedAgent } = {};
  app.get('/protected', { preHandler: createAgentTokenGuard(options).preHandler }, async (request, reply) => {
    protectedAgent.agent = request.agent;
    return reply.send({ ok: true });
  });
  return { app, inject: app.inject.bind(app), protectedAgent };
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  vi.clearAllMocks();
});

describe('agentTokenGuard — bearer extraction', () => {
  it('rejects missing Authorization header with 401', async () => {
    const repo = buildRepo();
    const audit = buildAuditSpy();
    const { app } = buildApp({ repository: repo, audit });

    const response = await app.inject({ method: 'GET', url: '/protected' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      message: expect.stringMatching(/Agent token required/)
    });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]!.eventType).toBe('auth_failed_no_token');

    await app.close();
  });

  it('rejects non-Bearer scheme with 401 + no_token audit', async () => {
    const repo = buildRepo();
    const audit = buildAuditSpy();
    const { app } = buildApp({ repository: repo, audit });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' }
    });
    expect(response.statusCode).toBe(401);
    expect(audit.events[0]!.eventType).toBe('auth_failed_no_token');

    await app.close();
  });

  it('rejects "Bearer" with empty token', async () => {
    const repo = buildRepo();
    const audit = buildAuditSpy();
    const { app } = buildApp({ repository: repo, audit });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer    ' }
    });
    expect(response.statusCode).toBe(401);
    expect(audit.events[0]!.eventType).toBe('auth_failed_no_token');

    await app.close();
  });
});

describe('agentTokenGuard — happy path (current hash)', () => {
  it('accepts a valid token and attaches request.agent', async () => {
    const token = 'AAAAAAAA-real-current-token-bytes-base64url';
    const record = await buildRecord(token);
    const repo = buildRepo([record]);
    const audit = buildAuditSpy();
    const { app, protectedAgent } = buildApp({ repository: repo, audit });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    expect(protectedAgent.agent).toMatchObject({
      agentId: FIXTURE_AGENT_ID,
      userId: FIXTURE_USER_ID,
      capabilities: ['code-generation'],
      usedPreviousToken: false
    });
    expect(response.headers['x-token-rotation-recommended']).toBeUndefined();

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]!.eventType).toBe('auth_success');
    expect(audit.events[0]!.agentId).toBe(FIXTURE_AGENT_ID);

    await app.close();
  });

  it('cache hit on second request avoids re-bcrypt + skips repo lookup', async () => {
    const token = 'BBBBBBBB-cached-token-bytes-base64url';
    const record = await buildRecord(token);
    const repo = buildRepo([record]);
    const { app } = buildApp({ repository: repo });

    await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(repo.candidatesCalls).toBe(1);

    const second = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(second.statusCode).toBe(200);
    // Cache hit: no repo re-query.
    expect(repo.candidatesCalls).toBe(1);

    await app.close();
  });
});

describe('agentTokenGuard — overlap window (previous hash)', () => {
  it('accepts a previous-hash match within the overlap window and sets X-Token-Rotation-Recommended', async () => {
    const previousToken = 'CCCCCCCC-old-token-pre-rotation';
    const newToken = 'DDDDDDDD-new-token-post-rotation';
    const previousTokenHash = await bcrypt.hash(previousToken, 4);
    const previousTokenLookupHash = await tokenLookupHashFor(previousToken);
    const record = await buildRecord(newToken, {
      previousTokenHash,
      previousTokenLookupHash,
      previousTokenExpiresAt: new Date(
        FIXTURE_NOW + 60 * 60 * 1000 // expires in 1h
      ).toISOString()
    });
    const repo = buildRepo([record]);
    const audit = buildAuditSpy();
    const { app } = buildApp({
      repository: repo,
      audit,
      now: () => FIXTURE_NOW
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${previousToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-token-rotation-recommended']).toBe('true');

    // oldTokenUsageCount metric incremented.
    expect(repo.incrementCalls).toEqual([FIXTURE_AGENT_ID]);

    // Audit recorded with the right event type.
    expect(audit.events[0]!.eventType).toBe('auth_success_previous_hash');

    await app.close();
  });

  it('rejects a previous-hash match if the overlap window has expired', async () => {
    const previousToken = 'EEEEEEEE-stale-old-token';
    const newToken = 'FFFFFFFF-active-token';
    const previousTokenHash = await bcrypt.hash(previousToken, 4);
    const previousTokenLookupHash = await tokenLookupHashFor(previousToken);
    const record = await buildRecord(newToken, {
      previousTokenHash,
      previousTokenLookupHash,
      previousTokenExpiresAt: new Date(
        FIXTURE_NOW - 1000 // expired 1 sec ago
      ).toISOString()
    });
    const repo = buildRepo([record]);
    const audit = buildAuditSpy();
    const { app } = buildApp({
      repository: repo,
      audit,
      now: () => FIXTURE_NOW
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${previousToken}` }
    });
    expect(response.statusCode).toBe(401);
    expect(repo.incrementCalls).toEqual([]);
    expect(audit.events[0]!.eventType).toBe('auth_failed_no_match');

    await app.close();
  });

  it('does not set rotation header when the current hash matches', async () => {
    const previousToken = 'GGGGGGGG-old-token';
    const newToken = 'HHHHHHHH-new-token';
    const previousTokenHash = await bcrypt.hash(previousToken, 4);
    const previousTokenLookupHash = await tokenLookupHashFor(previousToken);
    const record = await buildRecord(newToken, {
      previousTokenHash,
      previousTokenLookupHash,
      previousTokenExpiresAt: new Date(
        FIXTURE_NOW + 60 * 60 * 1000
      ).toISOString()
    });
    const repo = buildRepo([record]);
    const { app } = buildApp({
      repository: repo,
      now: () => FIXTURE_NOW
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${newToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-token-rotation-recommended']).toBeUndefined();
    expect(repo.incrementCalls).toEqual([]);

    await app.close();
  });
});

describe('agentTokenGuard — revocation', () => {
  it('rejects a revoked record even if the bcrypt would otherwise match', async () => {
    const token = 'IIIIIIII-revoked-token';
    const record = await buildRecord(token, {
      revoked: true,
      revokedAt: new Date(FIXTURE_NOW - 1000).toISOString(),
      revokedReason: 'user-initiated'
    });
    const repo = buildRepo([record]);
    const audit = buildAuditSpy();
    const { app } = buildApp({ repository: repo, audit });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(401);
    expect(
      audit.events.some((e) => e.eventType === 'auth_failed_revoked')
    ).toBe(true);

    await app.close();
  });
});

describe('agentTokenGuard — repo returns no candidates', () => {
  it('returns 401 with auth_failed_unknown_token audit', async () => {
    const repo = buildRepo([]);
    const audit = buildAuditSpy();
    const { app } = buildApp({ repository: repo, audit });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer JJJJJJJJ-no-such-token' }
    });
    expect(response.statusCode).toBe(401);
    expect(audit.events[0]!.eventType).toBe('auth_failed_unknown_token');

    await app.close();
  });
});

describe('agentTokenGuard — lookup-hash routing', () => {
  it('passes the sha256(token).slice(0,16) lookup hash to the repository', async () => {
    const token = 'KKKKKKKK-routed-token';
    const expectedLookup = await tokenLookupHashFor(token);
    const record = await buildRecord(token);
    const repo = buildRepo([record]);
    const { app } = buildApp({ repository: repo });

    await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(repo.lastLookupHash).toBe(expectedLookup);
    expect(repo.lastLookupHash).toHaveLength(16);

    await app.close();
  });

  it('finds the right record when the repository returns multiple candidates', async () => {
    const tokenA = 'AAAAAAAA-routed-A';
    const tokenB = 'BBBBBBBB-routed-B';
    const recordA = await buildRecord(tokenA, {
      agentId: '11111111-1111-4111-8111-111111111111'
    });
    const recordB = await buildRecord(tokenB, {
      agentId: '22222222-2222-4222-8222-222222222222'
    });
    // Mock repo that ignores the lookup hash and returns BOTH
    // candidates — simulates the rare collision case the bcrypt
    // step is supposed to disambiguate.
    const repo: AgentRecordRepository = {
      async findCandidatesByTokenLookup() {
        return [recordA, recordB];
      },
      async incrementOldTokenUsage() {
        /* noop */
      }
    };
    const { app, protectedAgent } = buildApp({ repository: repo });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${tokenB}` }
    });
    expect(response.statusCode).toBe(200);
    expect(protectedAgent.agent?.agentId).toBe(
      '22222222-2222-4222-8222-222222222222'
    );

    await app.close();
  });
});

describe('agentTokenGuard — audit failures do not break auth', () => {
  it('rejects a bad token even if the audit writer throws', async () => {
    const repo = buildRepo([]);
    const audit: AgentAuditWriter = {
      async record() {
        throw new Error('BigQuery temporarily unavailable');
      }
    };
    const { app } = buildApp({ repository: repo, audit });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer LLLLLLLL-no-such' }
    });
    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('accepts a good token even if the audit writer throws', async () => {
    const token = 'MMMMMMMM-real-token-audit-broken';
    const record = await buildRecord(token);
    const repo = buildRepo([record]);
    const audit: AgentAuditWriter = {
      async record() {
        throw new Error('audit broken');
      }
    };
    const { app, protectedAgent } = buildApp({ repository: repo, audit });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    expect(protectedAgent.agent?.agentId).toBe(FIXTURE_AGENT_ID);

    await app.close();
  });
});

describe('agentTokenGuard — increment failure does not break auth', () => {
  it('still 200s the request when incrementOldTokenUsage rejects', async () => {
    const previousToken = 'NNNNNNNN-old-tok';
    const newToken = 'OOOOOOOO-new-tok';
    const previousTokenHash = await bcrypt.hash(previousToken, 4);
    const previousTokenLookupHash = await tokenLookupHashFor(previousToken);
    const record = await buildRecord(newToken, {
      previousTokenHash,
      previousTokenLookupHash,
      previousTokenExpiresAt: new Date(
        FIXTURE_NOW + 60 * 60 * 1000
      ).toISOString()
    });
    const repo: AgentRecordRepository = {
      async findCandidatesByTokenLookup() {
        return [record];
      },
      async incrementOldTokenUsage() {
        throw new Error('Firestore down');
      }
    };
    const { app } = buildApp({
      repository: repo,
      now: () => FIXTURE_NOW
    });

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${previousToken}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-token-rotation-recommended']).toBe('true');

    await app.close();
  });
});
