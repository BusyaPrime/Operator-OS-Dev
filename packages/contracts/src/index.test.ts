import { describe, expect, it } from 'vitest';

import { commandSchema, deviceStateSchema, healthResponseSchema } from './index.js';

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
});
