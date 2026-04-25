import { describe, expect, it, vi } from 'vitest';

import {
  generateIdempotencyKey,
  performTaskSubmit
} from './task-submit-helpers.js';

const TASK_UUID = '12345678-1234-4234-8234-123456789012';

describe('generateIdempotencyKey', () => {
  it('produces a string in v4 UUID shape (8-4-4-4-12 hex with version 4 + valid variant)', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe('performTaskSubmit', () => {
  it('refuses to submit when prompt is empty / whitespace and does not navigate', async () => {
    const submitTask = vi.fn();
    const navigate = vi.fn();
    const result = await performTaskSubmit({
      prompt: '   ',
      capabilities: new Set(['code-generation']),
      idempotencyKey: 'k',
      submitTask,
      navigation: { navigate }
    });
    expect(result).toBeUndefined();
    expect(submitTask).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refuses to submit when capabilities set is empty', async () => {
    const submitTask = vi.fn();
    const navigate = vi.fn();
    const result = await performTaskSubmit({
      prompt: 'do it',
      capabilities: new Set(),
      idempotencyKey: 'k',
      submitTask,
      navigation: { navigate }
    });
    expect(result).toBeUndefined();
    expect(submitTask).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('submits with the idempotency key + trimmed prompt and navigates to TaskStream on success', async () => {
    const submitTask = vi
      .fn()
      .mockResolvedValue({ taskId: TASK_UUID });
    const navigate = vi.fn();
    const result = await performTaskSubmit({
      prompt: '  do it  ',
      capabilities: new Set(['code-generation', 'planning']),
      idempotencyKey: 'idem-1',
      submitTask,
      navigation: { navigate }
    });
    expect(submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'do it',
        idempotencyKey: 'idem-1'
      })
    );
    const passedCaps = submitTask.mock.calls[0]?.[0]
      ?.capabilities as string[];
    expect(passedCaps.sort()).toEqual(['code-generation', 'planning']);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('TaskStream', {
      taskId: TASK_UUID
    });
    expect(result).toEqual({ taskId: TASK_UUID });
  });

  it('does NOT navigate when submit returns an error', async () => {
    const submitTask = vi.fn().mockResolvedValue({
      error: { code: 'rate_limit', message: 'too many submits' }
    });
    const navigate = vi.fn();
    const result = await performTaskSubmit({
      prompt: 'p',
      capabilities: new Set(['code-generation']),
      idempotencyKey: 'k',
      submitTask,
      navigation: { navigate }
    });
    expect(submitTask).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
