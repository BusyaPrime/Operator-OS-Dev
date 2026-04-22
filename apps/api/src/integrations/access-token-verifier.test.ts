import { parseApiEnv } from '@operator-os/config';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';

import { AccessTokenVerifier } from './access-token-verifier.js';
import { AccessTokenSecretLoader } from './signing-secret.js';
import { IntegrationError } from './runtime.js';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  level: 'info',
  silent: () => {}
} as unknown as FastifyBaseLogger;

const LITERAL = 'a-very-secret-shared-between-auth-gateway-and-operator-api';

const buildSetup = () => {
  const config = parseApiEnv({
    AUTH_JWT_SIGNING_SECRET_LITERAL: LITERAL,
    AUTH_ACCESS_TOKEN_ISSUER: 'operator-auth-gateway',
    AUTH_ACCESS_TOKEN_AUDIENCE: 'operator-os-api'
  });
  const loader = new AccessTokenSecretLoader(config, noopLogger);
  const verifier = new AccessTokenVerifier(config, noopLogger, loader);
  return { config, verifier };
};

const mintToken = async (
  overrides: {
    sub?: string;
    iss?: string;
    aud?: string;
    scopes?: string[];
    plan?: 'free' | 'pro' | 'team' | 'enterprise';
    operatorId?: string;
    email?: string;
    ttlSeconds?: number;
  } = {}
) => {
  const secret = new TextEncoder().encode(LITERAL);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (overrides.ttlSeconds ?? 3600);

  return new SignJWT({
    sub: overrides.sub ?? 'user-token-1',
    iss: overrides.iss ?? 'operator-auth-gateway',
    aud: overrides.aud ?? 'operator-os-api',
    iat: now,
    exp,
    scopes: overrides.scopes ?? ['user:read'],
    plan: overrides.plan ?? 'free',
    operatorId: overrides.operatorId ?? 'user-token-1',
    email: overrides.email ?? 'founder@example.com'
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .sign(secret);
};

describe('AccessTokenVerifier', () => {
  it('accepts a valid HS256 access token', async () => {
    const { verifier } = buildSetup();
    const token = await mintToken();

    const context = await verifier.verify(token);

    expect(context.uid).toBe('user-token-1');
    expect(context.operatorId).toBe('user-token-1');
    expect(context.email).toBe('founder@example.com');
    expect(context.source).toBe('operator-access-token');
    expect(context.kind).toBe('user');
  });

  it('rejects a token signed with a different secret', async () => {
    const { verifier } = buildSetup();
    const wrongSecret = new TextEncoder().encode('some-other-secret');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: 'user-1',
      iss: 'operator-auth-gateway',
      aud: 'operator-os-api',
      iat: now,
      exp: now + 3600,
      operatorId: 'user-1',
      email: 'x@example.com'
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(wrongSecret);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(IntegrationError);
  });

  it('rejects a token whose issuer does not match', async () => {
    const { verifier } = buildSetup();
    const token = await mintToken({ iss: 'someone-else' });

    await expect(verifier.verify(token)).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it('rejects a token whose audience does not match', async () => {
    const { verifier } = buildSetup();
    const token = await mintToken({ aud: 'some-other-audience' });

    await expect(verifier.verify(token)).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it('rejects an expired token', async () => {
    const { verifier } = buildSetup();
    const token = await mintToken({ ttlSeconds: -10 });

    await expect(verifier.verify(token)).rejects.toMatchObject({
      statusCode: 401
    });
  });

  it('rejects a malformed token string', async () => {
    const { verifier } = buildSetup();

    await expect(verifier.verify('not.a.jwt.token')).rejects.toBeInstanceOf(
      IntegrationError
    );
  });
});
