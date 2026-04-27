import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { ApiEnv } from '@operator-os/config';

import { AccessTokenSecretLoader } from './integrations/signing-secret.js';
import { AccessTokenVerifier } from './integrations/access-token-verifier.js';
import { BigQueryAnalyticsWriter } from './integrations/bigquery.js';
import { FirebaseAuthService } from './integrations/auth.js';
import { createAgentTokenGuard } from './integrations/agent-token-guard.js';
import { LoggingAuditWriter } from './integrations/audit-log.js';
import { FirestoreOperatorRepository } from './integrations/firestore.js';
import {
  FirestoreAgentRepository,
  type AgentRepository
} from './integrations/firestore-agent-repository.js';
import { PubSubPublisher } from './integrations/pubsub.js';
import { SecretManagerAccessor } from './integrations/secrets.js';
import { GcsStorageService } from './integrations/storage.js';
import { TasksQueueClient } from './integrations/tasks.js';
import { IntegrationError } from './integrations/runtime.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAgentRoutes } from './routes/agent.js';
import {
  registerAgentWsRoute,
  sendTaskAssign,
  type AgentWsTaskCallbacks
} from './routes/agent-ws.js';
import { registerCostRoutes } from './routes/cost.js';
import {
  registerInternalPubsubRoutes,
  registerInternalTasksRoutes,
  type DispatchHandler
} from './routes/internal-tasks.js';
import { registerAgentRegistrationRoutes } from './routes/agent-registration.js';
import { registerOperatorRoutes } from './routes/operator.js';
import { registerTaskRoutes } from './routes/tasks.js';
import {
  GoogleOidcVerifier,
  createGoogleOidcGuard
} from './middleware/google-oidc-verifier.js';
import { VertexAIProvider } from './providers/index.js';
import { buildReadinessResponse } from './readiness.js';
import { createAgentSessionRegistry } from './services/agent-session-registry.js';
import { AlertsService } from './services/alerts.js';
import { CommandsService } from './services/commands.js';
import { CostService } from './services/cost.js';
import { ExportsService } from './services/exports.js';
import { createIdempotencyCache } from './services/idempotency-cache.js';
import { SessionsService } from './services/sessions.js';
import { TaskDispatchPublisher } from './services/task-dispatch-publisher.js';
import { TaskRetryScheduler } from './services/task-retry-scheduler.js';
import { createTaskRouter } from './services/task-router.js';
import { createTaskEventBus } from './services/task-event-bus.js';
import type { AIProvider } from './types.js';

interface BuildServerOptions {
  aiProvider?: AIProvider;
  /**
   * Defaults to `true`. Tests disable it because
   * @fastify/websocket's `injectWS` helper produces a raw socket
   * without a `remoteAddress`, which pino's req-serializer reads
   * through `request.ip` → `proxyaddr` and then crashes during
   * the pre-upgrade "incoming request" log. Production always
   * wants it on (Cloud Run terminates TLS upstream).
   */
  trustProxy?: boolean;
  /**
   * Phase 4.0 agent registration injection seam. Tests pass an
   * in-memory fake; production omits to take the real
   * FirestoreAgentRepository (which has no fallback because
   * agents are auth root-of-trust).
   */
  agentRepository?: AgentRepository;
}

