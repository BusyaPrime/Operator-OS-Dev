import type {
  AIResponseStream,
  StreamCompletion,
  StreamConfig,
  StreamDelta,
  StreamError,
  StreamEvent,
  StreamListener,
  StreamProgress,
  StreamProvider,
  StreamSubscription,
  StreamToolCall
} from '@operator-os/contracts';

import type { Logger } from 'pino';
import { WebSocket } from 'ws';

/**
 * Configuration for a WebSocketStreamProvider.
 *
 * The provider is one-per-agent. Each `createStream()` call
 * opens its own WS connection (simple model — avoids per-task
 * multiplexing complexity in v1). Future versions may share a
 * single WS across tasks; migration is behind this interface.
 */
export interface WebSocketStreamProviderOptions {
  /** Base URL for the WebSocket endpoint, e.g. wss://api/v1/agent/ws */
  readonly url: string;
  /** Bearer access token (HS256 JWT from auth-gateway). */
  readonly accessToken: string;
  /** Max ms to wait for initial connection before failing open. */
  readonly connectTimeoutMs?: number;
  /** Factory for creating the WebSocket (injectable for tests). */
  readonly wsFactory?: (url: string, headers: Record<string, string>) => WebSocket;
}

/**
 * WebSocketStreamProvider — sends stream events to the api over
 * a per-task WebSocket connection.
 *
 * Phase 1.4 status: the api-side endpoint `/v1/agent/ws` does
 * NOT exist yet (tracked as TD-017). This provider's logic is
 * complete — connect, emit, subscribe, close — but real network
 * integration will return ECONNREFUSED until the api side lands.
 * When that happens, the agent's `stream.createStream(...)` call
 * returns an AIResponseStream whose `emit*` methods log a warn
 * and swallow the failure so the agent continues operating.
 *
 * Subscribers (any local code that calls `subscribe(listener)`)
 * receive events regardless of whether the WS is connected —
 * local fan-out is in-memory and always works. This lets unit
 * tests drive the stream without a live WS.
 */
export class WebSocketStreamProvider implements StreamProvider {
  #options: WebSocketStreamProviderOptions;
  #logger: Logger;

  constructor(options: WebSocketStreamProviderOptions, logger: Logger) {
    this.#options = options;
    this.#logger = logger;
  }

  createStream(config: StreamConfig): AIResponseStream {
    return new WebSocketResponseStream(
      config,
      this.#options,
      this.#logger.child({ taskId: config.taskId, component: 'ws-stream' })
    );
  }
}

/** Per-task response stream backed by one WebSocket. */
class WebSocketResponseStream implements AIResponseStream {
  readonly taskId: string;

  #options: WebSocketStreamProviderOptions;
  #logger: Logger;
  #ws?: WebSocket;
  /** Ready-state promise. Resolves on open, rejects on error. */
  #ready: Promise<void>;
  #listeners = new Set<StreamListener>();
  #closed = false;

  constructor(
    config: StreamConfig,
    options: WebSocketStreamProviderOptions,
    logger: Logger
  ) {
    this.taskId = config.taskId;
    this.#options = options;
    this.#logger = logger;
    this.#ready = this.#connect();
  }

  emitToken(token: string): Promise<void> {
    return this.#send({ type: 'token', token });
  }

  emitDelta(delta: StreamDelta): Promise<void> {
    return this.#send({ type: 'delta', delta });
  }

  emitToolCall(call: StreamToolCall): Promise<void> {
    return this.#send({ type: 'tool-call', call });
  }

  emitProgress(progress: StreamProgress): Promise<void> {
    return this.#send({ type: 'progress', progress });
  }

  emitError(error: StreamError): Promise<void> {
    return this.#send({ type: 'error', error });
  }

  emitCompletion(completion: StreamCompletion): Promise<void> {
    return this.#send({ type: 'completion', completion });
  }

  subscribe(listener: StreamListener): StreamSubscription {
    this.#listeners.add(listener);
    return {
      unsubscribe: () => {
        this.#listeners.delete(listener);
      }
    };
  }

