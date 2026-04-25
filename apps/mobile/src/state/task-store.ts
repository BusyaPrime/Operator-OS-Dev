import type {
  TaskStatus,
  TaskOutputDelta,
  TaskError as ContractTaskError,
  TaskSubmitRequest
} from '@operator-os/contracts';
import { create } from 'zustand';

import { createAuthClient } from '../services/auth-client.js';
import { createAuthenticatedFetch } from '../services/authenticated-api-client.js';
import {
  createTaskApiClient,
  TaskApiClientError,
  type TaskApiClient
} from '../services/task-api-client.js';
import { tokenStorage } from '../auth/token-storage.js';

import { useAuthStore } from './auth-store.js';

/**
 * Lightweight in-memory model of a task observed from the mobile
 * UI. Holds the submission identity + the running aggregate of
 * output deltas + the latest server-known status. Persistence is
 * the api's job; the mobile store is purely a view-model.
 */
export interface TaskViewModel {
  readonly taskId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly capabilities: readonly string[];
  readonly createdAt: string;
  readonly streamUrl: string;
  status: TaskStatus;
  /** Concatenated text from delta events. */
  output: string;
  /** Highest seq observed — passed as Last-Event-ID on reconnect. */
  lastEventId?: number;
  error?: ContractTaskError;
  completedAt?: string;
}

export type TaskSubmissionStatus =
  | 'idle'
  | 'submitting'
  | 'submitted'
  | 'submit-error';

export interface TaskSubmissionError {
  readonly code: string;
  readonly message: string;
  readonly statusCode?: number;
}

export interface TaskStoreState {
  readonly submissionStatus: TaskSubmissionStatus;
  readonly submissionError?: TaskSubmissionError;
  /** Most recent submitted task — what TaskStreamScreen reads. */
  readonly currentTaskId?: string;
  /** All tasks the session has touched, keyed by taskId. */
  readonly tasks: Readonly<Record<string, TaskViewModel>>;

  /** Submit + transition to 'submitted' on success. */
  submitTask(payload: {
    readonly prompt: string;
    readonly capabilities: readonly string[];
    readonly idempotencyKey: string;
  }): Promise<{ readonly taskId: string } | { readonly error: TaskSubmissionError }>;

  /** Append a streamed delta to the local view model. */
  appendDelta(taskId: string, delta: TaskOutputDelta): void;
  /** Update status + persist Last-Event-ID. */
  setStatus(taskId: string, status: TaskStatus, seq?: number): void;
  /** Mark terminal completion. */
  completeTask(taskId: string, output: string, seq: number): void;
  /** Mark terminal failure. */
  failTask(taskId: string, error: ContractTaskError, seq: number): void;

  clearSubmissionError(): void;
}

export interface TaskStoreDeps {
  readonly apiClient: TaskApiClient;
  /**
   * Called when the api returns 401 from a submitTask request that
   * already passed the auth-aware fetch wrapper. Mirrors the
   * authStore.forceSignOut() pattern.
   */
  readonly onForceSignOut: () => Promise<void> | void;
  readonly now?: () => string;
}

const DEFAULT_AGENT_TYPE = 'auto' as const;

