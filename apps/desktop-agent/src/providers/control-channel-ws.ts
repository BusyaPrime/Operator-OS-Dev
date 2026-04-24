import { WebSocket } from 'ws';
import type { Logger } from 'pino';

import {
  createTaskQueue,
  type TaskQueue
} from '../registry/task-queue.js';

/**
 * Input handed to the TaskExecutor. Mirror of the server-side
 * `TaskAssignPayload` in apps/api/src/routes/agent-ws.ts.
 */
export interface TaskAssignInput {
  readonly taskId: string;
  readonly prompt: string;
  readonly capabilities: readonly string[];
  readonly metadata: {
    readonly userId: string;
    readonly createdAt: string;
    readonly expireAt: string;
  };
}

/** Terminal outcome of a single task execution. */
export type TaskExecutionResult =
  | { readonly kind: 'completed'; readonly taskId: string; readonly output: string }
  | {
      readonly kind: 'failed';
      readonly taskId: string;
      readonly error: { readonly code: string; readonly message: string };
    };

/**
 * Executor signature. Progress fragments are emitted via the supplied
 * callback; the resolved promise is the terminal result.
 */
export type TaskExecutor = (
  input: TaskAssignInput,
  emitProgress: (delta: string) => void
) => Promise<TaskExecutionResult>;

/** Signature compatible with `ws.WebSocket` for test injection. */
export interface ControlChannelSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open', cb: () => void): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close', cb: (code: number, reason: Buffer) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
}

export interface ControlChannelWsOptions {
  /** Full wss:// URL of /v1/agent/ws */
  readonly url: string;
  /** User JWT for the WS upgrade Authorization header. */
  readonly authToken: string;
  /** Agent identity (hello.agentId). */
  readonly agentId: string;
  /** Full manifest the server validates with agentManifestSchema. */
  readonly manifest: Record<string, unknown>;
  /** Runs the task work. Phase 3.2 ships with an echo-stub. */
  readonly executor: TaskExecutor;
  /** Capabilities the agent supports — defense in depth; server matches too. */
  readonly supportedCapabilities: ReadonlySet<string>;
  readonly logger: Logger;
  readonly reconnectBaseMs?: number;
  readonly reconnectMaxMs?: number;
  /** Test seam — build a fake socket instead of a real WS. */
  readonly socketFactory?: (
    url: string,
    headers: Record<string, string>
  ) => ControlChannelSocket;
}

const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 60_000;

/**
 * Symmetric counterpart of `apps/api/src/routes/agent-ws.ts`. Connects
 * the desktop-agent to the api's control-channel WS, performs the
 * hello handshake, and dispatches inbound `task-assign` frames to the
 * configured TaskExecutor. Outbound frames cover the full task life
 * cycle: task-accepted / task-rejected / task-progress /
 * task-completed / task-failed.
 *
 * Defense in depth: every task-assign goes through a
 * `supportedCapabilities` superset check before the executor sees it;
 * mismatches are rejected with `{reason: 'capability-mismatch'}` so
 * the server can re-dispatch to a sibling agent.
 *
 * Reconnection is exponential-backoff with a ceiling. Shutdown is
 * explicit — a user-driven stop() closes the socket and suppresses
 * reconnect.
 */
