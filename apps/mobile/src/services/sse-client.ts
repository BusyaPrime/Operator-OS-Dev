import {
  fetchEventSource,
  type EventSourceMessage
} from '@microsoft/fetch-event-source';

/**
 * Minimal wrapper over @microsoft/fetch-event-source tuned for our
 * SSE contract:
 *
 *   - Bearer auth header injected via a callback so each (re)connect
 *     reads the *current* access token (rotation-safe).
 *   - 401 mid-stream invokes `onUnauthorized()`. The wrapper does
 *     NOT retry intra-call after a refresh: the library's retry
 *     would reuse the headers captured at connect time, so it
 *     would re-send the *old* bearer. Instead, on a successful
 *     refresh the wrapper closes with reason `'reauth-needed'` so
 *     the *caller* (the screen) can call `connectSse()` again and
 *     pick up the rotated bearer via `authHeader()`. NOTE 4 —
 *     mandatory mid-stream auth-rotation path.
 *   - `lastEventId` is surfaced as the `Last-Event-ID` request
 *     header so reconnects after `'reauth-needed'` or `'fatal'`
 *     resume from `seq + 1` and the server skips the replay of
 *     deltas the client has already rendered.
 *
 * Caller treats the returned `close()` as idempotent. Calling it
 * after the server has already ended the stream is a silent no-op.
 */
export interface SseClientOptions {
  readonly url: string;
  /**
   * Returns the Authorization header value (e.g. `Bearer eyJ…`) to
   * attach to this connect, or `undefined` to send no auth.
   * Called once per `connectSse()` invocation — token rotation
   * requires the caller to re-invoke `connectSse()` after a
   * `'reauth-needed'` close.
   */
  authHeader(): Promise<string | undefined>;
  /** Called for each non-heartbeat SSE frame. */
  onMessage(message: EventSourceMessage): void;
  /**
   * Called when the server returns 401. Implementations should try
   * to refresh tokens and resolve `true` if a fresh `connectSse()`
   * call would now succeed. Resolving `false` (or throwing) closes
   * the stream with reason `'fatal'`.
   *
   * If omitted, 401 is treated as fatal.
   */
  onUnauthorized?(): Promise<boolean>;
  /**
   * Called when the connection ends. Idempotent: at most one
   * invocation per `connectSse()` call.
   *
   *   - `'server-end'`     server closed cleanly (terminal frame seen)
   *   - `'reauth-needed'`  401 + onUnauthorized resolved true; the
   *                        caller should re-invoke `connectSse()`
   *                        with the rotated bearer
   *   - `'fatal'`          unrecoverable error or 401 with refusal
   *                        to refresh
   *   - `'aborted'`        caller invoked `close()`
   */
  onClose?(reason: 'server-end' | 'reauth-needed' | 'fatal' | 'aborted'): void;
  /**
   * Called for non-401 fetch / network errors. The underlying
   * client will reconnect with backoff after this fires (unless
   * the implementation throws to abort).
   */
  onError?(error: unknown): void;
  /**
   * Resume token from a previous connection. Sent as the
   * `Last-Event-ID` request header so the server skips deltas
   * already delivered. Pass `undefined` for first connect.
   */
  lastEventId?: string;
  /**
   * Override the underlying fetch impl. Tests inject a stub that
   * returns canned Response objects. Defaults to `globalThis.fetch`.
   */
  fetchFn?: typeof fetch;
}

export interface SseConnection {
  /** Idempotent. Tears down the stream and fires onClose('aborted'). */
  close(): void;
}

type CloseReason = 'server-end' | 'reauth-needed' | 'fatal' | 'aborted';

class FatalSseError extends Error {
  readonly closeReason: CloseReason;
  constructor(message: string, closeReason: CloseReason) {
    super(message);
    this.name = 'FatalSseError';
    this.closeReason = closeReason;
  }
}

/**
 * Connect to an SSE endpoint. Returns synchronously with a handle
 * for cancellation; the actual network connect happens on a
 * floating async task. Errors are surfaced via callbacks, never
 * thrown back to the caller.
 */
export const connectSse = (options: SseClientOptions): SseConnection => {
  const ctrl = new AbortController();
  let closed = false;

  const fireClose = (reason: CloseReason): void => {
    if (closed) return;
    closed = true;
    try {
      options.onClose?.(reason);
    } catch {
      /* swallow — caller errors must not crash the stream */
    }
  };

  void runConnect(options, ctrl, fireClose, () => closed);

  return {
    close() {
      if (closed) return;
      ctrl.abort();
      fireClose('aborted');
    }
  };
};

const runConnect = async (
  options: SseClientOptions,
  ctrl: AbortController,
  fireClose: (reason: CloseReason) => void,
  isClosed: () => boolean
): Promise<void> => {
  let headers: Record<string, string>;
  try {
    headers = await buildHeaders(options);
  } catch (err) {
    options.onError?.(err);
    fireClose('fatal');
    return;
  }

  try {
    await fetchEventSource(options.url, {
      signal: ctrl.signal,
      // Keep the connection alive when the app is backgrounded — the
      // RN AppState handler in the screen decides whether to abort.
      openWhenHidden: true,
      fetch: options.fetchFn ?? globalThis.fetch,
      headers,
      async onopen(response) {
        if (
          response.ok &&
          (response.headers.get('content-type') ?? '').includes(
            'text/event-stream'
          )
        ) {
          return;
        }
        if (response.status === 401) {
          const refreshed = options.onUnauthorized
            ? await options.onUnauthorized().catch(() => false)
            : false;
          throw new FatalSseError(
            refreshed ? 'reauth-success' : 'unauthorized',
            refreshed ? 'reauth-needed' : 'fatal'
          );
        }
        throw new FatalSseError(
          `unexpected SSE response: ${response.status} ${
            response.headers.get('content-type') ?? ''
          }`,
          'fatal'
        );
      },
      onmessage(message) {
        if (isClosed()) return;
        try {
          options.onMessage(message);
        } catch (err) {
          options.onError?.(err);
          ctrl.abort();
        }
      },
      onclose() {
        // Server closed the stream cleanly. Our server only closes
        // after completed/failed/cancelled — treat clean close as
        // terminal so the library doesn't reconnect.
        throw new FatalSseError('server-end', 'server-end');
      },
      onerror(err) {
        if (err instanceof FatalSseError) {
          // Re-throw to stop the library's retry loop; the catch
          // below will fireClose with the carried reason.
          throw err;
        }
        options.onError?.(err);
        // Returning undefined lets the library back off + retry.
        return undefined;
      }
    });
    // fetchEventSource resolved without a thrown FatalSseError —
    // treat as a clean server-side end (e.g. fetch returned but
    // body finished). Defensive; in practice we hit the throw paths.
    fireClose('server-end');
  } catch (err) {
    if (isClosed()) return;
    if (err instanceof FatalSseError) {
      fireClose(err.closeReason);
      return;
    }
    fireClose('fatal');
  }
};

const buildHeaders = async (
  options: SseClientOptions
): Promise<Record<string, string>> => {
  const auth = await options.authHeader();
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (auth !== undefined) headers.Authorization = auth;
  if (options.lastEventId !== undefined) {
    headers['Last-Event-ID'] = options.lastEventId;
  }
  return headers;
};
