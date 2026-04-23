import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import {
  taskErrorSchema,
  taskListResponseSchema,
  taskOutputDeltaSchema,
  taskRecordSchema,
  taskStatusResponseSchema,
  taskStatusSchema,
  taskSubmitRequestSchema,
  taskSubmitResponseSchema,
  type TaskRecord,
  type TaskStatus,
  type TaskStatusResponse
} from '../task.js';

const validUuid = '00000000-0000-4000-8000-000000000001';
const validUuid2 = '00000000-0000-4000-8000-000000000002';
const validUuid3 = '00000000-0000-4000-8000-000000000003';
const validIso = '2026-04-24T00:00:00.000Z';
const validIsoLater = '2026-05-24T00:00:00.000Z';

const validRecord: TaskRecord = {
  taskId: validUuid,
  userId: 'user-1',
  status: 'pending',
  prompt: 'list files in /tmp',
  agentType: 'claude-code',
  capabilities: ['file-read'],
  idempotencyKey: validUuid2,
  assignedAgentId: null,
  createdAt: validIso,
  updatedAt: validIso,
  startedAt: null,
  completedAt: null,
  expireAt: validIsoLater,
  output: null,
  outputDeltas: [],
  error: null
};

describe('taskStatusSchema', () => {
  it('covers exactly the eight planned states', () => {
    expectTypeOf<TaskStatus>().toEqualTypeOf<
      | 'pending'
      | 'queued'
      | 'assigned'
      | 'executing'
      | 'streaming'
      | 'completed'
      | 'failed'
      | 'cancelled'
    >();
  });

  it('rejects unknown status variants', () => {
    expect(() => taskStatusSchema.parse('done')).toThrow();
    expect(() => taskStatusSchema.parse('in_progress')).toThrow();
  });
});

describe('taskSubmitRequestSchema', () => {
  it('rejects an empty prompt', () => {
    expect(() =>
      taskSubmitRequestSchema.parse({
        prompt: '',
        idempotencyKey: validUuid
      })
    ).toThrow();
  });

  it('rejects a prompt longer than 50 000 chars', () => {
    const tooBig = 'a'.repeat(50_001);
    expect(() =>
      taskSubmitRequestSchema.parse({
        prompt: tooBig,
        idempotencyKey: validUuid
      })
    ).toThrow();
  });

  it('defaults agentType to "auto" when omitted', () => {
    const parsed = taskSubmitRequestSchema.parse({
      prompt: 'hi',
      idempotencyKey: validUuid
    });
    expect(parsed.agentType).toBe('auto');
  });

  it('defaults capabilities to an empty array', () => {
    const parsed = taskSubmitRequestSchema.parse({
      prompt: 'hi',
      idempotencyKey: validUuid
    });
    expect(parsed.capabilities).toEqual([]);
  });

  it('accepts optional metadata', () => {
    const parsed = taskSubmitRequestSchema.parse({
      prompt: 'hi',
      idempotencyKey: validUuid,
      metadata: { source: 'mobile-ios' }
    });
    expect(parsed.metadata).toEqual({ source: 'mobile-ios' });
  });

  it('rejects idempotencyKey that is not a UUID', () => {
    expect(() =>
      taskSubmitRequestSchema.parse({
        prompt: 'hi',
        idempotencyKey: 'not-a-uuid'
      })
    ).toThrow();
  });

  it('rejects unknown agentType values', () => {
    expect(() =>
      taskSubmitRequestSchema.parse({
        prompt: 'hi',
        idempotencyKey: validUuid,
        agentType: 'gemini'
      })
    ).toThrow();
  });
});

