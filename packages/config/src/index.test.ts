import { describe, expect, it } from 'vitest';

import {
  parseApiEnv,
  parseDesktopAgentEnv,
  parseMobileEnv
} from './index.js';

describe('@operator-os/config', () => {
  it('applies api defaults', () => {
    const env = parseApiEnv({});

    expect(env.PORT).toBe(8080);
    expect(env.GOOGLE_CLOUD_PROJECT).toBe('operator-os-dev');
  });

  it('parses desktop agent values', () => {
    const env = parseDesktopAgentEnv({
      AGENT_ID: 'agent-1',
      API_BASE_URL: 'https://example.com',
      ENABLE_COMMAND_EXECUTION: 'false'
    });

    expect(env.AGENT_ID).toBe('agent-1');
    expect(env.ENABLE_COMMAND_EXECUTION).toBe(false);
  });

  it('parses mobile public config', () => {
    const env = parseMobileEnv({
      EXPO_PUBLIC_API_BASE_URL: 'https://example.com',
      EXPO_PUBLIC_USE_MOCKS: 'true'
    });

    expect(env.EXPO_PUBLIC_USE_MOCKS).toBe(true);
  });
});
