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
    expect(env.BIGQUERY_DATASET).toBe('ops_analytics');
  });

  it('treats an empty tasks target base url as unset', () => {
    const env = parseApiEnv({
      TASKS_TARGET_BASE_URL: ''
    });

    expect(env.TASKS_TARGET_BASE_URL).toBeUndefined();
  });

  it('parses desktop agent values', () => {
    const env = parseDesktopAgentEnv({
      AGENT_ID: 'agent-1',
      API_BASE_URL: 'https://example.com',
      ENABLE_COMMAND_EXECUTION: 'false'
    });

    expect(env.AGENT_ID).toBe('agent-1');
    expect(env.ENABLE_COMMAND_EXECUTION).toBe(false);
    expect(env.CONTROLLED_FALLBACK).toBe(true);
  });

  it('parses mobile public config', () => {
    const env = parseMobileEnv({
      EXPO_PUBLIC_API_BASE_URL: 'https://example.com',
      EXPO_PUBLIC_USE_MOCKS: 'true'
    });

    expect(env.EXPO_PUBLIC_USE_MOCKS).toBe(true);
    expect(env.EXPO_PUBLIC_AUTH_MODE).toBe('bootstrap-fallback');
    // New in Phase 1.5: gateway URL default + optional Google IDs.
    expect(env.EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL).toBe('http://localhost:8081');
    expect(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).toBeUndefined();
  });

  it('captures Google Sign-In client ids when supplied', () => {
    const env = parseMobileEnv({
      EXPO_PUBLIC_AUTH_MODE: 'google',
      EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL: 'https://gateway.example.com',
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web-id.apps.googleusercontent.com',
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios-id.apps.googleusercontent.com',
      EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: 'android-id.apps.googleusercontent.com'
    });

    expect(env.EXPO_PUBLIC_AUTH_MODE).toBe('google');
    expect(env.EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL).toBe(
      'https://gateway.example.com'
    );
    expect(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).toBe(
      'web-id.apps.googleusercontent.com'
    );
    expect(env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID).toBe(
      'ios-id.apps.googleusercontent.com'
    );
    expect(env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID).toBe(
      'android-id.apps.googleusercontent.com'
    );
  });
});
