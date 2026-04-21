import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';

import type { AIProvider } from '../types.js';

interface AiRoutesOptions {
  aiProvider: AIProvider;
  authGuard: preHandlerAsyncHookHandler;
}

export const registerAiRoutes = async (
  app: FastifyInstance,
  options: AiRoutesOptions
) => {
  const routeOptions = { preHandler: options.authGuard } as const;

  app.post('/v1/ai/summarize/operator-state', routeOptions, async (request) =>
    options.aiProvider.summarizeOperatorState(request.body ?? {})
  );

  app.post('/v1/ai/explain/agent-activity', routeOptions, async (request) =>
    options.aiProvider.explainAgentActivity(request.body ?? {})
  );

  app.post('/v1/ai/suggest-cost-optimizations', routeOptions, async (request) =>
    options.aiProvider.suggestCostOptimizations(request.body ?? {})
  );

  app.post('/v1/ai/plan-task-breakdown', routeOptions, async (request) =>
    options.aiProvider.planTaskBreakdown(request.body ?? {})
  );
};
