import { parseMobileEnv } from '@operator-os/config';
import {
  authSessionSchema,
  healthResponseSchema,
  operatorDashboardSchema,
  type HealthResponse,
  type OperatorDashboard
} from '@operator-os/contracts';

import {
  mockAlerts,
  mockCosts,
  mockDevices,
  mockSessions
} from '../mocks/operator-data';

const mobileEnv = parseMobileEnv(process.env);

const fetchJson = async <T>(path: string, parse: (value: unknown) => T) => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    mobileEnv.EXPO_PUBLIC_API_TIMEOUT_MS
  );

  const response = await fetch(`${mobileEnv.EXPO_PUBLIC_API_BASE_URL}${path}`, {
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return parse(await response.json());
};

const buildControlledFallbackDashboard = (reason: string): OperatorDashboard =>
  operatorDashboardSchema.parse({
    operatorState: {
      devices: mockDevices,
      sessions: mockSessions,
      alerts: mockAlerts,
      costs: mockCosts,
      generatedAt: new Date().toISOString(),
      dataSource: 'bootstrap-fallback',
      fallbackReason: reason
    },
    health: {
      status: 'ok',
      service: 'operator-os-api',
      version: '0.1.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
      checks: [
        {
          name: 'mobile-fallback',
          status: 'ok',
          message: 'Expo shell is using a controlled local fallback.'
        }
      ]
    },
    readiness: {
      status: 'degraded',
      service: 'operator-os-api',
      version: '0.1.0',
      environment: 'development',
      timestamp: new Date().toISOString(),
      checks: [
        {
          name: 'api',
          status: 'degraded',
          message: reason
        }
      ]
    },
    auth: authSessionSchema.parse({
      authenticated: false,
      source: 'bootstrap-fallback',
      message:
        'Expo mobile shell is using the bootstrap auth fallback until Firebase-backed auth is wired.'
    })
  });

export type OperatorDashboardTransportMode =
  | 'api-controlled-fallback'
  | 'live-api'
  | 'local-controlled-fallback';

interface OperatorDashboardResult {
  payload: OperatorDashboard;
  transportMessage?: string;
  transportMode: OperatorDashboardTransportMode;
}

export const apiClient = {
  env: mobileEnv,
  buildControlledFallbackDashboard,
  getHealth: async (): Promise<HealthResponse> => {
    if (mobileEnv.EXPO_PUBLIC_USE_MOCKS) {
      return healthResponseSchema.parse({
        status: 'ok',
        service: 'operator-os-api',
        version: '0.1.0',
        environment: 'development',
        timestamp: new Date().toISOString(),
        checks: [{ name: 'mocks', status: 'ok', message: 'Using local mock data.' }]
      });
    }

    return fetchJson('/health', (value) => healthResponseSchema.parse(value));
  },
  getOperatorDashboard: async (): Promise<OperatorDashboardResult> => {
    if (mobileEnv.EXPO_PUBLIC_USE_MOCKS) {
      return {
        payload: buildControlledFallbackDashboard(
          'EXPO_PUBLIC_USE_MOCKS is enabled for this shell.'
        ),
        transportMode: 'local-controlled-fallback',
        transportMessage: 'Local mobile fallback mode is enabled.'
      };
    }

    try {
      const payload = await fetchJson('/v1/operator/dashboard', (value) =>
        operatorDashboardSchema.parse(value)
      );

      return {
        payload,
        transportMode:
          payload.operatorState.dataSource === 'live'
            ? 'live-api'
            : 'api-controlled-fallback',
        transportMessage: payload.operatorState.fallbackReason
      };
    } catch (error) {
      if (!mobileEnv.EXPO_PUBLIC_CONTROLLED_FALLBACK) {
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Operator dashboard request failed unexpectedly.';

      return {
        payload: buildControlledFallbackDashboard(message),
        transportMode: 'local-controlled-fallback',
        transportMessage: message
      };
    }
  },
  getAuthSession: async () => (await apiClient.getOperatorDashboard()).payload.auth,
  listDevices: async () =>
    (await apiClient.getOperatorDashboard()).payload.operatorState.devices,
  listSessions: async () =>
    (await apiClient.getOperatorDashboard()).payload.operatorState.sessions,
  listAlerts: async () =>
    (await apiClient.getOperatorDashboard()).payload.operatorState.alerts,
  listCosts: async () =>
    (await apiClient.getOperatorDashboard()).payload.operatorState.costs
};
