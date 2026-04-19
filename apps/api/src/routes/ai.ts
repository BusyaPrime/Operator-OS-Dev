import type { FastifyInstance } from 'fastify';

import type { AIProvider } from '../types.js';

interface AiRoutesOptions {
  aiProvider: AIProvider;
}

export const registerAiRoutes = async (
  app: FastifyInstance,
  options: AiRoutesOptions
) => {
  app.post('/v1/ai/summarize/operator-state', async (request) =>
    options.aiProvider.summarizeOperatorState(request.body ?? {})
  );

  app.post('/v1/ai/explain/agent-activity', async (request) =>
    options.aiProvider.explainAgentActivity(request.body ?? {})
  );

  app.post('/v1/ai/suggest-cost-optimizations', async (request) =>
    options.aiProvider.suggestCostOptimizations(request.body ?? {})
  );

  app.post('/v1/ai/plan-task-breakdown', async (request) =>
    options.aiProvider.planTaskBreakdown(request.body ?? {})
  );
};
