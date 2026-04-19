import { describe, expect, it, vi } from 'vitest';

import { parseDesktopAgentEnv } from '@operator-os/config';

import { createDeviceStateSnapshot } from './device-state.js';
import { SafeCommandExecutor } from './safe-command-executor.js';

describe('@operator-os/desktop-agent', () => {
  it('creates a ready device snapshot', () => {
    const snapshot = createDeviceStateSnapshot(
      parseDesktopAgentEnv({}),
      'ready'
    );

    expect(snapshot.runtimeStatus).toBe('ready');
    expect(snapshot.capabilities).toContain('heartbeat');
  });

  it('does not execute commands when command execution is disabled', async () => {
    const logger = {
      warn: vi.fn()
    } as const;

    const executor = new SafeCommandExecutor(
      parseDesktopAgentEnv({
        ENABLE_COMMAND_EXECUTION: 'false',
        API_BASE_URL: 'http://localhost:8080'
      }),
      logger as never
    );

    await executor.handle({
      id: 'cmd-1',
      type: 'custom',
      status: 'pending',
      deviceId: 'device-1',
      operatorId: 'owner',
      approvalRequired: true,
      payload: {},
      createdAt: '2026-04-19T00:00:00.000Z'
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
