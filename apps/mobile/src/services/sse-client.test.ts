import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectSse, type SseClientOptions } from './sse-client.js';

/**
 * Test stub for `@microsoft/fetch-event-source`. Captures the
 * options object the wrapper passes in and exposes hooks that the
 * test drives to simulate server behaviour:
 *
 *   - `respondOpen(status, contentType)` → invokes `onopen`
 *   - `emitMessage(id, kind, payload)` → invokes `onmessage`
 *   - `serverClose()` → invokes `onclose`
 *   - `networkError(err)` → invokes `onerror`
 *
 * The mock resolves the underlying `fetchEventSource` promise only
 * when one of: `onopen` throws, `onclose` throws, `onerror` throws,
 * or the abort signal aborts. That mirrors the library's contract
 * closely enough for our wrapper's behaviour to be verifiable.
 */
interface ConnectAttempt {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
  open(status: number, contentType?: string): Promise<void>;
  message(id: string, data: string): void;
  serverClose(): void;
  networkError(err: unknown): void;
  resolve(): void;
}

const attempts: ConnectAttempt[] = [];

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(
    (
      url: string,
      opts: {
        headers: Record<string, string>;
        signal: AbortSignal;
        onopen: (response: Response) => Promise<void> | void;
        onmessage: (msg: { id?: string; data: string }) => void;
        onclose: () => void;
        onerror: (err: unknown) => void | undefined;
      }
    ) => {
      let resolveAttempt!: () => void;
      let rejectAttempt!: (err: unknown) => void;
      const settled = new Promise<void>((resolve, reject) => {
        resolveAttempt = resolve;
        rejectAttempt = reject;
      });

      const dispatchToOnError = (err: unknown): boolean => {
        // Returns true if the library should keep running (consumer
        // returned undefined). Returns false if the library should
        // settle (consumer re-threw).
        try {
          const handled = opts.onerror(err);
          return handled === undefined;
        } catch (escaped) {
          rejectAttempt(escaped);
          return false;
        }
      };

      const attempt: ConnectAttempt = {
        url,
        headers: opts.headers,
        signal: opts.signal,
        async open(status, contentType = 'text/event-stream') {
          const headers = new Headers();
          if (contentType !== '') headers.set('content-type', contentType);
          const response = new Response(null, { status, headers });
          try {
            await opts.onopen(response);
          } catch (err) {
            dispatchToOnError(err);
          }
        },
        message(id, data) {
          opts.onmessage({ id, data });
        },
        serverClose() {
          try {
            opts.onclose();
          } catch (err) {
            dispatchToOnError(err);
          }
        },
        networkError(err) {
          dispatchToOnError(err);
        },
        resolve() {
          resolveAttempt();
        }
      };
      attempts.push(attempt);
      // Listen for abort so close() exits the test cleanly.
      opts.signal.addEventListener('abort', () => resolveAttempt());
      // Do NOT swallow the rejection — the wrapper's outer try/catch
      // is what consumes it and fires the appropriate onClose.
      return settled;
    }
  )
}));

afterEach(() => {
  attempts.length = 0;
  vi.clearAllMocks();
});

const baseOptions = (
  overrides: Partial<SseClientOptions> = {}
): SseClientOptions => ({
  url: 'https://api/v1/tasks/abc/stream',
  authHeader: async () => 'Bearer initial-token',
  onMessage: vi.fn(),
  ...overrides
});

describe('connectSse — auth header injection', () => {
  it('attaches Authorization from authHeader() and Accept: text/event-stream', async () => {
    connectSse(baseOptions());
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.headers).toEqual({
      Accept: 'text/event-stream',
      Authorization: 'Bearer initial-token'
    });
  });

  it('omits Authorization when authHeader returns undefined', async () => {
    connectSse(baseOptions({ authHeader: async () => undefined }));
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts[0]!.headers).toEqual({
      Accept: 'text/event-stream'
    });
  });

  it('attaches Last-Event-ID when the caller passes a resume seq', async () => {
    connectSse(baseOptions({ lastEventId: '42' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts[0]!.headers['Last-Event-ID']).toBe('42');
  });
});

describe('connectSse — message + close lifecycle', () => {
  it('forwards onmessage payloads to the consumer', async () => {
    const onMessage = vi.fn();
    connectSse(baseOptions({ onMessage }));
    await Promise.resolve();
    await Promise.resolve();
    await attempts[0]!.open(200);
    attempts[0]!.message('1', '{"kind":"delta","delta":{"seq":1}}');
    expect(onMessage).toHaveBeenCalledWith({
      id: '1',
      data: '{"kind":"delta","delta":{"seq":1}}'
    });
  });

  it('fires onClose("server-end") when the server closes cleanly', async () => {
    const onClose = vi.fn();
    connectSse(baseOptions({ onClose }));
    await Promise.resolve();
    await Promise.resolve();
    await attempts[0]!.open(200);
    attempts[0]!.serverClose();
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledWith('server-end');
  });

  it('fires onClose("aborted") on close() and is idempotent', async () => {
    const onClose = vi.fn();
    const conn = connectSse(baseOptions({ onClose }));
    await Promise.resolve();
    await Promise.resolve();
    conn.close();
    conn.close();
    expect(onClose).toHaveBeenCalledExactlyOnceWith('aborted');
  });
});

