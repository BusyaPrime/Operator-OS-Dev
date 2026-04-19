import { parseMobileEnv } from '@operator-os/config';
import { healthResponseSchema, type HealthResponse } from '@operator-os/contracts';

import {
  mockAlerts,
  mockCosts,
  mockDevices,
  mockSessions
} from '../mocks/operator-data';

const mobileEnv = parseMobileEnv(process.env);

const fetchJson = async <T>(path: string, parse: (value: unknown) => T) => {
  const response = await fetch(`${mobileEnv.EXPO_PUBLIC_API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return parse(await response.json());
};

export const apiClient = {
  env: mobileEnv,
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
  listDevices: async () => mockDevices,
  listSessions: async () => mockSessions,
  listAlerts: async () => mockAlerts,
  listCosts: async () => mockCosts
};
