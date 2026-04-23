import { z } from 'zod';

import {
  agentHeartbeatRequestSchema,
  agentHeartbeatResponseSchema,
  alertSchema,
  commandPollResponseSchema,
  deviceStateSchema,
  exportJobSchema,
  mutationReceiptSchema,
  sessionReceiptSchema,
  sessionSchema
} from '@operator-os/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { PubSubPublisher } from '../integrations/pubsub.js';
import type { AlertsService } from '../services/alerts.js';
import type { CommandsService } from '../services/commands.js';
import type { ExportsService } from '../services/exports.js';
import type { SessionsService } from '../services/sessions.js';

interface AgentRoutesOptions {
  alertsService: AlertsService;
  authGuard: preHandlerAsyncHookHandler;
  commandsService: CommandsService;
  exportsService: ExportsService;
  pubSubPublisher: PubSubPublisher;
  repository: FirestoreOperatorRepository;
  sessionsService: SessionsService;
  /** Injectable for tests; default singleton uses Date.now. */
  heartbeatRateLimiter?: AgentHeartbeatRateLimiter;
}

const commandPollQuerySchema = z.object({
  deviceId: z.string().min(1)
});

/**
 * Minimum ms between two accepted heartbeats from the same
 * agentId. In-memory (Phase 2 single-instance MVP); flagged in
 * the "Agent WebSocket Sessions In-Memory" ADR for migration to
 * a shared store when multi-instance Cloud Run lands.
 */
const AGENT_HEARTBEAT_MIN_INTERVAL_MS = 5_000;

/**
 * Factory so tests can inject a per-test instance and an
 * explicit clock. Default uses Date.now directly.
 */
export interface AgentHeartbeatRateLimiter {
  tryAccept(agentId: string): boolean;
}

export const createAgentHeartbeatRateLimiter = (
  now: () => number = () => Date.now(),
  minIntervalMs: number = AGENT_HEARTBEAT_MIN_INTERVAL_MS
): AgentHeartbeatRateLimiter => {
  const last = new Map<string, number>();
  return {
    tryAccept(agentId: string): boolean {
      const current = now();
      const prev = last.get(agentId);
      if (prev !== undefined && current - prev < minIntervalMs) {
        return false;
      }
      last.set(agentId, current);
      return true;
    }
  };
};

const defaultHeartbeatRateLimiter = createAgentHeartbeatRateLimiter();

export const registerAgentRoutes = async (
  app: FastifyInstance,
  options: AgentRoutesOptions
) => {
  const routeOptions = { preHandler: options.authGuard } as const;
  const rateLimiter =
    options.heartbeatRateLimiter ?? defaultHeartbeatRateLimiter;

  app.post('/v1/agent/heartbeat', routeOptions, async (request) => {
    const deviceState = deviceStateSchema.parse(request.body);
    const receipt = await options.repository.recordDeviceState(deviceState);
    await options.pubSubPublisher.publishAgentEvent(deviceState);

    return mutationReceiptSchema.parse({
      ...receipt,
      operation: 'device-state.heartbeat',
      resourceId: deviceState.deviceId
    });
  });

  // Phase 2 / TD-024: additive agent-centric heartbeat. The
  // existing /v1/agent/heartbeat keeps accepting deviceStateSchema
  // unchanged; this new endpoint accepts the agent-centric shape
  // and is what `AgentHeartbeatLoop` in desktop-agent posts to.
  // The two coexist until every client migrates — see the
  // "Agent Heartbeat Schema Is Additive, Not Replacement" ADR.
  app.post('/v1/agent/heartbeat/agent', routeOptions, async (request, reply) => {
    const heartbeat = agentHeartbeatRequestSchema.parse(request.body);

    if (!rateLimiter.tryAccept(heartbeat.agentId)) {
      reply.status(429);
      return {
        error: 'Too Many Requests',
        message:
          `Agent ${heartbeat.agentId} must wait at least ` +
          `${AGENT_HEARTBEAT_MIN_INTERVAL_MS}ms between heartbeats.`
      };
    }

    // `operatorId` comes from the JWT via the agent guard; it's
    // the identity Cost / budget reads will key on. Defensive
    // fallback: if for any reason the guard left it unset, use
    // 'unknown-agent' — persistence still works, and a later
    // audit flags the row.
    const userId = request.authSession?.currentUser?.operatorId ?? 'unknown-agent';

    await options.repository.recordAgentHeartbeat(heartbeat, userId);

    // Phase 2 scope: `pendingTaskIds` + `commands` are both
    // empty. Real task dispatch is Week 4; command dispatch
    // (pause/resume/shutdown/update-config) is router-integration
    // work not covered here.
    return agentHeartbeatResponseSchema.parse({
      status: 'ok',
      serverTime: new Date().toISOString(),
      pendingTaskIds: [],
      commands: []
    });
  });

  app.get('/v1/agent/commands', routeOptions, async (request) => {
    const query = commandPollQuerySchema.parse(request.query);

    return commandPollResponseSchema.parse(
      await options.commandsService.pollCommands(query.deviceId)
    );
  });

  app.post('/v1/agent/sessions', routeOptions, async (request) =>
    sessionReceiptSchema.parse(await options.sessionsService.recordSession(request.body))
  );

  app.post('/v1/agent/exports', routeOptions, async (request) =>
    await options.exportsService.queueExport(exportJobSchema.parse(request.body))
  );

  app.post('/v1/agent/alerts', routeOptions, async (request) =>
    await options.alertsService.emitAlert(alertSchema.parse(request.body))
  );

  app.post('/v1/commands', routeOptions, async (request) =>
    mutationReceiptSchema.parse(
      await options.commandsService.dispatchCommand(request.body)
    )
  );

  app.post('/v1/sessions', routeOptions, async (request) =>
    sessionReceiptSchema.parse(await options.sessionsService.recordSession(sessionSchema.parse(request.body)))
  );
};
