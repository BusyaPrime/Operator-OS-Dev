import type {
  Alert,
  CostSnapshot,
  DeviceState,
  HealthResponse,
  Session
} from '@operator-os/contracts';
import { create } from 'zustand';

import {
  mockAlerts,
  mockCosts,
  mockDevices,
  mockSessions
} from '../mocks/operator-data';
import { apiClient } from '../services/api-client';

interface OperatorStore {
  devices: DeviceState[];
  sessions: Session[];
  alerts: Alert[];
  costs: CostSnapshot[];
  health?: HealthResponse;
  selectedDeviceId?: string;
  lastSyncAt?: string;
  useMocks: boolean;
  setSelectedDevice(deviceId: string): void;
  refreshDashboard(): Promise<void>;
}

export const useOperatorStore = create<OperatorStore>((set) => ({
  devices: mockDevices,
  sessions: mockSessions,
  alerts: mockAlerts,
  costs: mockCosts,
  useMocks: apiClient.env.EXPO_PUBLIC_USE_MOCKS,
  setSelectedDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  refreshDashboard: async () => {
    const [health, devices, sessions, alerts, costs] = await Promise.all([
      apiClient.getHealth(),
      apiClient.listDevices(),
      apiClient.listSessions(),
      apiClient.listAlerts(),
      apiClient.listCosts()
    ]);

    set({
      alerts,
      costs,
      devices,
      health,
      lastSyncAt: new Date().toISOString(),
      sessions
    });
  }
}));
