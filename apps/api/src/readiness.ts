import type { ApiEnv } from '@operator-os/config';
import type { HealthResponse, ServiceCheck } from '@operator-os/contracts';

import type { OperatorModule } from './types.js';

const now = () => new Date().toISOString();

export const buildHealthResponse = (config: ApiEnv): HealthResponse => ({
  status: 'ok',
  service: config.API_SERVICE_NAME,
  version: '0.1.0',
  environment: config.NODE_ENV,
  timestamp: now(),
  checks: [
    {
      name: 'process',
      status: 'ok',
      message: 'Fastify process is running.'
    }
  ]
});

export const buildReadinessResponse = (
  config: ApiEnv,
  modules: readonly OperatorModule[]
): HealthResponse => {
  const checks: ServiceCheck[] = [
    {
      name: 'config',
      status: 'ok',
      message: 'Environment parsing completed successfully.'
    },
    ...modules.map((module) => module.describeReadiness(config))
  ];

  const hasDegraded = checks.some((check) => check.status === 'degraded');
  const hasNotConfigured = checks.some(
    (check) => check.status === 'not_configured'
  );

  const status =
    hasDegraded || (config.READINESS_STRICT && hasNotConfigured)
      ? 'degraded'
      : 'ready';

  return {
    status,
    service: config.API_SERVICE_NAME,
    version: '0.1.0',
    environment: config.NODE_ENV,
    timestamp: now(),
    checks
  };
};