describe('connectSse — 401 mid-stream (NOTE 4)', () => {
  it('with onUnauthorized resolving true, fires onClose("reauth-needed") so the screen reconnects', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    connectSse(baseOptions({ onUnauthorized, onClose }));
    await Promise.resolve();
    await Promise.resolve();
    await attempts[0]!.open(401, 'application/json');
    await Promise.resolve();
    await Promise.resolve();
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith('reauth-needed');
  });

  it('with onUnauthorized resolving false, fires onClose("fatal")', async () => {
    const onUnauthorized = vi.fn().mockResolvedValue(false);
    const onClose = vi.fn();
    connectSse(baseOptions({ onUnauthorized, onClose }));
    await Promise.resolve();
    await Promise.resolve();
    await attempts[0]!.open(401, 'application/json');
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledWith('fatal');
  });

  it('without onUnauthorized, 401 is fatal', async () => {
    const onClose = vi.fn();
    connectSse(baseOptions({ onClose }));
    await Promise.resolve();
    await Promise.resolve();
    await attempts[0]!.open(401, 'application/json');
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledWith('fatal');
  });

  it('end-to-end NOTE 4: 401 mid-stream → refresh → reconnect with rotated Bearer + Last-Event-ID, no delta loss', async () => {
    // Simulates the exact screen-level reconnect choreography.
    const messages: Array<{ id?: string; data: string }> = [];
    let currentToken = 'Bearer t1';
    const onUnauthorized = vi.fn(async () => {
      currentToken = 'Bearer t2-rotated';
      return true;
    });

    const open = (lastEventId?: string): void => {
      connectSse(
        baseOptions({
          authHeader: async () => currentToken,
          lastEventId,
          onUnauthorized,
          onMessage: (m) => messages.push(m),
          onClose: (reason) => {
            if (reason === 'reauth-needed') {
              // Mirror the screen's reconnect: pass the highest seq
              // we received so the server skips the replay.
              const lastSeq = messages[messages.length - 1]?.id;
              open(lastSeq);
            }
          }
        })
      );
    };

    open();
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.headers.Authorization).toBe('Bearer t1');

    // Server delivers seq=1, seq=2, then a 401 on the next read.
    await attempts[0]!.open(200);
    attempts[0]!.message(
      '1',
      JSON.stringify({
        kind: 'delta',
        delta: { seq: 1, delta: 'hello ', timestamp: 'x' }
      })
    );
    attempts[0]!.message(
      '2',
      JSON.stringify({
        kind: 'delta',
        delta: { seq: 2, delta: 'world', timestamp: 'x' }
      })
    );

    // 401 mid-stream — but @microsoft/fetch-event-source surfaces
    // 401s through `onopen` on (re)connect, not through the open
    // stream. Simulate the reconnect path the library would take:
    // signal abort, open a new attempt, server returns 401.
    // Our test stub doesn't reconnect itself; instead we simulate
    // the screen's discovery of the 401 by triggering a fresh
    // attempt via a server-driven close + re-open with 401.
    // The cleanest way: drive the 401 directly on the existing
    // attempt by treating onopen as still-pending. (The wrapper's
    // onopen handler is called by our stub on .open(); each .open
    // call runs the wrapper's 401 logic.)
    await attempts[0]!.open(401, 'application/json');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The wrapper fires onClose('reauth-needed') → screen calls
    // open() again with rotated bearer + Last-Event-ID = '2'.
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.headers.Authorization).toBe('Bearer t2-rotated');
    expect(attempts[1]!.headers['Last-Event-ID']).toBe('2');

    // Server resumes from seq=3 on the new connection — verify the
    // delta is delivered and added to the same messages array,
    // proving no delta was lost across the reauth.
    await attempts[1]!.open(200);
    attempts[1]!.message(
      '3',
      JSON.stringify({
        kind: 'delta',
        delta: { seq: 3, delta: '!', timestamp: 'x' }
      })
    );
    expect(messages.map((m) => m.id)).toEqual(['1', '2', '3']);
  });
});

describe('connectSse — non-401 errors', () => {
  it('forwards non-401 fetch errors via onError but does not close', async () => {
    const onError = vi.fn();
    const onClose = vi.fn();
    connectSse(baseOptions({ onError, onClose }));
    await Promise.resolve();
    await Promise.resolve();
    attempts[0]!.networkError(new Error('boom'));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('throws fatal on non-200 non-401 open response (e.g. 500)', async () => {
    const onClose = vi.fn();
    connectSse(baseOptions({ onClose }));
    await Promise.resolve();
    await Promise.resolve();
    await attempts[0]!.open(500, 'application/json');
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).toHaveBeenCalledWith('fatal');
  });
});