  async close(reason: 'completed' | 'cancelled' | 'error'): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#logger.debug({ reason }, 'closing stream');
    this.#listeners.clear();

    // Swallow any in-flight connect rejection so it doesn't
    // surface as an unhandled rejection after close().
    this.#ready.catch(() => {
      /* intentional — connect failures on close are noise */
    });

    if (!this.#ws) return;
    try {
      // If the socket is still CONNECTING, close() throws
      // synchronously in newer `ws` versions. Terminate
      // immediately instead — cleanly releases the socket.
      if (
        this.#ws.readyState === WebSocket.CONNECTING ||
        this.#ws.readyState === WebSocket.CLOSING ||
        this.#ws.readyState === WebSocket.CLOSED
      ) {
        this.#ws.terminate();
      } else {
        // Standard close codes: 1000 normal closure, 1011
        // internal error. Map our reason accordingly.
        const code = reason === 'error' ? 1011 : 1000;
        this.#ws.close(code, reason);
      }
    } catch (err) {
      this.#logger.warn({ err }, 'ws close threw; ignoring');
    }
  }

  // --- internals ---

  async #send(event: StreamEvent): Promise<void> {
    // Always fan out to local subscribers first — these work
    // even when the WS is down, and unit tests depend on this.
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        this.#logger.warn(
          { err, eventType: event.type },
          'local stream listener threw; continuing'
        );
      }
    }

    if (this.#closed) {
      this.#logger.debug({ eventType: event.type }, 'skip emit — stream closed');
      return;
    }

    try {
      await this.#ready;
    } catch (err) {
      this.#logger.warn(
        { err, eventType: event.type },
        'ws unreachable — local fan-out only (TD-017 pending)'
      );
      return;
    }

    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      this.#logger.warn(
        { readyState: this.#ws?.readyState, eventType: event.type },
        'ws not open — skipping network send'
      );
      return;
    }

    try {
      this.#ws.send(JSON.stringify(event));
    } catch (err) {
      this.#logger.warn({ err, eventType: event.type }, 'ws send failed');
    }
  }

  #connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.#options.accessToken}`
      };
      const factory =
        this.#options.wsFactory ??
        ((url, h) => new WebSocket(url, { headers: h }));

      let ws: WebSocket;
      try {
        ws = factory(this.#options.url, headers);
      } catch (err) {
        this.#logger.warn(
          { err },
          'ws construction threw synchronously; streaming will be local-only'
        );
        reject(err);
        return;
      }

      this.#ws = ws;

      // Keep a no-op error listener on the ws for its whole
      // lifetime. Without this, any post-connect error or
      // unhandled_error event from `ws` becomes an
      // unhandledPromiseRejection in the node process and
      // surfaces as a Vitest "Unhandled Errors" failure even
      // though the streaming logic handled it cleanly.
      ws.on('error', (err) => {
        this.#logger.debug({ err }, 'ws error (captured)');
      });

      const timeoutMs = this.#options.connectTimeoutMs ?? 10_000;
      const timeout = setTimeout(() => {
        this.#logger.warn(
          { timeoutMs },
          'ws connect timed out; streaming will be local-only until connected'
        );
        reject(new Error(`WebSocket connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.#logger.debug('ws open');
        // Server-side handshake message (hello) would go here
        // once TD-017 ships. For now, resolve and rely on the
        // server to dispatch tasks via the connection.
        resolve();
      });

      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString()) as StreamEvent;
          for (const listener of this.#listeners) {
            try {
              listener(parsed);
            } catch (err) {
              this.#logger.warn(
                { err, eventType: parsed.type },
                'listener threw on inbound event'
              );
            }
          }
        } catch (err) {
          this.#logger.warn({ err }, 'ws message parse failed');
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        this.#logger.warn({ err }, 'ws error');
        reject(err);
      });

      ws.on('close', (code, reasonBuf) => {
        this.#logger.debug(
          { code, reason: reasonBuf?.toString() },
          'ws closed'
        );
      });
    });
  }
}
