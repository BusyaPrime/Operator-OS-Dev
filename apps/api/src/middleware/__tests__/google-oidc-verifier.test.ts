import type { OAuth2Client } from 'google-auth-library';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import {
  GoogleOidcVerifier,
  OidcVerificationError,
  createGoogleOidcGuard
} from '../google-oidc-verifier.js';

const AUDIENCE = 'https://api.example.com';
const ALLOWED_EMAIL =
  'cloudrun-runtime@operator-os-dev.iam.gserviceaccount.com';

const buildPayload = (overrides: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  sub: '1234567890',
  email: ALLOWED_EMAIL,
  email_verified: true,
  aud: AUDIENCE,
  ...overrides
});

interface FakeClient {
  client: OAuth2Client;
  verifyIdToken: ReturnType<typeof vi.fn>;
}

const buildClient = (payload: unknown = buildPayload()): FakeClient => {
  const verifyIdToken = vi.fn().mockResolvedValue({
    getPayload: () => payload
  });
  return {
    client: { verifyIdToken } as unknown as OAuth2Client,
    verifyIdToken
  };
};

const buildVerifier = (
  opts: {
    client?: OAuth2Client;
    allowedEmails?: ReadonlySet<string>;
  } = {}
): GoogleOidcVerifier => {
  const fakeClient = opts.client ?? buildClient().client;
  return new GoogleOidcVerifier({
    audience: AUDIENCE,
    allowedEmails: opts.allowedEmails ?? new Set([ALLOWED_EMAIL]),
    oauthClient: fakeClient
  });
};

interface Captured {
  statusCode?: number;
  body?: unknown;
}

const buildReply = (captured: Captured): FastifyReply => {
  const reply: Record<string, unknown> = {};
  reply.code = (n: number) => {
    captured.statusCode = n;
    return reply;
  };
  reply.send = (body: unknown) => {
    captured.body = body;
    return reply;
  };
  return reply as unknown as FastifyReply;
};

const buildRequest = (authorization?: string): FastifyRequest => {
  const log = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  };
  return {
    headers: authorization === undefined ? {} : { authorization },
    log
  } as unknown as FastifyRequest;
};

describe('GoogleOidcVerifier.verify', () => {
  it('returns identity for a valid token', async () => {
    const fake = buildClient();
    const verifier = buildVerifier({ client: fake.client });

    const identity = await verifier.verify('valid-token');

    expect(fake.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: AUDIENCE
    });
    expect(identity.subject).toBe('1234567890');
    expect(identity.email).toBe(ALLOWED_EMAIL);
    expect(identity.audience).toBe(AUDIENCE);
  });

  it('rejects untrusted issuer', async () => {
    const fake = buildClient(
      buildPayload({ iss: 'https://evil.example.com' })
    );
    const verifier = buildVerifier({ client: fake.client });

    await expect(verifier.verify('bad-iss')).rejects.toThrow(
      OidcVerificationError
    );
  });

  it('rejects unverified email', async () => {
    const fake = buildClient(buildPayload({ email_verified: false }));
    const verifier = buildVerifier({ client: fake.client });

    await expect(verifier.verify('unverified')).rejects.toThrow(
      OidcVerificationError
    );
  });

  it('rejects mismatched audience', async () => {
    const fake = buildClient(buildPayload({ aud: 'https://other.example.com' }));
    const verifier = buildVerifier({ client: fake.client });

    await expect(verifier.verify('wrong-aud')).rejects.toThrow(
      OidcVerificationError
    );
  });
});

describe('createGoogleOidcGuard', () => {
  it('attaches oidcIdentity on valid token + allowed email', async () => {
    const fake = buildClient();
    const verifier = buildVerifier({ client: fake.client });
    const guard = createGoogleOidcGuard(verifier);
    const request = buildRequest('Bearer valid-token');
    const captured: Captured = {};

    await guard(request, buildReply(captured));

    expect(captured.statusCode).toBeUndefined();
    expect(request.oidcIdentity?.email).toBe(ALLOWED_EMAIL);
  });

  it('returns 401 when bearer header is missing', async () => {
    const verifier = buildVerifier();
    const guard = createGoogleOidcGuard(verifier);
    const request = buildRequest(undefined);
    const captured: Captured = {};

    await guard(request, buildReply(captured));

    expect(captured.statusCode).toBe(401);
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const verifier = buildVerifier();
    const guard = createGoogleOidcGuard(verifier);
    const request = buildRequest('Basic QWxhZGRpbjpPcGVuU2VzYW1l');
    const captured: Captured = {};

    await guard(request, buildReply(captured));

    expect(captured.statusCode).toBe(401);
  });

  it('returns 401 when OAuth2Client.verifyIdToken throws', async () => {
    const verifyIdToken = vi.fn().mockRejectedValue(new Error('boom'));
    const client = { verifyIdToken } as unknown as OAuth2Client;
    const verifier = buildVerifier({ client });
    const guard = createGoogleOidcGuard(verifier);
    const request = buildRequest('Bearer boom-token');
    const captured: Captured = {};

    await guard(request, buildReply(captured));

    expect(captured.statusCode).toBe(401);
    expect(request.oidcIdentity).toBeUndefined();
  });

  it('returns 403 when email is not in allowlist', async () => {
    const fake = buildClient(buildPayload({ email: 'other@example.com' }));
    const verifier = buildVerifier({ client: fake.client });
    const guard = createGoogleOidcGuard(verifier);
    const request = buildRequest('Bearer other-email-token');
    const captured: Captured = {};

    await guard(request, buildReply(captured));

    expect(captured.statusCode).toBe(403);
    expect(request.oidcIdentity).toBeUndefined();
  });
});