describe('taskRecordSchema', () => {
  it('round-trips a full valid record', () => {
    const parsed = taskRecordSchema.parse(validRecord);
    expect(parsed).toEqual(validRecord);
  });

  it('rejects a taskId that is not a UUID', () => {
    expect(() =>
      taskRecordSchema.parse({ ...validRecord, taskId: 'abc' })
    ).toThrow();
  });

  it('rejects non-ISO8601 datetime fields', () => {
    expect(() =>
      taskRecordSchema.parse({ ...validRecord, createdAt: '2026-04-24' })
    ).toThrow();
    expect(() =>
      taskRecordSchema.parse({ ...validRecord, expireAt: 'tomorrow' })
    ).toThrow();
  });

  it('accepts assignedAgentId as UUID or null, rejects other strings', () => {
    expect(() =>
      taskRecordSchema.parse({ ...validRecord, assignedAgentId: validUuid3 })
    ).not.toThrow();
    expect(() =>
      taskRecordSchema.parse({ ...validRecord, assignedAgentId: null })
    ).not.toThrow();
    expect(() =>
      taskRecordSchema.parse({ ...validRecord, assignedAgentId: 'agent' })
    ).toThrow();
  });

  it('requires expireAt (retention policy)', () => {
    const { expireAt: _drop, ...withoutExpireAt } = validRecord;
    expect(() =>
      taskRecordSchema.parse(withoutExpireAt as unknown)
    ).toThrow();
  });

  it('validates outputDeltas items: seq nonneg int, delta string, timestamp ISO', () => {
    expect(() =>
      taskRecordSchema.parse({
        ...validRecord,
        outputDeltas: [{ seq: -1, delta: 'x', timestamp: validIso }]
      })
    ).toThrow();
    expect(() =>
      taskRecordSchema.parse({
        ...validRecord,
        outputDeltas: [{ seq: 0, delta: 'x', timestamp: '2026-04-24' }]
      })
    ).toThrow();
    expect(() =>
      taskRecordSchema.parse({
        ...validRecord,
        outputDeltas: [{ seq: 0, delta: 'x', timestamp: validIso }]
      })
    ).not.toThrow();
  });

  it('validates error shape when non-null', () => {
    expect(() =>
      taskRecordSchema.parse({
        ...validRecord,
        status: 'failed',
        error: { code: '', message: 'x' }
      })
    ).toThrow();
    expect(() =>
      taskRecordSchema.parse({
        ...validRecord,
        status: 'failed',
        error: { code: 'dispatch_exhausted', message: 'no agents' }
      })
    ).not.toThrow();
  });
});

describe('taskErrorSchema + taskOutputDeltaSchema', () => {
  it('taskErrorSchema enforces non-empty code + message', () => {
    expect(() => taskErrorSchema.parse({ code: '', message: 'x' })).toThrow();
    expect(() => taskErrorSchema.parse({ code: 'x', message: '' })).toThrow();
  });

  it('taskOutputDeltaSchema rejects fractional seq', () => {
    expect(() =>
      taskOutputDeltaSchema.parse({ seq: 0.5, delta: 'x', timestamp: validIso })
    ).toThrow();
  });
});

describe('taskSubmitResponseSchema', () => {
  it('accepts a well-formed submit response', () => {
    const parsed = taskSubmitResponseSchema.parse({
      taskId: validUuid,
      status: 'pending',
      createdAt: validIso,
      streamUrl: '/v1/tasks/' + validUuid + '/stream'
    });
    expect(parsed.taskId).toBe(validUuid);
  });

  it('rejects an empty streamUrl', () => {
    expect(() =>
      taskSubmitResponseSchema.parse({
        taskId: validUuid,
        status: 'pending',
        createdAt: validIso,
        streamUrl: ''
      })
    ).toThrow();
  });
});

describe('taskStatusResponseSchema (drift guard vs TaskRecord)', () => {
  it('picks exactly {taskId, status, createdAt, updatedAt, output, error}', () => {
    type Picked = z.infer<typeof taskStatusResponseSchema>;
    expectTypeOf<Picked>().toEqualTypeOf<
      Pick<
        TaskRecord,
        'taskId' | 'status' | 'createdAt' | 'updatedAt' | 'output' | 'error'
      >
    >();
  });

  it('round-trips a valid instance without stream/agent fields', () => {
    const parsed: TaskStatusResponse = taskStatusResponseSchema.parse({
      taskId: validUuid,
      status: 'completed',
      createdAt: validIso,
      updatedAt: validIso,
      output: 'done',
      error: null
    });
    expect(parsed.output).toBe('done');
    // `assignedAgentId` and `streamUrl` are intentionally NOT on
    // this shape — confirmed in Gate 3.1.A.
    expect('assignedAgentId' in parsed).toBe(false);
    expect('streamUrl' in parsed).toBe(false);
  });
});

describe('taskListResponseSchema', () => {
  it('accepts an empty list with null nextCursor', () => {
    const parsed = taskListResponseSchema.parse({
      tasks: [],
      nextCursor: null
    });
    expect(parsed.tasks).toEqual([]);
    expect(parsed.nextCursor).toBeNull();
  });

  it('carries a cursor when there are more pages', () => {
    const parsed = taskListResponseSchema.parse({
      tasks: [
        {
          taskId: validUuid,
          status: 'completed',
          createdAt: validIso,
          updatedAt: validIso,
          output: 'ok',
          error: null
        }
      ],
      nextCursor: 'opaque-cursor'
    });
    expect(parsed.nextCursor).toBe('opaque-cursor');
  });
});
