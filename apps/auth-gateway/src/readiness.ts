import type { AuthGatewayEnv } from '@operator-os/config';
import type { HealthResponse, ServiceCheck } from '@operator-os/contracts';

const now = () => new Date().toISOString();

export const buildHealthResponse = (config: AuthGatewayEnv): HealthResponse => ({
  status: 'ok',
  service: config.AUTH_GATEWAY_SERVICE_NAME,
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
  config: AuthGatewayEnv,
  checks: readonly ServiceCheck[]
): HealthResponse => {
  const configCheck: ServiceCheck = {
    name: 'config',
    status: 'ok',
    message: 'Environment parsing completed successfully.'
  };

  const allChecks = [configCheck, ...checks];

  const hasDegraded = allChecks.some((check) => check.status === 'degraded');
  const hasNotConfigured = allChecks.some(
    (check) => check.status === 'not_configured'
  );

  const status =
    hasDegraded || (config.READINESS_STRICT && hasNotConfigured)
      ? 'degraded'
      : 'ready';

  return {
    status,
    service: config.AUTH_GATEWAY_SERVICE_NAME,
    version: '0.1.0',
    environment: config.NODE_ENV,
    timestamp: now(),
    checks: allChecks
  };
};
