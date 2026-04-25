import { describe, expect, it, vi } from 'vitest';

// task-store.ts wires a default singleton at the bottom that
// transitively imports react-native-only modules (expo-secure-store
// via tokenStorage, @react-native-google-signin via auth-store).
// Mock both at the module level so vitest (Node) doesn't choke on
// the Flow-syntax react-native/index.js. Mirrors the auth-store
// test pattern.
vi.mock('@react-native-google-signin/google-signin', () => ({
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER'
  },
  GoogleSignin: {
    configure: vi.fn(),
    hasPlayServices: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn()
  },
  isErrorWithCode: (err: unknown): err is { code: string; message: string } =>
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined)
}));

import {
  TaskApiClientError,
  type TaskApiClient
} from '../services/task-api-client.js';

import { createTaskStore } from './task-store.js';

const TASK_UUID = '12345678-1234-4234-8234-123456789012';
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111';

const buildApiClient = (
  overrides: Partial<TaskApiClient> = {}
): TaskApiClient => ({
  submitTask: vi.fn().mockResolvedValue({
    taskId: TASK_UUID,
    status: 'pending',
    createdAt: '2026-04-25T14:00:00.000Z',
    streamUrl: `https://api/v1/tasks/${TASK_UUID}/stream`
  }),
  getTask: vi.fn(),
  buildStreamUrl: vi.fn(
    (id: string) => `https://api/v1/tasks/${id}/stream`
  ),
  ...overrides
});

describe('createTaskStore', () => {
  it('starts with idle submission status, no current task, no tasks map entries', () => {
    const apiClient = buildApiClient();
    const onForceSignOut = vi.fn();
    const useStore = createTaskStore({ apiClient, onForceSignOut });
    const state = useStore.getState();

    expect(state.submissionStatus).toBe('idle');
    expect(state.submissionError).toBeUndefined();
    expect(state.currentTaskId).toBeUndefined();
    expect(state.tasks).toEqual({});
  });

  it('submitTask success transitions idle -> submitting -> submitted and records the task view', async () => {
    const apiClient = buildApiClient();
    const onForceSignOut = vi.fn();
    const useStore = createTaskStore({ apiClient, onForceSignOut });

    const result = await useStore.getState().submitTask({
      prompt: 'do it',
      capabilities: ['code-generation'],
      idempotencyKey: IDEMPOTENCY_KEY
    });

    expect(result).toEqual({ taskId: TASK_UUID });
    const state = useStore.getState();
    expect(state.submissionStatus).toBe('submitted');
    expect(state.currentTaskId).toBe(TASK_UUID);
    expect(state.tasks[TASK_UUID]).toMatchObject({
      taskId: TASK_UUID,
      idempotencyKey: IDEMPOTENCY_KEY,
      prompt: 'do it',
      capabilities: ['code-generation'],
      output: '',
      status: 'pending'
    });
    expect(apiClient.submitTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'do it',
        capabilities: ['code-generation'],
        idempotencyKey: IDEMPOTENCY_KEY,
        agentType: 'auto'
      })
    );
    expect(onForceSignOut).not.toHaveBeenCalled();
  });

  it('submitTask 401 invokes onForceSignOut and lands in submit-error', async () => {
    const apiClient = buildApiClient({
      submitTask: vi.fn().mockRejectedValue(
        new TaskApiClientError(401, 'unauthorized', 'token rejected')
      )
    });
    const onForceSignOut = vi.fn().mockResolvedValue(undefined);
    const useStore = createTaskStore({ apiClient, onForceSignOut });

    const result = await useStore.getState().submitTask({
      prompt: 'do it',
      capabilities: [],
      idempotencyKey: IDEMPOTENCY_KEY
    });

    expect(onForceSignOut).toHaveBeenCalledOnce();
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.statusCode).toBe(401);
      expect(result.error.code).toBe('unauthorized');
    }
    const state = useStore.getState();
    expect(state.submissionStatus).toBe('submit-error');
    expect(state.submissionError?.statusCode).toBe(401);
  });

  it('appendDelta is idempotent on seq — late-arriving duplicate seq is dropped', async () => {
    const apiClient = buildApiClient();
    const onForceSignOut = vi.fn();
    const useStore = createTaskStore({ apiClient, onForceSignOut });

    await useStore.getState().submitTask({
      prompt: 'p',
      capabilities: [],
      idempotencyKey: IDEMPOTENCY_KEY
    });

    useStore.getState().appendDelta(TASK_UUID, {
      seq: 1,
      delta: 'hello ',
      timestamp: '2026-04-25T14:00:01.000Z'
    });
    useStore.getState().appendDelta(TASK_UUID, {
      seq: 2,
      delta: 'world',
      timestamp: '2026-04-25T14:00:02.000Z'
    });
    // Replay of seq=1 — must be dropped.
    useStore.getState().appendDelta(TASK_UUID, {
      seq: 1,
      delta: 'DUPLICATE',
      timestamp: '2026-04-25T14:00:01.500Z'
    });

    const view = useStore.getState().tasks[TASK_UUID];
    expect(view?.output).toBe('hello world');
    expect(view?.lastEventId).toBe(2);
  });

  it('completeTask + failTask transition to terminal status with seq + completedAt', async () => {
    const fixedNow = '2026-04-25T14:00:30.000Z';
    const apiClient = buildApiClient();
    const onForceSignOut = vi.fn();
    const useStore = createTaskStore({
      apiClient,
      onForceSignOut,
      now: () => fixedNow
    });

    await useStore.getState().submitTask({
      prompt: 'p',
      capabilities: [],
      idempotencyKey: IDEMPOTENCY_KEY
    });

    useStore.getState().completeTask(TASK_UUID, 'final', 5);
    let view = useStore.getState().tasks[TASK_UUID];
    expect(view?.status).toBe('completed');
    expect(view?.output).toBe('final');
    expect(view?.completedAt).toBe(fixedNow);
    expect(view?.lastEventId).toBe(5);

    // Reset to a fresh store for the failTask path.
    const useStore2 = createTaskStore({
      apiClient,
      onForceSignOut,
      now: () => fixedNow
    });
    await useStore2.getState().submitTask({
      prompt: 'p',
      capabilities: [],
      idempotencyKey: IDEMPOTENCY_KEY
    });
    useStore2
      .getState()
      .failTask(TASK_UUID, { code: 'rate_limit', message: 'too many' }, 7);
    view = useStore2.getState().tasks[TASK_UUID];
    expect(view?.status).toBe('failed');
    expect(view?.error).toEqual({ code: 'rate_limit', message: 'too many' });
    expect(view?.lastEventId).toBe(7);
    expect(view?.completedAt).toBe(fixedNow);
  });
});
