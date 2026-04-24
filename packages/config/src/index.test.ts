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

describe('Phase 3.2 task-dispatch env vars', () => {
  it('applies defaults for Pub/Sub + Cloud Tasks retry vars', () => {
    const env = parseApiEnv({});

    expect(env.PUBSUB_TOPIC_TASK_DISPATCH).toBe('task-dispatch-dev');
    expect(env.PUBSUB_SUBSCRIPTION_TASK_DISPATCH).toBe('task-dispatch-api-dev');
    expect(env.PUBSUB_TOPIC_TASK_DLQ).toBe('task-dispatch-dlq-dev');
    expect(env.PUBSUB_PUSH_AUDIENCE).toBeUndefined();
    expect(env.TASK_DISPATCH_RETRY_QUEUE).toBe('task-dispatch-retry-dev');
    expect(env.TASK_DISPATCH_RETRY_QUEUE_LOCATION).toBe('europe-west4');
    expect(env.TASK_DISPATCH_RETRY_DELAY_SECONDS).toBe(30);
  });

  it('accepts per-env overrides for topic/subscription/queue names', () => {
    const env = parseApiEnv({
      PUBSUB_TOPIC_TASK_DISPATCH: 'task-dispatch-prod',
      PUBSUB_SUBSCRIPTION_TASK_DISPATCH: 'task-dispatch-api-prod',
      PUBSUB_TOPIC_TASK_DLQ: 'task-dispatch-dlq-prod',
      PUBSUB_PUSH_AUDIENCE: 'https://operator-os-api-prod.example.com',
      TASK_DISPATCH_RETRY_QUEUE: 'task-dispatch-retry-prod',
      TASK_DISPATCH_RETRY_QUEUE_LOCATION: 'europe-west4',
      TASK_DISPATCH_RETRY_DELAY_SECONDS: '60'
    });

    expect(env.PUBSUB_TOPIC_TASK_DISPATCH).toBe('task-dispatch-prod');
    expect(env.PUBSUB_SUBSCRIPTION_TASK_DISPATCH).toBe(
      'task-dispatch-api-prod'
    );
    expect(env.PUBSUB_TOPIC_TASK_DLQ).toBe('task-dispatch-dlq-prod');
    expect(env.PUBSUB_PUSH_AUDIENCE).toBe(
      'https://operator-os-api-prod.example.com'
    );
    expect(env.TASK_DISPATCH_RETRY_QUEUE).toBe('task-dispatch-retry-prod');
    expect(env.TASK_DISPATCH_RETRY_QUEUE_LOCATION).toBe('europe-west4');
    expect(env.TASK_DISPATCH_RETRY_DELAY_SECONDS).toBe(60);
  });

  it('treats an empty PUBSUB_PUSH_AUDIENCE as unset', () => {
    const env = parseApiEnv({
      PUBSUB_PUSH_AUDIENCE: ''
    });

    expect(env.PUBSUB_PUSH_AUDIENCE).toBeUndefined();
  });
});
