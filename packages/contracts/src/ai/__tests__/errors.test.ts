import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AIAgentError,
  BudgetExceededError,
  CapabilityNotSupportedError,
  PathNotAllowedError
} from '../agent-errors.js';

describe('AIAgentError base class', () => {
  it('extends Error', () => {
    const err = new AIAgentError('X', 'msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AIAgentError);
  });

  it('carries code, retriable (default false), details', () => {
    const err = new AIAgentError('CODE_X', 'oops', {
      retriable: true,
      details: { foo: 1 }
    });
    expectTypeOf(err.code).toEqualTypeOf<string>();
    expectTypeOf(err.retriable).toEqualTypeOf<boolean>();
    expect(err.code).toBe('CODE_X');
    expect(err.retriable).toBe(true);
    expect(err.details).toStrictEqual({ foo: 1 });
  });

  it('retriable defaults to false when omitted', () => {
    const err = new AIAgentError('CODE_Y', 'oops');
    expect(err.retriable).toBe(false);
  });

  it('preserves cause via Error options', () => {
    const inner = new Error('inner');
    const err = new AIAgentError('CODE_Z', 'wrap', { cause: inner });
    expect(err.cause).toBe(inner);
  });
});

describe('CapabilityNotSupportedError', () => {
  it('has stable code CAPABILITY_NOT_SUPPORTED and is not retriable', () => {
    const err = new CapabilityNotSupportedError('vision', 'claude-code');
    expect(err).toBeInstanceOf(AIAgentError);
    expect(err.code).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(err.retriable).toBe(false);
    expect(err.details).toStrictEqual({
      capability: 'vision',
      providerId: 'claude-code'
    });
  });

  it("name is 'CapabilityNotSupportedError'", () => {
    const err = new CapabilityNotSupportedError('x', 'y');
    expect(err.name).toBe('CapabilityNotSupportedError');
  });
});

describe('BudgetExceededError', () => {
  it('has stable code BUDGET_EXCEEDED and is not retriable', () => {
    const err = new BudgetExceededError('user_1', 12.5, 10);
    expect(err).toBeInstanceOf(AIAgentError);
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.retriable).toBe(false);
    expect(err.details).toStrictEqual({
      userId: 'user_1',
      spent: 12.5,
      limit: 10
    });
  });

  it("name is 'BudgetExceededError'", () => {
    const err = new BudgetExceededError('u', 1, 2);
    expect(err.name).toBe('BudgetExceededError');
  });
});

describe('PathNotAllowedError', () => {
  it('has stable code PATH_NOT_ALLOWED and is not retriable', () => {
    const err = new PathNotAllowedError('/etc/passwd', ['/home/user']);
    expect(err).toBeInstanceOf(AIAgentError);
    expect(err.code).toBe('PATH_NOT_ALLOWED');
    expect(err.retriable).toBe(false);
    expect(err.details).toStrictEqual({
      path: '/etc/passwd',
      allowedRoots: ['/home/user']
    });
  });

  it("name is 'PathNotAllowedError'", () => {
    const err = new PathNotAllowedError('/x', []);
    expect(err.name).toBe('PathNotAllowedError');
  });
});