export class ControlChannelWs {
  #opts: Required<Omit<ControlChannelWsOptions, 'socketFactory'>> & {
    socketFactory?: ControlChannelWsOptions['socketFactory'];
  };
  #socket?: ControlChannelSocket;
  #queue: TaskQueue = createTaskQueue();
  #sessionId?: string;
  #shuttingDown = false;
  #reconnectAttempt = 0;
  #reconnectTimer?: NodeJS.Timeout;

  constructor(options: ControlChannelWsOptions) {
    this.#opts = {
      url: options.url,
      authToken: options.authToken,
      agentId: options.agentId,
      manifest: options.manifest,
      executor: options.executor,
      supportedCapabilities: options.supportedCapabilities,
      logger: options.logger,
      reconnectBaseMs: options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxMs: options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
      socketFactory: options.socketFactory
    };
  }

  start(): void {
    this.#shuttingDown = false;
    this.#connect();
  }

  async stop(): Promise<void> {
    this.#shuttingDown = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    if (this.#socket) {
      try {
        this.#socket.close(1000, 'client-shutdown');
      } catch {
        /* swallow */
      }
      this.#socket = undefined;
    }
  }

  /** Read-only view of currently executing tasks. Test hook. */
  get inFlight(): readonly { readonly taskId: string }[] {
    return this.#queue.list();
  }

  get isConnected(): boolean {
    return this.#socket !== undefined && this.#sessionId !== undefined;
  }

  #connect(): void {
    const factory =
      this.#opts.socketFactory ??
      ((url, headers) =>
        new WebSocket(url, { headers }) as unknown as ControlChannelSocket);

    const socket = factory(this.#opts.url, {
      authorization: `Bearer ${this.#opts.authToken}`
    });
    this.#socket = socket;

    socket.on('open', () => {
      this.#opts.logger.info(
        { source: 'control-channel-ws' },
        'control channel opened — sending hello'
      );
      this.#send({
        type: 'hello',
        agentId: this.#opts.agentId,
        manifest: this.#opts.manifest
      });
    });

    socket.on('message', (raw: unknown) => {
      let text: string;
      if (typeof raw === 'string') {
        text = raw;
      } else if (Buffer.isBuffer(raw)) {
        text = raw.toString('utf8');
      } else {
        text = String(raw);
      }
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch (err) {
        this.#opts.logger.warn(
          { err, source: 'control-channel-ws' },
          'frame was not valid JSON'
        );
        return;
      }
      this.#onFrame(frame);
    });

    socket.on('close', (code: number) => {
      this.#opts.logger.info(
        { source: 'control-channel-ws', code },
        'control channel closed'
      );
      this.#socket = undefined;
      this.#sessionId = undefined;
      if (!this.#shuttingDown) {
        this.#scheduleReconnect();
      }
    });

    socket.on('error', (err: Error) => {
      this.#opts.logger.warn(
        { err, source: 'control-channel-ws' },
        'control channel error'
      );
    });
  }

  #scheduleReconnect(): void {
    this.#reconnectAttempt += 1;
    const delay = Math.min(
      this.#opts.reconnectBaseMs * 2 ** (this.#reconnectAttempt - 1),
      this.#opts.reconnectMaxMs
    );
    this.#opts.logger.info(
      { source: 'control-channel-ws', delay, attempt: this.#reconnectAttempt },
      'scheduling control channel reconnect'
    );
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (!this.#shuttingDown) this.#connect();
    }, delay);
    if (typeof this.#reconnectTimer.unref === 'function') {
      this.#reconnectTimer.unref();
    }
  }

  #onFrame(frame: unknown): void {
    if (typeof frame !== 'object' || frame === null) return;
    const typed = frame as { type?: unknown };

    switch (typed.type) {
      case 'welcome': {
        const welcome = typed as { sessionId?: string };
        if (typeof welcome.sessionId === 'string') {
          this.#sessionId = welcome.sessionId;
          this.#reconnectAttempt = 0;
          this.#opts.logger.info(
            {
              source: 'control-channel-ws',
              sessionId: welcome.sessionId
            },
            'control channel welcomed'
          );
        }
        return;
      }
      case 'ping': {
        this.#send({ type: 'pong', ts: Date.now() });
        return;
      }
      case 'task-assign': {
        const { payload } = typed as { payload?: TaskAssignInput };
        if (!payload || typeof payload.taskId !== 'string') {
          this.#opts.logger.warn(
            { source: 'control-channel-ws' },
            'task-assign missing payload.taskId'
          );
          return;
        }
        this.#handleTaskAssign(payload);
        return;
      }
      case 'error': {
        this.#opts.logger.warn(
          { source: 'control-channel-ws', frame: typed },
          'server sent error frame'
        );
        return;
      }
      default:
        this.#opts.logger.debug(
          { source: 'control-channel-ws', type: typed.type },
          'unhandled frame type'
        );
    }
  }

  #handleTaskAssign(payload: TaskAssignInput): void {
    // Capability filter — defense in depth alongside server-side
    // router match. Reject rather than execute if this agent cannot
    // satisfy every required capability.
    for (const required of payload.capabilities) {
      if (!this.#opts.supportedCapabilities.has(required)) {
        this.#opts.logger.info(
          {
            source: 'control-channel-ws',
            taskId: payload.taskId,
            required
          },
          'task-assign rejected — capability mismatch'
        );
        this.#send({
          type: 'task-rejected',
          taskId: payload.taskId,
          reason: `capability-mismatch: ${required}`
        });
        return;
      }
    }

    this.#send({ type: 'task-accepted', taskId: payload.taskId });

    const emitProgress = (delta: string): void => {
      this.#send({
        type: 'task-delta',
        taskId: payload.taskId,
        delta
      });
    };

    const executionPromise = this.#opts
      .executor(payload, emitProgress)
      .then((result) => {
        if (result.kind === 'completed') {
          this.#send({
            type: 'task-completed',
            taskId: result.taskId,
            output: result.output
          });
        } else {
          this.#send({
            type: 'task-failed',
            taskId: result.taskId,
            error: result.error
          });
        }
        return result;
      })
      .catch((err: unknown) => {
        this.#opts.logger.warn(
          { err, taskId: payload.taskId, source: 'control-channel-ws' },
          'executor threw — sending task-failed'
        );
        this.#send({
          type: 'task-failed',
          taskId: payload.taskId,
          error: {
            code: 'executor_threw',
            message: err instanceof Error ? err.message : 'unknown executor error'
          }
        });
      });

    this.#queue.register(payload.taskId, executionPromise);
  }

  #send(payload: unknown): void {
    if (!this.#socket) return;
    try {
      this.#socket.send(JSON.stringify(payload));
    } catch (err) {
      this.#opts.logger.warn(
        { err, source: 'control-channel-ws' },
        'send failed'
      );
    }
  }
}
