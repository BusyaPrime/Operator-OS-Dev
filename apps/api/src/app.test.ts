import { parseApiEnv } from '@operator-os/config';
import { describe, expect, it } from 'vitest';

import { buildServer } from './app.js';

describe('@operator-os/api', () => {
  it('returns health status', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');

    await app.close();
  });

  it('returns readiness details', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'GET',
      url: '/ready'
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('degraded');
    expect(response.json().checks.length).toBeGreaterThan(1);

    await app.close();
  });

  it('returns a dashboard payload with controlled fallback state', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operator/dashboard'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().operatorState.dataSource).toBe('bootstrap-fallback');
    expect(response.json().auth.authenticated).toBe(false);

    await app.close();
  });
});
