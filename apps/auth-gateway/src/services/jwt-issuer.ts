import { SignJWT } from 'jose';
import type { AuthGatewayEnv } from '@operator-os/config';
import {
  accessTokenPayloadSchema,
  type AccessTokenPayload,
  type OperatorUser
} from '@operator-os/contracts';

import type { SigningSecretLoader } from '../integrations/signing-secret.js';

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
  payload: AccessTokenPayload;
}

/**
 * Issues HS256 access tokens scoped to the operator-os-api audience.
 */
export class JwtIssuer {
  readonly name = 'jwt-issuer';

  #config: AuthGatewayEnv;
  #secretLoader: SigningSecretLoader;

  constructor(config: AuthGatewayEnv, secretLoader: SigningSecretLoader) {
    this.#config = config;
    this.#secretLoader = secretLoader;
  }

  async issue(
    user: OperatorUser,
    scopes: string[] = [],
    ttlSecondsOverride?: number
  ): Promise<IssuedAccessToken> {
    const secret = await this.#secretLoader.load();
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds =
      ttlSecondsOverride ?? this.#config.AUTH_ACCESS_TOKEN_TTL_SECONDS;
    const exp = now + ttlSeconds;

    const payload = accessTokenPayloadSchema.parse({
      sub: user.id,
      iss: this.#config.AUTH_ACCESS_TOKEN_ISSUER,
      aud: this.#config.AUTH_ACCESS_TOKEN_AUDIENCE,
      iat: now,
      exp,
      scopes,
      plan: user.plan,
      operatorId: user.id,
      email: user.email
    });

    const token = await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .sign(secret);

    return {
      token,
      expiresAt: new Date(exp * 1000),
      payload
    };
  }
}