export const createTaskStore = (deps: TaskStoreDeps) => {
  const now = deps.now ?? (() => new Date().toISOString());

  return create<TaskStoreState>((set, get) => ({
    submissionStatus: 'idle',
    submissionError: undefined,
    currentTaskId: undefined,
    tasks: {},

    async submitTask(payload) {
      set({
        submissionStatus: 'submitting',
        submissionError: undefined
      });

      const submitRequest: TaskSubmitRequest = {
        prompt: payload.prompt,
        agentType: DEFAULT_AGENT_TYPE,
        capabilities: [...payload.capabilities],
        idempotencyKey: payload.idempotencyKey
      };

      try {
        const response = await deps.apiClient.submitTask(submitRequest);
        const view: TaskViewModel = {
          taskId: response.taskId,
          idempotencyKey: payload.idempotencyKey,
          prompt: payload.prompt,
          capabilities: [...payload.capabilities],
          createdAt: response.createdAt,
          streamUrl: response.streamUrl,
          status: response.status,
          output: ''
        };
        set((state) => ({
          submissionStatus: 'submitted',
          currentTaskId: response.taskId,
          tasks: { ...state.tasks, [response.taskId]: view }
        }));
        return { taskId: response.taskId };
      } catch (err) {
        if (err instanceof TaskApiClientError) {
          // 401 here means the auth-aware fetch already tried + failed
          // to refresh — definitive sign-out signal.
          if (err.statusCode === 401) {
            await deps.onForceSignOut();
          }
          const submissionError: TaskSubmissionError = {
            code: err.code,
            message: err.message,
            statusCode: err.statusCode
          };
          set({
            submissionStatus: 'submit-error',
            submissionError
          });
          return { error: submissionError };
        }
        const fallback: TaskSubmissionError = {
          code: 'network_error',
          message: err instanceof Error ? err.message : 'unknown error'
        };
        set({ submissionStatus: 'submit-error', submissionError: fallback });
        return { error: fallback };
      }
    },

    appendDelta(taskId, delta) {
      const existing = get().tasks[taskId];
      if (existing === undefined) return;
      // Idempotency on seq — if the delta's seq is <= what we have
      // already seen, ignore. Catches spurious replay.
      if (existing.lastEventId !== undefined && delta.seq <= existing.lastEventId) {
        return;
      }
      const updated: TaskViewModel = {
        ...existing,
        output: existing.output + delta.delta,
        lastEventId: delta.seq
      };
      set((state) => ({
        tasks: { ...state.tasks, [taskId]: updated }
      }));
    },

    setStatus(taskId, status, seq) {
      const existing = get().tasks[taskId];
      if (existing === undefined) return;
      const updated: TaskViewModel = {
        ...existing,
        status,
        lastEventId: seq ?? existing.lastEventId
      };
      set((state) => ({
        tasks: { ...state.tasks, [taskId]: updated }
      }));
    },

    completeTask(taskId, output, seq) {
      const existing = get().tasks[taskId];
      if (existing === undefined) return;
      const updated: TaskViewModel = {
        ...existing,
        status: 'completed',
        output: output.length > 0 ? output : existing.output,
        completedAt: now(),
        lastEventId: seq
      };
      set((state) => ({
        tasks: { ...state.tasks, [taskId]: updated }
      }));
    },

    failTask(taskId, error, seq) {
      const existing = get().tasks[taskId];
      if (existing === undefined) return;
      const updated: TaskViewModel = {
        ...existing,
        status: 'failed',
        error,
        completedAt: now(),
        lastEventId: seq
      };
      set((state) => ({
        tasks: { ...state.tasks, [taskId]: updated }
      }));
    },

    clearSubmissionError() {
      set({ submissionStatus: 'idle', submissionError: undefined });
    }
  }));
};

// ---------------------------------------------------------------------------
// Default singleton wired against real deps. Screens consume this;
// tests build isolated instances via `createTaskStore` directly.
// Mirrors the `useAuthStore` pattern at the bottom of auth-store.ts.
// ---------------------------------------------------------------------------

const defaultApiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';
const defaultGatewayBaseUrl =
  process.env.EXPO_PUBLIC_AUTH_GATEWAY_BASE_URL ?? 'http://localhost:8081';

const defaultAuthClient = createAuthClient({
  gatewayBaseUrl: defaultGatewayBaseUrl
});

const defaultAuthenticatedFetch = createAuthenticatedFetch({
  authStore: {
    getState: () => {
      const s = useAuthStore.getState();
      return {
        accessToken: s.accessToken,
        accessTokenExpiresAt: s.accessTokenExpiresAt
      };
    },
    applyRefreshedTokens: (accessToken, accessTokenExpiresAt) => {
      useAuthStore
        .getState()
        .applyRefreshedTokens(accessToken, accessTokenExpiresAt);
    },
    forceSignOut: async () => {
      await useAuthStore.getState().forceSignOut();
    }
  },
  authClient: defaultAuthClient,
  tokenStorage
});

const defaultApiClient = createTaskApiClient({
  baseUrl: defaultApiBaseUrl,
  fetchFn: defaultAuthenticatedFetch
});

export const useTaskStore = createTaskStore({
  apiClient: defaultApiClient,
  onForceSignOut: async () => {
    await useAuthStore.getState().forceSignOut();
  }
});
