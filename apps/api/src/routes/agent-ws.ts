import { agentManifestSchema } from '@operator-os/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { WebSocket as WsWebSocket } from 'ws';
import { z } from 'zod';

import type { AgentSessionRegistry } from '../services/agent-session-registry.js';

/**
 * WSS /v1/agent/ws — the control channel between the api and a
 * desktop-agent instance. Phase 2 / TD-017.
 *
 * Handshake
 *   1. Client connects with `Authorization: Bearer <JWT>` on the
 *      upgrade request. The agent-guard pre-handler runs
 *      exactly like it does for HTTP; failure closes the socket
 *      with `4001 unauthorized`.
 *   2. Socket opens. Server waits up to `helloTimeoutMs` for a
 *      `{ type: 'hello', agentId, manifest }` frame. No hello →
 *      close `4003 hello-timeout`.
 *   3. Server validates hello against `helloFrameSchema`, records
 *      a session in the registry, replies with
 *      `{ type: 'welcome', sessionId, serverFeatures }`.
 *   4. Server starts the ping loop: sends `{ type: 'ping', ts }`
 *      every `pingIntervalMs`. Client must respond with
 *      `{ type: 'pong', ts }`. No activity for `pongTimeoutMs`
 *      → close `4008 ping-timeout`.
 *
 * Client → server messages accepted after welcome:
 *   pong                client replied to a ping
 *   heartbeat-ping      client-initiated liveness ping (server
 *                       simply updates lastActivityAt + logs)
 *   task-accepted       agent acknowledged a task-assign (router
 *                       dispatch lands in Week 4; today the
 *                       server never sends task-assign, so this
 *                       message path is just logged + bumped)
 *   task-progress       in-flight progress ping
 *   task-delta          streaming fragment
 *   task-completed      terminal success
 *   task-failed         terminal failure
 *
 * Server → client messages (in Phase 2):
 *   welcome, ping, error
 *
 * Close codes:
 *   1000 normal, 1011 internal error, 4001 unauthorized,
 *   4002 hello-invalid, 4003 hello-timeout, 4004 duplicate-agent,
 *   4008 ping-timeout.
 */

const helloFrameSchema = z.object({
  type: z.literal('hello'),
  agentId: z.string().uuid(),
  manifest: z
    .object({
      manifestVersion: z.literal('1'),
      providerId: z.string().min(1),
      providerVersion: z.string().min(1),
      displayName: z.string().min(1),
      description: z.string(),
      author: z.string().min(1),
      license: z.string().min(1),
      capabilities: z.array(z.unknown()),
      requirements: z.record(z.string(), z.unknown())
    })
    .passthrough()
});

const postWelcomeFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong'), ts: z.number().optional() }),
  z.object({ type: z.literal('heartbeat-ping') }),
  z.object({ type: z.literal('task-accepted'), taskId: z.string().min(1) }),
  z.object({
    type: z.literal('task-rejected'),
    taskId: z.string().min(1),
    reason: z.string().optional()
  }),
  z.object({
    type: z.literal('task-progress'),
    taskId: z.string().min(1),
    progress: z.unknown().optional()
  }),
  z.object({
    type: z.literal('task-delta'),
    taskId: z.string().min(1),
    delta: z.unknown().optional()
  }),
  z.object({
    type: z.literal('task-completed'),
    taskId: z.string().min(1),
    output: z.unknown().optional()
  }),
  z.object({
    type: z.literal('task-failed'),
    taskId: z.string().min(1),
    error: z.unknown().optional()
  })
]);

export type AgentWsIncomingFrame = z.infer<typeof postWelcomeFrameSchema>;

/**
 * Server → agent `task-assign` frame payload. Schema is a mirror of
 * the Phase 3.2 WS spec (Gate 3.2.A Section 7).
 */
export interface TaskAssignPayload {
  readonly taskId: string;
  readonly prompt: string;
  readonly capabilities: readonly string[];
  readonly metadata: {
    readonly userId: string;
    readonly createdAt: string;
    readonly expireAt: string;
  };
}

/**
 * Outbound helper — the dispatch pipeline (composed in app.ts) invokes
 * this once the router picks an agent. Returns false on send failure
 * so the caller can treat the agent as unreachable and re-dispatch to
 * a sibling agent rather than silently dropping the task.
 */
export const sendTaskAssign = (
  socket: WsWebSocket,
  payload: TaskAssignPayload
): boolean => {
  try {
    socket.send(JSON.stringify({ type: 'task-assign', payload }));
    return true;
  } catch {
    return false;
  }
};

/**
 * Callbacks invoked on inbound task-related frames so the route layer
 * stays pure transport and the dispatch orchestration (router +
 * scheduler + Firestore) lives in a single composition root.
 *
 * Callbacks run fire-and-forget; any throw is logged and swallowed so
 * an orchestration bug cannot collapse the WS connection.
 */
export interface AgentWsTaskCallbacks {
  onTaskAccepted?(params: {
    readonly sessionId: string;
    readonly agentId: string;
    readonly taskId: string;
  }): Promise<void> | void;