export const buildServer = (config: ApiEnv, options: BuildServerOptions = {}) => {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      base: {
        service: config.API_SERVICE_NAME,
        environment: config.NODE_ENV
      }
    },
    trustProxy: options.trustProxy ?? true
  });

  app.decorateRequest('authSession', undefined);
  app.decorateRequest('currentUser', undefined);

  // Register @fastify/websocket (Phase 2 — TD-017). Keeps ws
  // support inside the same Fastify bootstrap so JWT middleware,
  // error handler, and logger all apply to WS upgrade requests
  // exactly like they apply to HTTP. Explicit max-payload guard
  // here — agent-side messages are small JSON control frames
  // and a multi-MB payload would be a bug worth surfacing.
  void app.register(fastifyWebsocket, {
    options: {
      maxPayload: 1_048_576 // 1 MiB
    }
  });

  const aiProvider =
    options.aiProvider ??
    new VertexAIProvider({
      project: config.GOOGLE_CLOUD_PROJECT,
      location: config.VERTEX_LOCATION,
      model: config.VERTEX_MODEL
    });
  const accessTokenSecretLoader = new AccessTokenSecretLoader(config, app.log);
  const accessTokenVerifier = new AccessTokenVerifier(
    config,
    app.log,
    accessTokenSecretLoader
  );
  const authService = new FirebaseAuthService(config, app.log, accessTokenVerifier);
  const firestoreRepository = new FirestoreOperatorRepository(config, app.log);
  const pubSubPublisher = new PubSubPublisher(config, app.log);
  const tasksQueue = new TasksQueueClient(config, app.log);
  const storageService = new GcsStorageService(config, app.log);
  const analyticsWriter = new BigQueryAnalyticsWriter(config, app.log);
  const secretsAccessor = new SecretManagerAccessor(config, app.log);
  const commandsService = new CommandsService({
    analyticsWriter,
    logger: app.log,
    repository: firestoreRepository,
    storageService,
    tasksQueue
  });
  const sessionsService = new SessionsService({
    analyticsWriter,
    logger: app.log,
    pubSubPublisher,
    repository: firestoreRepository
  });
  const alertsService = new AlertsService({
    analyticsWriter,
    logger: app.log,
    pubSubPublisher,
    repository: firestoreRepository
  });
  const exportsService = new ExportsService({
    logger: app.log,
    repository: firestoreRepository,
    storageService,
    tasksQueue
  });
  const costService = new CostService();
  const agentSessionRegistry = createAgentSessionRegistry();
  const taskIdempotencyCache = createIdempotencyCache();
  const operatorModules = [
    authService,
    firestoreRepository,
    pubSubPublisher,
    tasksQueue,
    storageService,
    analyticsWriter,
    secretsAccessor,
    commandsService,
    sessionsService,
    alertsService,
    exportsService,
    {
      name: 'vertex',
      describeReadiness: () => aiProvider.describeReadiness()
    }
  ] as const;
  const buildReadiness = () => buildReadinessResponse(config, operatorModules);

  app.addHook('onReady', async () => {
    app.log.info(
      {
        provider: aiProvider.name,
        model: aiProvider.model,
        project: config.GOOGLE_CLOUD_PROJECT,
        location: config.VERTEX_LOCATION
      },
      'api scaffold ready'
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IntegrationError) {
      reply.status(error.statusCode).send({
        code: error.code,
        dependency: error.dependency,
        details: error.details,
        message: error.message,
        requestId: request.id
      });
      return;
    }

    request.log.error({ err: error }, 'request failed');
    reply.status(500).send({
      message: 'Internal server error',
      requestId: request.id
    });
  });

  void registerHealthRoutes(app, {
    buildReadiness,
    config
  });
  void registerOperatorRoutes(app, {
    authService,
    buildReadiness,
    config,
    repository: firestoreRepository
  });
  const agentAudience =
    config.AGENT_AUDIENCE ??
    config.TASKS_TARGET_BASE_URL ??
    'https://operator-os-api-m545sz2isq-ez.a.run.app';

  void registerAgentRoutes(app, {
    alertsService,
    authGuard: authService.createAgentGuard(agentAudience),
    commandsService,
    exportsService,
    pubSubPublisher,
    repository: firestoreRepository,
    sessionsService
  });
  void registerAiRoutes(app, {
    aiProvider,
    authGuard: authService.createRequiredGuard()
  });
  void registerCostRoutes(app, {
    costService,
    repository: firestoreRepository,
    agentGuard: authService.createAgentGuard(agentAudience),
    userGuard: authService.createRequiredGuard()
  });
  // Phase 3.2 infrastructure — always constructed (each service has
  // its own ADC-absent record-only fallback, so boot is safe even in
  // dev/test). The Pub/Sub PUSH receiver routes below are still gated
  // on PUBSUB_PUSH_AUDIENCE because OIDC verification needs an
  // explicit audience.
  const taskDispatchPublisher = new TaskDispatchPublisher(config, app.log);
  const taskRouter = createTaskRouter({
    sessionRegistry: agentSessionRegistry
  });
  const taskRetryScheduler = new TaskRetryScheduler(config, app.log);

  // Phase 3.3 SSE event bus: in-memory pub/sub keyed by taskId.
  // Subscribers = SSE handlers; publishers = WS task-callbacks.
  // Single-instance scope per DP-2; TD-041 tracks Redis migration.
  const taskEventBus = createTaskEventBus();

  // Per-task seq counter for SSE Last-Event-ID. Lives next to the
  // bus because it is the bus-side numbering that clients see in
  // SSE `id:` fields. Cleared on terminal events.
  const taskSeqCounters = new Map<string, number>();
  const nextTaskSeq = (taskId: string): number => {
    const next = (taskSeqCounters.get(taskId) ?? 0) + 1;
    taskSeqCounters.set(taskId, next);
    return next;
  };

  const MAX_DISPATCH_ATTEMPTS = 5;

  /**
   * Compose dispatch: router.findMatchingAgent → WS task-assign →
   * Firestore state transition. No match → Cloud Tasks retry or DLQ
   * on exhaustion. A null task document is a terminal failure (cannot
   * dispatch something we don't know about).
   */
  const dispatch: DispatchHandler = async ({ taskId, attempt }) => {
    const task = await firestoreRepository.getTaskByIdInternal(taskId);
    if (!task) {
      app.log.warn(
        { taskId, attempt, source: 'dispatch' },
        'dispatch: task not found in Firestore'
      );
      return { kind: 'failed', reason: 'task not found' };
    }

    const agent = taskRouter.findMatchingAgent({
      capabilities: task.capabilities
    });

    if (agent) {
      const sent = sendTaskAssign(agent.socket, {
        taskId,
        prompt: task.prompt,
        capabilities: task.capabilities,
        metadata: {
          userId: task.userId,
          createdAt: task.createdAt,
          expireAt: task.expireAt
        }
      });
      if (!sent) {
        // Socket looked alive to the router but send failed. Treat as
        // no-match so the retry path picks a sibling agent via
        // round-robin. No Firestore update — status stays where it
        // was; the retry attempt will update on its next pass.
        app.log.warn(
          { taskId, agentId: agent.agentId, sessionId: agent.sessionId },
          'dispatch: sendTaskAssign failed; scheduling retry'
        );
        if (attempt < MAX_DISPATCH_ATTEMPTS) {
          await taskRetryScheduler.scheduleRetry({
            taskId,
            attempt: attempt + 1
          });
          return {
            kind: 'no-match',
            willRetry: true,
            nextAttempt: attempt + 1
          };
        }
        return { kind: 'no-match', willRetry: false };
      }
      await firestoreRepository.updateTask(taskId, {
        status: 'assigned',
        assignedAgentId: agent.agentId
      });
      return { kind: 'assigned', agentSessionId: agent.sessionId };
    }

    // No matching agent.
    if (attempt >= MAX_DISPATCH_ATTEMPTS) {
      await taskDispatchPublisher.publishDlq({
        taskId,
        reason: 'no agent matched required capabilities',
        attempts: attempt
      });
      await firestoreRepository.updateTask(taskId, {
        status: 'failed',
        error: {
          code: 'no_matching_agent',
          message: 'Dispatch exhausted max attempts without a matching agent.'
        }
      });
      return { kind: 'no-match', willRetry: false };
    }

    await taskRetryScheduler.scheduleRetry({
      taskId,
      attempt: attempt + 1
    });
    await firestoreRepository.updateTask(taskId, { status: 'queued' });
    return {
      kind: 'no-match',
      willRetry: true,
      nextAttempt: attempt + 1
    };
  };

  const taskCallbacks: AgentWsTaskCallbacks = {
    async onTaskAccepted(params) {
      // Status is already 'assigned' from the dispatch that sent the
      // task-assign frame; the agent acknowledging is primarily an
      // ops marker. Phase 3.3 also transitions to 'executing' to
      // mirror the agent state machine on the user-visible task.
      app.log.info(
        {
          source: 'agent-ws.taskCallbacks',
          sessionId: params.sessionId,
          agentId: params.agentId,
          taskId: params.taskId
        },
        'task-accepted acknowledged'
      );
      const seq = nextTaskSeq(params.taskId);
      taskEventBus.publish(params.taskId, {
        kind: 'status',
        status: 'executing',
        seq
      });
      await firestoreRepository.updateTask(params.taskId, {
        status: 'executing'
      });
    },

    async onTaskRejected(params) {
      // NOTE 3 (Phase 3.3): if the agent rejects with reason
      // 'already-executing', the task is being processed by this
      // (or another) agent already and a Pub/Sub redelivery just
      // raced through. NO-OP — do NOT re-queue, do NOT increment
      // dispatchAttempts, do NOT scheduleRetry.
      const reason = params.reason ?? '';
      if (reason.includes('already-executing')) {
        app.log.info(
          {
            source: 'agent-ws.taskCallbacks',
            sessionId: params.sessionId,
            agentId: params.agentId,
            taskId: params.taskId,
            reason
          },
          'task-rejected with already-executing reason — no-op (not re-queued)'
        );
        return;
      }

      // Otherwise re-queue + schedule a fresh retry. Attempt counter
      // resets; TD-044 tracks the dispatchAttempts unification.
      app.log.info(
        {
          source: 'agent-ws.taskCallbacks',
          sessionId: params.sessionId,
          agentId: params.agentId,
          taskId: params.taskId,
          reason
        },
        'task-rejected -> re-queueing'
      );
      await firestoreRepository.updateTask(params.taskId, {
        status: 'queued',
        assignedAgentId: null
      });
      await taskRetryScheduler.scheduleRetry({
        taskId: params.taskId,
        attempt: 1
      });
    },

    async onTaskDelta(params) {
      // Persist + publish. Persist first so a client that connects
      // mid-stream (or reconnects on Last-Event-ID gap) sees the
      // delta in Firestore replay.
      const seq = nextTaskSeq(params.taskId);
      const deltaText =
        typeof params.delta === 'string'
          ? params.delta
          : JSON.stringify(params.delta ?? '');
      const delta = {
        seq,
        delta: deltaText,
        timestamp: new Date().toISOString()
      };
      await firestoreRepository.appendTaskDelta(params.taskId, delta);
      taskEventBus.publish(params.taskId, { kind: 'delta', delta });
    },

    async onTaskCompleted(params) {
      const seq = nextTaskSeq(params.taskId);
      const outputText =
        typeof params.output === 'string'
          ? params.output
          : JSON.stringify(params.output ?? '');
      await firestoreRepository.setTaskTerminal(params.taskId, {
        status: 'completed',
        output: outputText,
        completedAt: new Date().toISOString()
      });
      taskEventBus.publish(params.taskId, {
        kind: 'completed',
        output: outputText,
        seq
      });
      taskEventBus.closeTask(params.taskId);
      taskSeqCounters.delete(params.taskId);
    },

    async onTaskFailed(params) {
      const seq = nextTaskSeq(params.taskId);
      const error = ((): { code: string; message: string } => {
        if (
          params.error &&
          typeof params.error === 'object' &&
          'code' in (params.error as object) &&
          'message' in (params.error as object)
        ) {
          const e = params.error as { code: unknown; message: unknown };
          return {
            code: typeof e.code === 'string' ? e.code : 'agent_error',
            message:
              typeof e.message === 'string'
                ? e.message
                : 'Agent reported a task failure without a message.'
          };
        }
        return {
          code: 'agent_error',
          message:
            typeof params.error === 'string'
              ? params.error
              : 'Agent reported a task failure without a structured error.'
        };
      })();
      await firestoreRepository.setTaskTerminal(params.taskId, {
        status: 'failed',
        error,
        completedAt: new Date().toISOString()
      });
      taskEventBus.publish(params.taskId, {
        kind: 'failed',
        error,
        seq
      });
      taskEventBus.closeTask(params.taskId);
      taskSeqCounters.delete(params.taskId);
    }
  };

  void registerAgentWsRoute(app, {
    agentGuard: authService.createAgentGuard(agentAudience),
    sessionRegistry: agentSessionRegistry,
    taskCallbacks
  });
  void registerTaskRoutes(app, {
    repository: firestoreRepository,
    idempotencyCache: taskIdempotencyCache,
    userGuard: authService.createRequiredGuard(),
    apiBaseUrl: agentAudience,
    dispatchPublisher: taskDispatchPublisher,
    taskEventBus
  });

  // Phase 4.0 Part 3 — agent registration routes. Plugs the
  // FirestoreAgentRepository into the same auth-service path
  // the user routes use for the userGuard, and an
  // agent-token guard backed by the same repository for the
  // agent-only rotate-token route. Audit emit goes through
  // the LoggingAuditWriter stub (TD-057 swaps in BigQuery).
  const agentRepository: AgentRepository =
    options.agentRepository ?? new FirestoreAgentRepository(config, app.log);
  const agentAuditWriter = new LoggingAuditWriter(app.log);
  const agentTokenGuard = createAgentTokenGuard({
    repository: agentRepository,
    audit: agentAuditWriter
  });
  void registerAgentRegistrationRoutes(app, {
    lifecycleRepository: agentRepository,
    audit: agentAuditWriter,
    userGuard: authService.createRequiredGuard(),
    agentTokenGuard: agentTokenGuard.preHandler,
    invalidateAgentTokenCache: agentTokenGuard.invalidateAgent,
    currentAgentVersion: config.API_SERVICE_VERSION
  });
  void registerInternalTasksRoutes(app);

  // Phase 3.2 Pub/Sub + Cloud Tasks PUSH RECEIVER routes. Gated on
  // PUBSUB_PUSH_AUDIENCE because OIDC verification requires an
  // explicit audience; absence skips registration (routes absent ≠
  // routes unauthenticated — stop rule honored).
  if (config.PUBSUB_PUSH_AUDIENCE) {
    const oidcVerifier = new GoogleOidcVerifier({
      audience: config.PUBSUB_PUSH_AUDIENCE,
      allowedEmails: new Set([config.CLOUD_RUN_SERVICE_ACCOUNT])
    });
    const oidcGuard = createGoogleOidcGuard(oidcVerifier);
    void registerInternalPubsubRoutes(app, {
      oidcGuard,
      publisher: taskDispatchPublisher,
      dispatch
    });
  } else {
    app.log.info(
      { source: 'buildServer' },
      'PUBSUB_PUSH_AUDIENCE not set — Phase 3.2 internal pubsub routes not registered'
    );
  }

  return app;
};
