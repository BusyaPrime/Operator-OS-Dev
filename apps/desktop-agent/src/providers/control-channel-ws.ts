import { WebSocket } from 'ws';
import type { Logger } from 'pino';

import { TOKEN_ROTATION_RECOMMENDED_HEADER } from '@operator-os/contracts';

import {
  noopAuthSignals,
  type TokenAuthSignals,
  type UnauthorizedContext
} from '../auth/auth-signals.js';
import {
  createTaskQueue,
  type TaskQueue
} from '../registry/task-queue.js';
import {
  ConnectionStateMachine,
  type ConnectionState
} from './connection-state-machine.js';
import { categorizeDisconnect } from './disconnect-categorizer.js';
import type { NetworkChangeDetector } from './network-change-detector.js';
import { ReconnectBackoff } from './reconnect-backoff.js';
import type { RttHistogram } from './rtt-histogram.js';

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
  /**
   * The `ws` library emits this when the HTTP upgrade response
   * arrives (status 101 + headers + protocols). Phase 4.0
   * Part 4.E uses it to observe the
   * `X-Token-Rotation-Recommended` header on the upgrade.
   * Test stubs may implement it as a no-op.
   */
  on(
    event: 'upgrade',
    cb: (response: { headers: Record<string, string | string[] | undefined> }) => void
  ): void;
}

export interface ControlChannelWsOptions {
  /** Full wss:// URL of /v1/agent/ws */
  readonly url: string;
  /**
   * Static bearer token. Legacy path — used as a fallback
   * when `tokenProvider` is not supplied. Phase 4.0 wiring
   * passes a `tokenProvider` that reads from the
   * CredentialStore so a token rotation between connects is
   * picked up automatically.
   */
  readonly authToken?: string;
  /**
   * Phase 4.0 Part 4.E — async provider that returns the
   * current agent token. Read fresh on every connect /
   * reconnect. Returning null means we have no token; the
   * connection attempt aborts and `authSignals.onUnauthorized`
   * fires with `source: 'ws'`.
   */
  readonly tokenProvider?: () => Promise<string | null>;
  /**
   * Shared auth signals. The WS path observes:
   *   - `X-Token-Rotation-Recommended: true` on the upgrade
   *     response → `onRotationHinted()`
   *   - close code 4001 (server-side revoked mid-session)
   *     OR an upgrade error with HTTP status 401 →
   *     `onUnauthorized({source: 'ws', ...})`
   * Defaults to `noopAuthSignals` if omitted.
   */
  readonly authSignals?: TokenAuthSignals;
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
  /**
   * Phase 4.0 Part 5.F — explicit connection state machine.
   * If omitted, the WS constructs its own internal instance.
   * Supplying one externally lets `main.ts` subscribe to
   * state transitions for mobile-status fan-out (TD-058).
   */
  readonly stateMachine?: ConnectionStateMachine;
  /**
   * Phase 4.0 Part 5.F — backoff policy for reconnect
   * scheduling. Defaults to a `ReconnectBackoff` with the
   * documented 1s/60s/±20%/1000-attempt config. Tests
   * inject a deterministic policy.
   */
  readonly backoff?: ReconnectBackoff;
  /**
   * Phase 4.0 Part 5.F — network-change detector. When
   * supplied, the WS subscribes on `start()` and triggers
   * an immediate reconnect attempt whenever the local
   * interface set changes. When omitted, the periodic
   * backoff schedule is the only reconnect trigger.
   */
  readonly networkChangeDetector?: NetworkChangeDetector;
  /**
   * Phase 4.0 Part 5.F — RTT histogram. The agent records
   * a sample on every server-driven `ping` round-trip. The
   * caller (main.ts) reads `.percentiles()` for the mobile
   * status fan-out (Part 7).
   *
   * Design limitation: the api's current ping frame doesn't
   * carry an echoed-back timestamp, so the "RTT" we record
   * is the local time between inbound-ping arrival and
   * outbound-pong send completion. That's a processing-
   * latency proxy, not the full network round-trip. A
   * follow-up TD upgrades the api to echo timestamps so
   * we can record true RTT.
   */
  readonly rttHistogram?: RttHistogram;
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
  #url: string;
  #authToken?: string;
  #tokenProvider?: () => Promise<string | null>;
  #signals: TokenAuthSignals;
  #agentId: string;
  #manifest: Record<string, unknown>;
  #executor: TaskExecutor;
  #supportedCapabilities: ReadonlySet<string>;
  #logger: Logger;
  #reconnectBaseMs: number;
  #reconnectMaxMs: number;
  #socketFactory?: ControlChannelWsOptions['socketFactory'];

