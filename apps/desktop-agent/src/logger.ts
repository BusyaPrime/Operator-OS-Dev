import pino from 'pino';

import type { DesktopAgentEnv } from '@operator-os/config';

export const createLogger = (config: DesktopAgentEnv) =>
  pino({
    level: config.LOG_LEVEL,
    base: {
      agentId: config.AGENT_ID,
      deviceId: config.DEVICE_ID,
      service: 'desktop-agent'
    }
  });
