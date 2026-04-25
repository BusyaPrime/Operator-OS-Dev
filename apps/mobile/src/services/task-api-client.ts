import type {
  TaskSubmitRequest,
  TaskSubmitResponse,
  TaskStatusResponse
} from '@operator-os/contracts';

export interface TaskApiClientOptions {
  /** Base URL of the api, e.g. https://operator-os-api…run.app */
  readonly baseUrl: string;
  /** fetch impl with Bearer auth + 401 refresh already wired. */
  readonly fetchFn: typeof fetch;
}

export class TaskApiClientError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'TaskApiClientError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface TaskApiClient {
  /**
   * POST /v1/tasks. Returns the server's submit response. Throws
   * TaskApiClientError on non-2xx; the caller's auth-aware fetch
   * has already handled 401/refresh before this code sees a
   * response, so 401 here means definitive auth failure.
   */
  submitTask(payload: TaskSubmitRequest): Promise<TaskSubmitResponse>;

  /**
   * GET /v1/tasks/:taskId — current snapshot. Used by the stream
   * screen on first render before the SSE connects.
   */
  getTask(taskId: string): Promise<TaskStatusResponse>;

  /** Build the absolute SSE URL for a task. */
  buildStreamUrl(taskId: string): string;
}

const parseJsonOrThrow = async (
  res: Response,
  endpoint: string
): Promise<unknown> => {
  const ctype = res.headers.get('content-type') ?? '';
  if (!ctype.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new TaskApiClientError(
      res.status,
      'unexpected_response',
      `${endpoint} returned ${res.status} with non-JSON body: ${text.slice(0, 200)}`
    );
  }
  return res.json();
};

export const createTaskApiClient = (
  options: TaskApiClientOptions
): TaskApiClient => {
  const trimmedBase = options.baseUrl.replace(/\/+$/, '');

  return {
    async submitTask(payload) {
      const res = await options.fetchFn(`${trimmedBase}/v1/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = (await parseJsonOrThrow(res, 'POST /v1/tasks')) as
        | TaskSubmitResponse
        | { code?: string; message?: string };
      if (!res.ok) {
        const err = body as { code?: string; message?: string };
        throw new TaskApiClientError(
          res.status,
          err.code ?? 'submit_failed',
          err.message ?? `POST /v1/tasks returned ${res.status}`
        );
      }
      return body as TaskSubmitResponse;
    },

    async getTask(taskId) {
      const res = await options.fetchFn(
        `${trimmedBase}/v1/tasks/${encodeURIComponent(taskId)}`,
        { method: 'GET' }
      );
      const body = (await parseJsonOrThrow(
        res,
        `GET /v1/tasks/${taskId}`
      )) as TaskStatusResponse | { code?: string; message?: string };
      if (!res.ok) {
        const err = body as { code?: string; message?: string };
        throw new TaskApiClientError(
          res.status,
          err.code ?? 'get_failed',
          err.message ?? `GET /v1/tasks returned ${res.status}`
        );
      }
      return body as TaskStatusResponse;
    },

    buildStreamUrl(taskId) {
      return `${trimmedBase}/v1/tasks/${encodeURIComponent(taskId)}/stream`;
    }
  };
};