  #stateMachine: ConnectionStateMachine;
  #backoff: ReconnectBackoff;
  #networkChangeDetector?: NetworkChangeDetector;
  #unsubscribeNetworkChange?: () => void;
  #rttHistogram?: RttHistogram;

  #socket?: ControlChannelSocket;
  #queue: TaskQueue = createTaskQueue();
  #sessionId?: string;
  #reconnectTimer?: NodeJS.Timeout;

  constructor(options: ControlChannelWsOptions) {
    if (
      options.authToken === undefined &&
      options.tokenProvider === undefined
    ) {
      throw new Error(
        'ControlChannelWs requires either `authToken` or `tokenProvider`'
      );
    }
    this.#url = options.url;
    this.#authToken = options.authToken;
    this.#tokenProvider = options.tokenProvider;
    this.#signals = options.authSignals ?? noopAuthSignals;
    this.#agentId = options.agentId;
    this.#manifest = options.manifest;
    this.#executor = options.executor;
    this.#supportedCapabilities = options.supportedCapabilities;
    this.#logger = options.logger;
    this.#reconnectBaseMs =
      options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.#reconnectMaxMs =
      options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.#socketFactory = options.socketFactory;
    this.#stateMachine =
      options.stateMachine ??
      new ConnectionStateMachine({ logger: options.logger });
    this.#backoff =
      options.backoff ??
      new ReconnectBackoff({
        baseMs: this.#reconnectBaseMs,
        maxMs: this.#reconnectMaxMs
      });
    this.#networkChangeDetector = options.networkChangeDetector;
    this.#rttHistogram = options.rttHistogram;
  }

