import { describe, expect, it, vi } from 'vitest';

import {
  buildEchoStubCapabilities,
  buildEchoStubManifest,
  createEchoStubExecutor
} from '../echo-stub-agent/index.js';

const TASK_UUID = '99999999-9999-4999-8999-999999999999';

describe('createEchoStubExecutor', () => {
  it('returns kind=completed with output prefixed "echo: <prompt>"', async () => {
    const executor = createEchoStubExecutor();
    const result = await executor(
      {
        taskId: TASK_UUID,
        prompt: 'summarize this file',
        capabilities: ['code-generation'],
        metadata: {
          userId: 'u1',
          createdAt: '2026-04-24T09:00:00.000Z',
          expireAt: '2026-05-24T09:00:00.000Z'
        }
      },
      () => undefined
    );

    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.taskId).toBe(TASK_UUID);
      expect(result.output).toBe('echo: summarize this file');
    }
  });

  it('emits two progress fragments during execution', async () => {
    const emitProgress = vi.fn();
    const executor = createEchoStubExecutor();
    await executor(
      {
        taskId: TASK_UUID,
        prompt: 'x',
        capabilities: [],
        metadata: {
          userId: 'u1',
          createdAt: '2026-04-24T09:00:00.000Z',
          expireAt: '2026-05-24T09:00:00.000Z'
        }
      },
      emitProgress
    );

    expect(emitProgress).toHaveBeenCalledTimes(2);
    expect(emitProgress.mock.calls[0]?.[0]).toContain(TASK_UUID);
  });
});

describe('buildEchoStubManifest', () => {
  it('returns a manifest with all 17 canonical capabilities by default', () => {
    const manifest = buildEchoStubManifest() as {
      capabilities: Array<{ capability: string; version: string }>;
    };
    expect(manifest.capabilities).toHaveLength(17);
    expect(
      manifest.capabilities.every(
        (c) => typeof c.capability === 'string' && typeof c.version === 'string'
      )
    ).toBe(true);
  });

  it('honors a custom capability list for tests that need mismatch paths', () => {
    const manifest = buildEchoStubManifest({
      capabilities: ['code-generation']
    }) as {
      capabilities: Array<{ capability: string }>;
    };

    expect(manifest.capabilities).toHaveLength(1);
    expect(manifest.capabilities[0]?.capability).toBe('code-generation');
  });
});

describe('buildEchoStubCapabilities', () => {
  it('returns a Set<string> mirror of the manifest capability names', () => {
    const caps = buildEchoStubCapabilities({
      capabilities: ['code-generation', 'planning']
    });
    expect(caps.size).toBe(2);
    expect(caps.has('code-generation')).toBe(true);
    expect(caps.has('planning')).toBe(true);
  });
});
