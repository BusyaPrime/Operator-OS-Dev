import { parseApiEnv } from '@operator-os/config';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';

const nowIso = () => new Date().toISOString();

const buildCommandPayload = () => ({
  queue: 'commands' as const,
  requestedAt: nowIso(),
  command: {
    id: 'cmd-test-1',
    type: 'custom' as const,
    status: 'approved' as const,
    deviceId: 'dev-test-1',
    operatorId: 'op-test-1',
    approvalRequired: false,
    payload: {},
    createdAt: nowIso()
  }
});

const buildApprovalPayload = () => ({
  queue: 'approvals' as const,
  requestedAt: nowIso(),
  commandId: 'cmd-test-1',
  operatorId: 'op-test-1',
  metadata: {}
});

const buildExportPayload = () => ({
  queue: 'exports' as const,
  requestedAt: nowIso(),
  exportJob: {
    id: 'export-test-1',
    type: 'artifact-bundle' as const,
    status: 'queued' as const,
    destinationBucket: 'operator-os-dev-exports',
    requestedAt: nowIso(),
    metadata: {}
  }
});

describe('/internal/tasks/*', () => {
  it('accepts a valid command queue payload and returns 204', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/tasks/commands',
      payload: buildCommandPayload()
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    await app.close();
  });

  it('accepts a valid approval queue payload and returns 204', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/tasks/approvals',
      payload: buildApprovalPayload()
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    await app.close();
  });

  it('accepts a valid export queue payload and returns 204', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/tasks/exports',
      payload: buildExportPayload()
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');

    await app.close();
  });

  it('rejects a command queue payload with a wrong queue discriminator', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/tasks/commands',
      payload: {
        ...buildCommandPayload(),
        queue: 'approvals'
      }
    });

    expect(response.statusCode).not.toBe(204);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });

  it('rejects a command queue payload with a missing command field', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/tasks/commands',
      payload: {
        queue: 'commands',
        requestedAt: nowIso()
      }
    });

    expect(response.statusCode).not.toBe(204);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });

  it('rejects an export queue payload with a missing exportJob field', async () => {
    const app = buildServer(parseApiEnv({}));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/tasks/exports',
      payload: {
        queue: 'exports',
        requestedAt: nowIso()
      }
    });

    expect(response.statusCode).not.toBe(204);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });
});
