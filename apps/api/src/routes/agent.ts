import { z } from 'zod';

import {
  alertSchema,
  commandPollResponseSchema,
  deviceStateSchema,
  exportJobSchema,
  mutationReceiptSchema,
  sessionReceiptSchema,
  sessionSchema
} from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';

import type { FirestoreOperatorRepository } from '../integrations/firestore.js';
import type { PubSubPublisher } from '../integrations/pubsub.js';
import type { AlertsService } from '../services/alerts.js';
import type { CommandsService } from '../services/commands.js';
import type { ExportsService } from '../services/exports.js';
import type { SessionsService } from '../services/sessions.js';

interface AgentRoutesOptions {
  alertsService: AlertsService;
  commandsService: CommandsService;
  exportsService: ExportsService;
  pubSubPublisher: PubSubPublisher;
  repository: FirestoreOperatorRepository;
  sessionsService: SessionsService;
}

const commandPollQuerySchema = z.object({
  deviceId: z.string().min(1)
});

export const registerAgentRoutes = async (
  app: FastifyInstance,
  options: AgentRoutesOptions
) => {
  app.post('/v1/agent/heartbeat', async (request) => {
    const deviceState = deviceStateSchema.parse(request.body);
    const receipt = await options.repository.recordDeviceState(deviceState);
    await options.pubSubPublisher.publishAgentEvent(deviceState);

    return mutationReceiptSchema.parse({
      ...receipt,
      operation: 'device-state.heartbeat',
      resourceId: deviceState.deviceId
    });
  });

  app.get('/v1/agent/commands', async (request) => {
    const query = commandPollQuerySchema.parse(request.query);

    return commandPollResponseSchema.parse(
      await options.commandsService.pollCommands(query.deviceId)
    );
  });

  app.post('/v1/agent/sessions', async (request) =>
    sessionReceiptSchema.parse(await options.sessionsService.recordSession(request.body))
  );

  app.post('/v1/agent/exports', async (request) =>
    await options.exportsService.queueExport(exportJobSchema.parse(request.body))
  );

  app.post('/v1/agent/alerts', async (request) =>
    await options.alertsService.emitAlert(alertSchema.parse(request.body))
  );

  app.post('/v1/commands', async (request) =>
    mutationReceiptSchema.parse(
      await options.commandsService.dispatchCommand(request.body)
    )
  );

  app.post('/v1/sessions', async (request) =>
    sessionReceiptSchema.parse(await options.sessionsService.recordSession(sessionSchema.parse(request.body)))
  );
};
