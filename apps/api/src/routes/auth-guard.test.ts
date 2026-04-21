import { parseApiEnv } from '@operator-os/config';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';

describe('required auth on /v1/ai/*', () => {
  it('rejects POST /v1/ai/summarize/operator-state without a bearer token', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ai/summarize/operator-state',
      payload: { state: 'probe' }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toMatch(
      /firebase id token is required/i
    );

    await app.close();
  });

  it('rejects POST /v1/ai/plan-task-breakdown without a bearer token', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/ai/plan-task-breakdown',
      payload: { task: 'probe' }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });
});

describe('required auth on /v1/agent/*', () => {
  it('rejects POST /v1/agent/heartbeat without a bearer token', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat',
      payload: {
        deviceId: 'dev-probe',
        displayName: 'probe',
        platform: 'linux',
        runtimeStatus: 'ready',
        agentVersion: '0.0.1'
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toMatch(
      /firebase id token or a google oidc id token is required/i
    );

    await app.close();
  });

  it('rejects GET /v1/agent/commands without a bearer token', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/agent/commands?deviceId=dev-probe'
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('rejects a malformed Authorization header', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/heartbeat',
      headers: {
        authorization: 'Token garbage'
      },
      payload: {
        deviceId: 'dev-probe',
        displayName: 'probe',
        platform: 'linux',
        runtimeStatus: 'ready',
        agentVersion: '0.0.1'
      }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });
});

describe('/v1/commands and /v1/sessions stay on the agent guard', () => {
  it('rejects POST /v1/commands without a bearer token', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/commands',
      payload: {}
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });
});
