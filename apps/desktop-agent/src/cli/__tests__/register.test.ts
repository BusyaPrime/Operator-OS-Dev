import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryCredentialStore,
  AGENT_TOKEN_TARGET
} from '../../auth/credential-store.js';
import { runRegisterCli, type RegisterCliIo } from '../register.js';

const FIXTURE_AGENT_ID = 'c5d8b6f0-9ec5-4c7f-8d1a-3a2b1c4d5e6f';
const FIXTURE_USER_ID = 'integration-user-akmal';
const FIXTURE_TOKEN = 'opaque-base64url-token-bytes';

const validJwt = (payload: Record<string, unknown> = {}): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      sub: FIXTURE_USER_ID,
      operatorId: FIXTURE_USER_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payload
    })
  ).toString('base64url');
  const sig = Buffer.from('fake-sig').toString('base64url');
  return `${header}.${body}.${sig}`;
};

const buildIo = (
  inputs: ReadonlyArray<string>
): RegisterCliIo & {
  out: string[];
  err: string[];
  consumed: number;
} => {
  const out: string[] = [];
  const err: string[] = [];
  let i = 0;
  return {
    out,
    err,
    get consumed() {
      return i;
    },
    async readLine() {
      if (i >= inputs.length) return '';
      return inputs[i++]!;
    },
    writeLine(line) {
      out.push(line);
    },
    writeErrLine(line) {
      err.push(line);
    }
  };
};

const buildFetchStub = (
  fixtures: {
    register?: { status: number; body: unknown };
    status?: { status: number; body: unknown };
  } = {}
): typeof globalThis.fetch & { calls: Array<{ url: string; init?: RequestInit }> } => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (
    url: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const urlString = typeof url === 'string' ? url : url.toString();
    calls.push({ url: urlString, init });
    if (urlString.endsWith('/v1/agent/register')) {
      const fx = fixtures.register ?? {
        status: 201,
        body: {
          agentId: FIXTURE_AGENT_ID,
          agentToken: FIXTURE_TOKEN,
          tokenIssuedAt: '2026-04-28T12:00:00.000Z'
        }
      };
      return new Response(JSON.stringify(fx.body), {
        status: fx.status,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (urlString.endsWith(`/v1/agent/${FIXTURE_AGENT_ID}/status`)) {
      const fx = fixtures.status ?? {
        status: 200,
        body: {
          agentId: FIXTURE_AGENT_ID,
          machineName: 'host',
          capabilities: ['code-generation'],
          onlineState: 'offline',
          lastHeartbeatAt: null,
          lastConnectAt: null,
          lastDisconnectAt: null,
          createdAt: '2026-04-28T12:00:00.000Z',
          oldTokenUsageCount: 0
        }
      };
      return new Response(JSON.stringify(fx.body), {
        status: fx.status,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch & {
    calls: Array<{ url: string; init?: RequestInit }>;
  };
  Object.defineProperty(fn, 'calls', { value: calls });
  return fn;
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runRegisterCli — happy path', () => {
  it('runs end-to-end and stores the token', async () => {
    const io = buildIo([
      '', // accept default backend URL
      validJwt() // user JWT
    ]);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'studio-pc',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: async () => ({
        path: '/fake/path',
        expiresInSeconds: 3600,
        ok: true
      })
    });

    expect(result.exitCode).toBe(0);
    expect(result.agentId).toBe(FIXTURE_AGENT_ID);
    expect(await store.getToken(AGENT_TOKEN_TARGET)).toBe(FIXTURE_TOKEN);
    // Both endpoints called with the expected method.
    expect(fetchStub.calls.map((c) => c.url)).toEqual([
      'http://localhost:8080/v1/agent/register',
      `http://localhost:8080/v1/agent/${FIXTURE_AGENT_ID}/status`
    ]);
    // Output communicates success.
    expect(io.out.some((line) => line.includes('Done.'))).toBe(true);
  });

  it('strips trailing slash on the API URL the user pasted', async () => {
    const io = buildIo([
      'https://api.example.com/', // trailing slash
      validJwt()
    ]);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'studio-pc',
      env: {},
      maxSessionPreflight: false
    });

    expect(fetchStub.calls[0]!.url).toBe(
      'https://api.example.com/v1/agent/register'
    );
  });

  it('normalises a hostname with non-ASCII chars + spaces', async () => {
    const io = buildIo(['', validJwt()]);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'студия 100% хост',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });

    const registerCall = fetchStub.calls[0]!;
    const body = JSON.parse(String(registerCall.init?.body));
    // Non-ASCII becomes '-', spaces become '-', collapse runs.
    expect(body.machineName).toMatch(/^[\x20-\x7E]+$/);
    expect(body.machineName).not.toMatch(/-{2,}/);
  });
});

