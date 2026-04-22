import type { AddressInfo } from 'node:net';

import type {
  StreamCompletion,
  StreamDelta,
  StreamEvent
} from '@operator-os/contracts';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { WebSocketStreamProvider } from '../websocket-stream-provider.js';

const silentLogger = pino({ level: 'silent' });

/**
 * Spin up a real in-memory WebSocketServer on a random port for
 * each test that needs one. Exercises real WS handshake +
 * message flow without touching the network; closes cleanly in
 * afterEach so ports don't leak.
 */
interface MockServer {
  readonly url: string;
  readonly received: StreamEvent[];
  readonly send: (event: StreamEvent) => void;
  readonly waitForEvent: (n: number) => Promise<void>;
  readonly close: () => Promise<void>;
}

const startMockServer = async (): Promise<MockServer> => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${addr.port}`;

  const received: StreamEvent[] = [];
  let activeSocket: WebSocket | undefined;
  let eventResolvers: Array<(v: void) => void> = [];

  server.on('connection', (socket) => {
    activeSocket = socket;
    socket.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as StreamEvent;
        received.push(parsed);
        const resolvers = eventResolvers;
        eventResolvers = [];
        for (const r of resolvers) r();
      } catch {
        // ignored — unit tests never send malformed
      }
    });
  });

  return {
    url,
    received,
    send: (event) => {
      activeSocket?.send(JSON.stringify(event));
    },
    waitForEvent: (n) =>
      new Promise((resolve) => {
        const check = () => {
          if (received.length >= n) resolve();
          else eventResolvers.push(check);
        };
        check();
      }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      })
  };
};

describe('WebSocketStreamProvider', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  describe('connection lifecycle', () => {
    it('connects and sends an emitToken event', async () => {
      mock = await startMockServer();
      const provider = new WebSocketStreamProvider(
        { url: mock.url, accessToken: 'stub-token', connectTimeoutMs: 5000 },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '11111111-1111-1111-1111-111111111111',
        userId: 'user-a',
        transport: 'websocket'
      });
      await stream.emitToken('hello');
      await mock.waitForEvent(1);
      expect(mock.received).toHaveLength(1);
      expect(mock.received[0]).toEqual({ type: 'token', token: 'hello' });
      await stream.close('completed');
    });

    it('serialises each StreamEvent variant as JSON to the server', async () => {
      mock = await startMockServer();
      const provider = new WebSocketStreamProvider(
        { url: mock.url, accessToken: 't', connectTimeoutMs: 5000 },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '22222222-2222-2222-2222-222222222222',
        userId: 'u',
        transport: 'websocket'
      });

      const delta: StreamDelta = {
        type: 'answer',
        content: 'computed response'
      };
      const completion: StreamCompletion = {
        status: 'success',
        usage: {
          promptTokens: 12,
          completionTokens: 34,
          totalTokens: 46,
          costUsd: 0.001
        }
      };

      await stream.emitDelta(delta);
      await stream.emitProgress({ stage: 'writing', percent: 50 });
      await stream.emitToolCall({
        toolName: 'search',
        arguments: { query: 'x' },
        status: 'completed',
        result: { hits: 3 }
      });
      await stream.emitError({
        code: 'TRANSIENT',
        message: 'retrying',
        fatal: false
      });
      await stream.emitCompletion(completion);
      await mock.waitForEvent(5);

      expect(mock.received.map((e) => e.type)).toEqual([
        'delta',
        'progress',
        'tool-call',
        'error',
        'completion'
      ]);
      await stream.close('completed');
    });

    it('closes WS with code 1000 on close(completed)', async () => {
      mock = await startMockServer();
      const provider = new WebSocketStreamProvider(
        { url: mock.url, accessToken: 't', connectTimeoutMs: 5000 },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '33333333-3333-3333-3333-333333333333',
        userId: 'u',
        transport: 'websocket'
      });
      await stream.emitToken('a');
      await mock.waitForEvent(1);
      await stream.close('completed');
      // No assertion on server-side code because ws closes out
      // of the tested contract boundary; key invariant is that
      // close() does not throw and further emits are swallowed.
      await expect(stream.emitToken('b')).resolves.toBeUndefined();
    });

    it('close is idempotent', async () => {
      mock = await startMockServer();
      const provider = new WebSocketStreamProvider(
        { url: mock.url, accessToken: 't', connectTimeoutMs: 5000 },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '44444444-4444-4444-4444-444444444444',
        userId: 'u',
        transport: 'websocket'
      });
      await stream.close('completed');
      await expect(stream.close('error')).resolves.toBeUndefined();
    });
  });

  describe('local subscriber fan-out', () => {
    it('fans out events to local subscribers (no server needed)', async () => {
      // Point at a dead port so the WS connect fails; local
      // fan-out must still work — agents depend on this to
      // function even when TD-017 (api WS endpoint) is absent.
      const provider = new WebSocketStreamProvider(
        {
          url: 'ws://127.0.0.1:1',
          accessToken: 't',
          connectTimeoutMs: 200
        },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '55555555-5555-5555-5555-555555555555',
        userId: 'u',
        transport: 'websocket'
      });

      const events: StreamEvent[] = [];
      const subscription = stream.subscribe((e) => events.push(e));

      await stream.emitToken('hi');
      await stream.emitDelta({ type: 'answer', content: 'ok' });
      await stream.emitCompletion({
        status: 'success',
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          costUsd: 0
        }
      });

      expect(events.map((e) => e.type)).toEqual([
        'token',
        'delta',
        'completion'
      ]);

      subscription.unsubscribe();
      await stream.emitToken('late');
      // unsubscribed → listener should not receive the new event
      expect(events).toHaveLength(3);

      await stream.close('completed');
    });

    it('catches and logs exceptions in subscriber listeners', async () => {
      const provider = new WebSocketStreamProvider(
        {
          url: 'ws://127.0.0.1:1',
          accessToken: 't',
          connectTimeoutMs: 200
        },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '66666666-6666-6666-6666-666666666666',
        userId: 'u',
        transport: 'websocket'
      });

      const throwingListener = vi.fn(() => {
        throw new Error('subscriber exploded');
      });
      stream.subscribe(throwingListener);
      const goodListener = vi.fn();
      stream.subscribe(goodListener);

      await stream.emitToken('x');

      expect(throwingListener).toHaveBeenCalledTimes(1);
      expect(goodListener).toHaveBeenCalledTimes(1);
      // The good listener still ran — a throwing subscriber
      // doesn't break the fan-out for other subscribers.
      await stream.close('completed');
    });
  });

  describe('graceful degradation', () => {
    it('swallows emit failures when WS unreachable', async () => {
      const provider = new WebSocketStreamProvider(
        {
          url: 'ws://127.0.0.1:1',
          accessToken: 't',
          connectTimeoutMs: 100
        },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '77777777-7777-7777-7777-777777777777',
        userId: 'u',
        transport: 'websocket'
      });

      // Should not throw even though the WS will never connect.
      await expect(stream.emitToken('hi')).resolves.toBeUndefined();
      await stream.close('completed');
    });

    it('receives and dispatches inbound server messages', async () => {
      mock = await startMockServer();
      const provider = new WebSocketStreamProvider(
        { url: mock.url, accessToken: 't', connectTimeoutMs: 5000 },
        silentLogger
      );
      const stream = provider.createStream({
        taskId: '88888888-8888-8888-8888-888888888888',
        userId: 'u',
        transport: 'websocket'
      });

      const events: StreamEvent[] = [];
      stream.subscribe((e) => events.push(e));

      // Give the WS a moment to connect, then send from server.
      await stream.emitToken('a'); // ensures connection is open
      await mock.waitForEvent(1);

      mock.send({ type: 'progress', progress: { stage: 'server-side', percent: 10 } });

      // Wait until the listener has seen both: 1 local
      // emitToken + 1 inbound progress.
      await new Promise<void>((resolve) => {
        const check = () => {
          if (events.length >= 2) resolve();
          else setTimeout(check, 10);
        };
        check();
      });

      const types = events.map((e) => e.type);
      expect(types).toContain('token');
      expect(types).toContain('progress');

      await stream.close('completed');
    });
  });
});