  start(): void {
    if (this.#stateMachine.isTerminal) {
      this.#logger.warn(
        { state: this.#stateMachine.state, source: 'control-channel-ws' },
        'start() called on terminal state machine — ignored'
      );
      return;
    }
    // Subscribe to network-change once at start; the
    // detector itself handles its own start/stop.
    if (
      this.#networkChangeDetector !== undefined &&
      this.#unsubscribeNetworkChange === undefined
    ) {
      this.#unsubscribeNetworkChange =
        this.#networkChangeDetector.onChange((event) => {
          this.#logger.info(
            { event, source: 'control-channel-ws' },
            'network change detected; expediting reconnect'
          );
          this.#expediteReconnect();
        });
    }
    this.#connect();
  }

  async stop(): Promise<void> {
    this.#stateMachine.request({
      to: 'DISCONNECTING',
      reason: 'operator-stop'
    });
    if (this.#unsubscribeNetworkChange !== undefined) {
      this.#unsubscribeNetworkChange();
      this.#unsubscribeNetworkChange = undefined;
    }
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
    // The 'close' handler from the WS would normally complete
    // the DISCONNECTING -> DISCONNECTED transition. If the
    // socket close didn't propagate (test stubs that don't
    // emit close), do it here defensively so the state
    // machine ends in a known idle state.
    if (this.#stateMachine.state === 'DISCONNECTING') {
      this.#stateMachine.request({
        to: 'DISCONNECTED',
        reason: 'stop-completed'
      });
    }
  }

  /** Read-only view of currently executing tasks. Test hook. */
  get inFlight(): readonly { readonly taskId: string }[] {
    return this.#queue.list();
  }

  get isConnected(): boolean {
    return this.#stateMachine.canSend;
  }

  /** Phase 4.0 Part 5.F — current state machine snapshot. */
  get connectionState(): ConnectionState {
    return this.#stateMachine.state;
  }

  /** Server-issued session id from the most recent welcome, if any. */
  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  /**
   * Cancel any pending backoff timer and re-enter CONNECTING
   * immediately. Called by the network-change detector when
   * the local interface comes back. No-op when we're not
   * currently waiting on a reconnect.
   */
  #expediteReconnect(): void {
    if (this.#stateMachine.isTerminal) return;
    if (this.#stateMachine.state !== 'DISCONNECTED') return;
    if (this.#reconnectTimer === undefined) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#connect();
  }

  #connect(): void {
    void this.#connectAsync();
  }

  async #connectAsync(): Promise<void> {
    if (this.#stateMachine.isTerminal) return;
    if (
      this.#stateMachine.state === 'DISCONNECTING' ||
      this.#stateMachine.state === 'CONNECTING' ||
      this.#stateMachine.state === 'CONNECTED' ||
      this.#stateMachine.state === 'DEGRADED'
    ) {
      return;
    }
    this.#stateMachine.request({
      to: 'CONNECTING',
      reason: 'open-connect'
    });

    let token: string | null;
    if (this.#tokenProvider !== undefined) {
      try {
        token = await this.#tokenProvider();
      } catch (err) {
        this.#logger.warn(
          { err, source: 'control-channel-ws' },
          'tokenProvider threw; will retry connect after backoff'
        );
        // Roll back from CONNECTING → DISCONNECTED so the
        // backoff scheduler can try again. The state machine
        // disallows direct CONNECTING → CONNECTING; this flip
        // also gives the network-change detector a window to
        // expedite if the credential store recovers fast.
        this.#stateMachine.request({
          to: 'DISCONNECTED',
          reason: 'token-provider-threw',
          metadata: { errMessage: err instanceof Error ? err.message : '' }
        });
        this.#scheduleReconnect();
        return;
      }
      if (token === null || token.length === 0) {
        this.#logger.error(
          { source: 'control-channel-ws' },
          'tokenProvider returned no token; firing onUnauthorized'
        );
        this.#emitUnauthorized({
          source: 'ws',
          agentId: this.#agentId,
          reason: 'no_token_in_credential_store'
        });
        // No token means the agent must re-register; mark
        // REVOKED so we don't loop the reconnect.
        this.#stateMachine.request({
          to: 'REVOKED',
          reason: 'no-token-in-credential-store'
        });
        return;
      }
    } else {
      token = this.#authToken ?? null;
    }

    const factory =
      this.#socketFactory ??
      ((url, headers) =>
        new WebSocket(url, { headers }) as unknown as ControlChannelSocket);

    const socket = factory(this.#url, {
      authorization: `Bearer ${token}`
    });
    this.#socket = socket;

    // Observe the upgrade response for the rotation header.
    // The `ws` library exposes the IncomingMessage on the
    // 'upgrade' event before 'open'. Wrapped in try/catch
    // because injected test stubs may handle 'upgrade' as a
    // no-op or throw.
    try {
      socket.on('upgrade', (response) => {
        const value = response.headers[TOKEN_ROTATION_RECOMMENDED_HEADER];
        const stringValue =
          typeof value === 'string'
            ? value
            : Array.isArray(value)
              ? value[0]
              : undefined;
        if (stringValue === 'true') {
          try {
            this.#signals.onRotationHinted();
          } catch (err) {
            this.#logger.warn(
              { err, source: 'control-channel-ws' },
              'authSignals.onRotationHinted threw — continuing'
            );
          }
        }
      });
    } catch {
      /* test stub may not implement 'upgrade' */
    }

    socket.on('open', () => {
      this.#logger.info(
        { source: 'control-channel-ws' },
        'control channel opened — sending hello'
      );
      this.#send({
        type: 'hello',
        agentId: this.#agentId,
        manifest: this.#manifest
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
        this.#logger.warn(
          { err, source: 'control-channel-ws' },
          'frame was not valid JSON'
        );
        return;
      }
      this.#onFrame(frame);
    });

    socket.on('close', (code: number) => {
      const intentional =
        this.#stateMachine.state === 'DISCONNECTING' || code === 1000;
      const category = categorizeDisconnect({
        closeCode: code,
        intentional
      });
      this.#logger.info(
        { source: 'control-channel-ws', code, category },
        'control channel closed'
      );
      this.#socket = undefined;
      this.#sessionId = undefined;
      // 4001 = unauthorized per agent-ws.ts close-code map.
      // We treat that as a fatal auth event and bubble it
      // up. The subsequent reconnect scheduling is suppressed
      // so the FatalAuthHandler can exit cleanly.
      if (code === 4001) {
        this.#emitUnauthorized({
          source: 'ws',
          agentId: this.#agentId,
          reason: 'ws_close_4001_unauthorized'
        });
        this.#stateMachine.request({
          to: 'REVOKED',
          reason: 'close-4001',
          metadata: { category }
        });
        return;
      }
      if (this.#stateMachine.state === 'DISCONNECTING') {
        this.#stateMachine.request({
          to: 'DISCONNECTED',
          reason: 'operator-stop-close',
          metadata: { code, category }
        });
        return;
      }
      this.#stateMachine.request({
        to: 'DISCONNECTED',
        reason: `transport-close-${code}`,
        metadata: { code, category }
      });
      this.#scheduleReconnect();
    });

    socket.on('error', (err: Error) => {
      const category = categorizeDisconnect({
        error: err as Error & { code?: string }
      });
      this.#logger.warn(
        { err, category, source: 'control-channel-ws' },
        'control channel error'
      );
      // The `ws` library emits a synthetic Error with the
      // upgrade-response status when the server returns a
      // non-101 response. Our agentTokenGuard returns 401
      // for an unrecognized / revoked agent token at WS
      // upgrade time; surface as onUnauthorized.
      const message = typeof err.message === 'string' ? err.message : '';
      if (
        message.includes('Unexpected server response: 401') ||
        message.includes('401')
      ) {
        this.#emitUnauthorized({
          source: 'ws',
          agentId: this.#agentId,
          reason: 'ws_upgrade_401'
        });
        this.#stateMachine.request({
          to: 'REVOKED',
          reason: 'upgrade-error-401',
          metadata: { category }
        });
      }
    });
  }

  #emitUnauthorized(context: UnauthorizedContext): void {
    try {
      this.#signals.onUnauthorized(context);
    } catch (err) {
      this.#logger.warn(
        { err, source: 'control-channel-ws' },
        'authSignals.onUnauthorized threw — continuing'
      );
    }
  }

  #scheduleReconnect(): void {
    if (this.#stateMachine.isTerminal) return;
    if (this.#stateMachine.state === 'DISCONNECTING') return;
    const delay = this.#backoff.nextDelayMs();
    if (delay === null) {
      this.#logger.error(
        {
          source: 'control-channel-ws',
          maxAttempts: this.#backoff.attempts
        },
        'reconnect backoff exhausted; staying DISCONNECTED'
      );
      return;
    }
    this.#logger.info(
      {
        source: 'control-channel-ws',
        delay,
        attempt: this.#backoff.attempts
      },
      'scheduling control channel reconnect'
    );
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (this.#stateMachine.isTerminal) return;
      if (this.#stateMachine.state === 'DISCONNECTING') return;
      this.#connect();
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
          this.#backoff.reset();
          this.#stateMachine.request({
            to: 'CONNECTED',
            reason: 'welcome-frame',
            metadata: { sessionId: welcome.sessionId }
          });
          this.#logger.info(
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
        // Phase 4.0 Part 5.F — RTT proxy. The api's current
        // ping doesn't carry a timestamp we can echo back,
        // so this measures local processing latency only.
        // Recorded into the histogram so percentiles still
        // populate; a follow-up TD upgrades to true RTT.
        const receivedAt = Date.now();
        this.#send({ type: 'pong', ts: receivedAt });
        if (this.#rttHistogram !== undefined) {
          const elapsed = Date.now() - receivedAt;
          this.#rttHistogram.record(elapsed);
        }
        return;
      }
      case 'task-assign': {
        const { payload } = typed as { payload?: TaskAssignInput };
        if (!payload || typeof payload.taskId !== 'string') {
          this.#logger.warn(
            { source: 'control-channel-ws' },
            'task-assign missing payload.taskId'
          );
          return;
        }
        this.#handleTaskAssign(payload);
        return;
      }
      case 'error': {
        this.#logger.warn(
          { source: 'control-channel-ws', frame: typed },
          'server sent error frame'
        );
        return;
      }
      default:
        this.#logger.debug(
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
      if (!this.#supportedCapabilities.has(required)) {
        this.#logger.info(
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

    const executionPromise = this.#executor(payload, emitProgress)
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
        this.#logger.warn(
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
      this.#logger.warn(
        { err, source: 'control-channel-ws' },
        'send failed'
      );
    }
  }
}