describe('runRegisterCli — pre-flight failures', () => {
  it('aborts with exit 1 when the Max-session preflight fails', async () => {
    const io = buildIo(['']);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      env: {},
      maxSessionPreflight: async () => {
        throw new Error('No claudeAiOauth in credentials.json');
      }
    });

    expect(result.exitCode).toBe(1);
    expect(io.err.some((line) => line.includes('Claude Max OAuth'))).toBe(true);
    expect(fetchStub.calls).toHaveLength(0);
  });

  it('warns (but proceeds) when the OAuth token expires within 24h', async () => {
    const io = buildIo(['', validJwt()]);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'host',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: async () => ({
        path: '/fake/path',
        expiresInSeconds: 60 * 60, // 1h
        ok: true
      })
    });

    expect(result.exitCode).toBe(0);
    expect(
      io.out.some((line) => line.includes('expires in') && line.includes('m'))
    ).toBe(true);
  });
});

describe('runRegisterCli — input validation', () => {
  it('rejects a malformed API URL', async () => {
    const io = buildIo(['ftp://nope']);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      env: {},
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(
      io.err.some((line) => line.includes('http:// or https://'))
    ).toBe(true);
  });

  it('rejects a non-JWT-shaped value pasted as the user JWT', async () => {
    const io = buildIo(['', 'this-is-not-a-jwt']);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(
      io.err.some((line) => line.includes('does not look like a JWT'))
    ).toBe(true);
  });

  it('rejects a JWT whose payload does not parse as JSON', async () => {
    const io = buildIo([
      '',
      // header.bogus-base64-but-not-json.sig
      `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from('not-json').toString('base64url')}.sig`
    ]);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(io.err.some((line) => line.includes('did not parse'))).toBe(true);
  });

  it('rejects an expired JWT', async () => {
    const io = buildIo([
      '',
      validJwt({ exp: Math.floor(Date.now() / 1000) - 60 })
    ]);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(io.err.some((line) => line.includes('expired'))).toBe(true);
  });

  it('rejects a JWT without operatorId or sub', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString(
      'base64url'
    );
    const body = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString(
      'base64url'
    );
    const jwt = `${header}.${body}.sig`;

    const io = buildIo(['', jwt]);
    const fetchStub = buildFetchStub();
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(io.err.some((line) => line.includes('operatorId'))).toBe(true);
  });
});

describe('runRegisterCli — api failures', () => {
  it('surfaces register failure with the response body', async () => {
    const io = buildIo(['', validJwt()]);
    const fetchStub = buildFetchStub({
      register: {
        status: 409,
        body: { code: 'agent_id_taken', message: 'taken' }
      }
    });
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'host',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(io.err.some((line) => line.includes('returned 409'))).toBe(true);
    expect(await store.getToken(AGENT_TOKEN_TARGET)).toBeNull();
  });

  it('surfaces register network failure', async () => {
    const io = buildIo(['', validJwt()]);
    const failingFetch: typeof globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: failingFetch,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'host',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(io.err.some((line) => line.includes('errored'))).toBe(true);
    expect(await store.getToken(AGENT_TOKEN_TARGET)).toBeNull();
  });

  it('reports a credential store failure (token not stored)', async () => {
    const io = buildIo(['', validJwt()]);
    const fetchStub = buildFetchStub();
    const flakyStore = {
      async storeToken() {
        throw new Error('disk full');
      },
      async getToken() {
        return null;
      },
      async deleteToken() {
        /* noop */
      }
    };

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: flakyStore,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'host',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(
      io.err.some((line) => line.includes('Credential Manager'))
    ).toBe(true);
  });

  it('fails the self-test when status returns the wrong agentId', async () => {
    const io = buildIo(['', validJwt()]);
    const fetchStub = buildFetchStub({
      status: {
        status: 200,
        body: { agentId: 'completely-different-id' }
      }
    });
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'host',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(
      io.err.some((line) => line.includes('did not match'))
    ).toBe(true);
    // Token was stored before the self-test ran.
    expect(await store.getToken(AGENT_TOKEN_TARGET)).toBe(FIXTURE_TOKEN);
  });

  it('fails the self-test when status returns 401/404', async () => {
    const io = buildIo(['', validJwt()]);
    const fetchStub = buildFetchStub({
      status: { status: 404, body: { code: 'agent_not_found' } }
    });
    const store = new InMemoryCredentialStore();

    const result = await runRegisterCli({
      io,
      fetch: fetchStub,
      credentialStore: store,
      makeAgentId: () => FIXTURE_AGENT_ID,
      readHostname: () => 'host',
      env: { API_BASE_URL: 'http://localhost:8080' },
      maxSessionPreflight: false
    });
    expect(result.exitCode).toBe(1);
    expect(
      io.err.some((line) => line.includes('returned 404'))
    ).toBe(true);
  });
});
