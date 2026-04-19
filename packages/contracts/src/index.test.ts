import { describe, expect, it } from 'vitest';

import {
  authSessionSchema,
  commandQueuePayloadSchema,
  commandSchema,
  deviceStateSchema,
  healthResponseSchema,
  operatorStateSchema
} from './index.js';

describe('@operator-os/contracts', () => {
  it('parses a health response payload', () => {
    const health = healthResponseSchema.parse({
      status: 'ready',
      service: 'operator-os-api',
      version: '0.1.0',
      environment: 'development',
      timestamp: '2026-04-19T10:00:00.000Z',
      checks: [{ name: 'firestore', status: 'not_configured' }]
    });

    expect(health.status).toBe('ready');
    expect(health.checks).toHaveLength(1);
  });

  it('parses a command payload with metadata', () => {
    const command = commandSchema.parse({
      id: 'cmd-1',
      type: 'start_session',
      status: 'pending',
      deviceId: 'device-1',
      operatorId: 'operator-1',
      approvalRequired: true,
      payload: { mode: 'trusted' },
      createdAt: '2026-04-19T10:00:00.000Z'
    });

    expect(command.type).toBe('start_session');
  });

  it('parses a device state payload', () => {
    const state = deviceStateSchema.parse({
      deviceId: 'device-1',
      displayName: 'Primary Workstation',
      platform: 'windows',
      runtimeStatus: 'ready',
      agentVersion: '0.1.0',
      capabilities: ['heartbeat', 'commands'],
      metadata: { room: 'office' }
    });

    expect(state.capabilities).toContain('commands');
  });

  it('parses an operator state snapshot', () => {
    const state = operatorStateSchema.parse({
      devices: [],
      sessions: [],
      alerts: [],
      costs: [],
      generatedAt: '2026-04-20T10:00:00.000Z',
      dataSource: 'bootstrap-fallback',
      fallbackReason: 'Firestore is not configured locally yet.'
    });

    expect(state.dataSource).toBe('bootstrap-fallback');
  });

  it('parses an auth session payload', () => {
    const session = authSessionSchema.parse({
      authenticated: false,
      source: 'bootstrap-fallback',
      message: 'Firebase Admin ADC is not configured locally.'
    });

    expect(session.authenticated).toBe(false);
  });

  it('parses a queued command payload', () => {
    const payload = commandQueuePayloadSchema.parse({
      queue: 'commands',
      requestedAt: '2026-04-20T10:00:00.000Z',
      command: {
        id: 'cmd-1',
        type: 'start_session',
        status: 'pending',
        deviceId: 'device-1',
        operatorId: 'operator-1',
        approvalRequired: true,
        payload: {},
        createdAt: '2026-04-20T10:00:00.000Z'
      }
    });

    expect(payload.queue).toBe('commands');
  });
});
