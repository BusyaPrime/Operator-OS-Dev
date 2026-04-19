import type { DesktopAgentEnv } from '@operator-os/config';
import type { DeviceState } from '@operator-os/contracts';

export const createDeviceStateSnapshot = (
  config: DesktopAgentEnv,
  runtimeStatus: DeviceState['runtimeStatus']
): DeviceState => ({
  deviceId: config.DEVICE_ID,
  displayName: config.DEVICE_NAME,
  platform: config.DEVICE_PLATFORM,
  runtimeStatus,
  agentVersion: '0.1.0',
  lastHeartbeatAt: new Date().toISOString(),
  capabilities: ['heartbeat', 'commands', 'exports', 'trusted-session', 'telemetry'],
  metadata: {
    transparentRuntime: true
  }
});
