import { parseAuthGatewayEnv } from '@operator-os/config';
import { describe, expect, it } from 'vitest';

import { buildServer } from './app.js';

describe('@operator-os/auth-gateway', () => {
  it('returns health status', async () => {
    const app = buildServer(parseAuthGatewayEnv({}));

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(response.json().service).toBe('operator-auth-gateway');

    await app.close();
  });

  it('returns ready status when no module checks register degraded state', async () => {
    const app = buildServer(parseAuthGatewayEnv({}));

    const response = await app.inject({
      method: 'GET',
      url: '/ready'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ready');
    expect(response.json().checks.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });
});