  onTaskRejected?(params: {
    readonly sessionId: string;
    readonly agentId: string;
    readonly taskId: string;
    readonly reason?: string;
  }): Promise<void> | void;
}

export interface AgentWsRouteOptions {
  readonly agentGuard: preHandlerAsyncHookHandler;
  readonly sessionRegistry: AgentSessionRegistry;
  readonly helloTimeoutMs?: number;
  readonly pingIntervalMs?: number;
  readonly pongTimeoutMs?: number;
  /** Test clock; defaults to Date.now. */
  readonly now?: () => number;
  /** Phase 3.2 task-dispatch callbacks. Absent in Phase 2 tests. */
  readonly taskCallbacks?: AgentWsTaskCallbacks;
}

const DEFAULTS = {
  helloTimeoutMs: 10_000,
  pingIntervalMs: 30_000,
  pongTimeoutMs: 60_000
} as const;

const SERVER_FEATURES = ['task-dispatch', 'stream-responses'] as const;

export const registerAgentWsRoute = async (
  app: FastifyInstance,
  options: AgentWsRouteOptions
): Promise<void> => {
  const helloTimeoutMs = options.helloTimeoutMs ?? DEFAULTS.helloTimeoutMs;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULTS.pingIntervalMs;
  const pongTimeoutMs = options.pongTimeoutMs ?? DEFAULTS.pongTimeoutMs;
  const now = options.now ?? (() => Date.now());

  // App-scoped logger. Request-scoped child loggers blow up under
  // @fastify/websocket's injectWS helper because trustProxy's
  // pino req-serializer reads `request.ip` → `raw.socket.remoteAddress`
  // which is undefined on an injected upgrade. Server-level logs
  // lose per-request reqId correlation but gain sessionId, which
  // is the correlation key that matters for WS.
  const baseLogger = app.log.child({ component: 'agent-ws' });

  // Register inside an encapsulated scope per the @fastify/websocket
  // idiom. A top-level `app.get(..., { websocket: true })` in a
  // crowded buildServer wiring lost its WS-ness in practice — the
  // handler fired on the plain HTTP path with (request, reply)
  // instead of (socket, request). Wrapping in `app.register()`
  // gives the WS route its own hook plane and restores the
  // documented behaviour.
  await app.register(async (scope) => {
    scope.get(
      '/v1/agent/ws',
      {
        websocket: true,
        preValidation: options.agentGuard
      },
      (socket, request) => {
        const logger = baseLogger;
        const userId =
          request.authSession?.currentUser?.operatorId ?? 'unknown';

      // Session not yet established — the hello must come first.
      let sessionId: string | undefined;
      let pingTimer: NodeJS.Timeout | undefined;
      let helloTimer: NodeJS.Timeout | undefined;

      const stopTimers = (): void => {
        if (pingTimer !== undefined) {
          clearInterval(pingTimer);
          pingTimer = undefined;
        }
        if (helloTimer !== undefined) {
          clearTimeout(helloTimer);
          helloTimer = undefined;
        }
      };

      const closeWith = (code: number, reason: string): void => {
        stopTimers();
        try {
          socket.close(code, reason);
        } catch {
          try {
            socket.terminate();
          } catch {
            /* swallow */
          }
        }
      };

      const sendJson = (payload: unknown): void => {
        try {
          socket.send(JSON.stringify(payload));
        } catch (err) {
          logger.warn({ err }, 'ws send failed');
        }
      };

      helloTimer = setTimeout(() => {
        logger.info({ userId, helloTimeoutMs }, 'hello timeout; closing');
        closeWith(4003, 'hello-timeout');
      }, helloTimeoutMs);

      const startPingLoop = (): void => {
        pingTimer = setInterval(() => {
          if (sessionId === undefined) return;
          const session = options.sessionRegistry.byId(sessionId);
          if (session === undefined) return;
          const last = Date.parse(session.lastActivityAt);
          const elapsed = now() - last;
          if (elapsed > pongTimeoutMs) {
            logger.warn(
              { sessionId, elapsed, pongTimeoutMs },
              'ping timeout; closing'
            );
            closeWith(4008, 'ping-timeout');
            options.sessionRegistry.removeBySessionId(sessionId);
            return;
          }
          sendJson({ type: 'ping', ts: now() });
        }, pingIntervalMs);
        // Allow the node event loop to exit during shutdown
        // without waiting on this timer.
        if (typeof pingTimer.unref === 'function') pingTimer.unref();
      };

      const onHello = (frame: unknown): void => {
        const parsed = helloFrameSchema.safeParse(frame);
        if (!parsed.success) {
          logger.warn(
            { issues: parsed.error.issues },
            'hello validation failed'
          );
          sendJson({
            type: 'error',
            code: 'hello-invalid',
            message: 'hello frame did not match schema'
          });
          closeWith(4002, 'hello-invalid');
          return;
        }

        // Phase 3.2: validate manifest capabilities against the runtime
        // schema in @operator-os/contracts. An agent whose manifest
        // does not type-check at this layer is rejected here so the
        // router never observes malformed capability declarations.
        const manifestValidation = agentManifestSchema.safeParse(
          parsed.data.manifest
        );
        if (!manifestValidation.success) {
          logger.warn(
            {
              agentId: parsed.data.agentId,
              issues: manifestValidation.error.issues
            },
            'hello manifest failed runtime validation'
          );
          sendJson({
            type: 'error',
            code: 'manifest-invalid',
            message: 'manifest capabilities failed runtime validation'
          });
          closeWith(4002, 'manifest-invalid');
          return;
        }

        if (helloTimer !== undefined) {
          clearTimeout(helloTimer);
          helloTimer = undefined;
        }

        const session = options.sessionRegistry.register({
          agentId: parsed.data.agentId,
          userId,
          socket: socket as unknown as WsWebSocket,
          manifest: parsed.data.manifest
        });
        sessionId = session.sessionId;

        sendJson({
          type: 'welcome',
          sessionId: session.sessionId,
          serverFeatures: SERVER_FEATURES
        });

        logger.info(
          {
            sessionId: session.sessionId,
            agentId: session.agentId,
            userId
          },
          'agent session established'
        );

        startPingLoop();
      };

      const onPostWelcome = (frame: unknown): void => {
        if (sessionId === undefined) {
          // Shouldn't happen — post-welcome handling only runs
          // after onHello records a session. Defensive reject.
          closeWith(1011, 'internal-error');
          return;
        }
        const parsed = postWelcomeFrameSchema.safeParse(frame);
        if (!parsed.success) {
          sendJson({
            type: 'error',
            code: 'frame-invalid',
            message: 'frame did not match schema'
          });
          return;
        }
        options.sessionRegistry.touch(sessionId);

        switch (parsed.data.type) {
          case 'pong':
          case 'heartbeat-ping':
            // Touch already handled above — nothing else to do.
            return;
          case 'task-accepted': {
            logger.info(
              {
                sessionId,
                messageType: parsed.data.type,
                taskId: parsed.data.taskId
              },
              'task-accepted received'
            );
            if (options.taskCallbacks?.onTaskAccepted) {
              const session = options.sessionRegistry.byId(sessionId);
              const agentId = session?.agentId ?? 'unknown';
              void Promise.resolve(
                options.taskCallbacks.onTaskAccepted({
                  sessionId,
                  agentId,
                  taskId: parsed.data.taskId
                })
              ).catch((err) => {
                logger.warn(
                  { err, sessionId, taskId: parsed.data.taskId },
                  'onTaskAccepted callback threw'
                );
              });
            }
            return;
          }
          case 'task-rejected': {
            logger.info(
              {
                sessionId,
                taskId: parsed.data.taskId,
                reason: parsed.data.reason
              },
              'task-rejected received'
            );
            if (options.taskCallbacks?.onTaskRejected) {
              const session = options.sessionRegistry.byId(sessionId);
              const agentId = session?.agentId ?? 'unknown';
              void Promise.resolve(
                options.taskCallbacks.onTaskRejected({
                  sessionId,
                  agentId,
                  taskId: parsed.data.taskId,
                  reason: parsed.data.reason
                })
              ).catch((err) => {
                logger.warn(
                  { err, sessionId, taskId: parsed.data.taskId },
                  'onTaskRejected callback threw'
                );
              });
            }
            return;
          }
          case 'task-progress':
          case 'task-delta':
          case 'task-completed':
          case 'task-failed':
            // Phase 3.3 scope: persist streaming / terminal state.
            // Phase 3.2 logs only; see "End-to-end Task Flow" doc.
            logger.info(
              {
                sessionId,
                messageType: parsed.data.type,
                taskId: parsed.data.taskId
              },
              'task-channel message received (logged only in Phase 3.2)'
            );
            return;
          default:
            // Exhaustiveness check — TS ensures we covered the union.
            exhaustive(parsed.data);
        }
      };

      socket.on('message', (raw) => {
        let json: unknown;
        try {
          json = JSON.parse(raw.toString());
        } catch (err) {
          logger.warn({ err }, 'ws frame was not valid JSON');
          sendJson({
            type: 'error',
            code: 'frame-not-json',
            message: 'message must be valid JSON'
          });
          return;
        }

        if (sessionId === undefined) {
          onHello(json);
        } else {
          onPostWelcome(json);
        }
      });

      socket.on('close', () => {
        logger.info({ sessionId }, 'agent socket closed');
        stopTimers();
        if (sessionId !== undefined) {
          options.sessionRegistry.removeBySessionId(sessionId);
        }
      });

      socket.on('error', (err) => {
        logger.warn({ err, sessionId }, 'agent socket errored');
      });
    }
  );
  });

  // Clean shutdown — close every live session with 1001 (going
  // away). Prevents a zombie connection persisting across a
  // deploy rolling restart.
  app.addHook('onClose', async () => {
    options.sessionRegistry.closeAll(1001, 'server-shutdown');
  });
};

// Compile-time exhaustiveness guard — if the switch above grows a
// new message type without a case, this emits a TS error.
const exhaustive = (x: never): never => {
  throw new Error(`unhandled frame type: ${JSON.stringify(x)}`);
};
