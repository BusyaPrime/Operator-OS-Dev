import {
  approvalQueuePayloadSchema,
  commandQueuePayloadSchema,
  exportQueuePayloadSchema
} from '@operator-os/contracts';
import type { FastifyInstance } from 'fastify';

export const registerInternalTasksRoutes = async (app: FastifyInstance) => {
  app.post('/internal/tasks/commands', async (request, reply) => {
    const payload = commandQueuePayloadSchema.parse(request.body);

    request.log.info(
      {
        queue: payload.queue,
        requestedAt: payload.requestedAt,
        commandId: payload.command.id,
        commandType: payload.command.type,
        deviceId: payload.command.deviceId
      },
      'task_received'
    );

    return reply.code(204).send();
  });

  app.post('/internal/tasks/approvals', async (request, reply) => {
    const payload = approvalQueuePayloadSchema.parse(request.body);

    request.log.info(
      {
        queue: payload.queue,
        requestedAt: payload.requestedAt,
        commandId: payload.commandId,
        operatorId: payload.operatorId
      },
      'task_received'
    );

    return reply.code(204).send();
  });

  app.post('/internal/tasks/exports', async (request, reply) => {
    const payload = exportQueuePayloadSchema.parse(request.body);

    request.log.info(
      {
        queue: payload.queue,
        requestedAt: payload.requestedAt,
        exportJobId: payload.exportJob.id,
        exportType: payload.exportJob.type
      },
      'task_received'
    );

    return reply.code(204).send();
  });
};
