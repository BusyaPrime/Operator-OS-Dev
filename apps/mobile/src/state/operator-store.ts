import type {
  Alert,
  AuthSession,
  CostSnapshot,
  DeviceState,
  OperatorDashboard,
  Session
} from '@operator-os/contracts';
import { create } from 'zustand';

import { apiClient } from '../services/api-client';
import { authSessionClient } from '../services/auth-session';

type ScreenStatus = 'empty' | 'error' | 'idle' | 'loading' | 'ready';

interface CollectionState<T> {
  errorMessage?: string;
  items: T[];
  status: ScreenStatus;
}

const createCollectionState = <T>(
  items: T[],
  errorMessage?: string
): CollectionState<T> => ({
  errorMessage,
  items,
  status:
    errorMessage !== undefined
      ? 'error'
      : items.length === 0
        ? 'empty'
        : 'ready'
});

const initialDashboard = apiClient.buildControlledFallbackDashboard(
  'Expo shell started before the backend dashboard request ran.'
);

interface OperatorStore {
  alerts: Alert[];
  alertsState: CollectionState<Alert>;
  authSession: AuthSession;
  costs: CostSnapshot[];
  costsState: CollectionState<CostSnapshot>;
  dashboard?: OperatorDashboard;
  dashboardTransportMode: ReturnType<
    typeof apiClient.getOperatorDashboard
  > extends Promise<infer Result>
    ? Result extends { transportMode: infer Mode }
      ? Mode
      : never
    : never;
  devices: DeviceState[];
  devicesState: CollectionState<DeviceState>;
  health?: OperatorDashboard['health'];
  selectedDeviceId?: string;
  sessions: Session[];
  sessionsState: CollectionState<Session>;
  lastSyncAt?: string;
  readiness?: OperatorDashboard['readiness'];
  transportMessage?: string;
  useMocks: boolean;
  setSelectedDevice(deviceId: string): void;
  refreshDashboard(): Promise<void>;
}

export const useOperatorStore = create<OperatorStore>((set) => ({
  alerts: initialDashboard.operatorState.alerts,
  alertsState: createCollectionState(initialDashboard.operatorState.alerts),
  authSession: initialDashboard.auth,
  costs: initialDashboard.operatorState.costs,
  costsState: createCollectionState(initialDashboard.operatorState.costs),
  dashboard: initialDashboard,
  dashboardTransportMode: 'local-controlled-fallback',
  devices: initialDashboard.operatorState.devices,
  devicesState: createCollectionState(initialDashboard.operatorState.devices),
  health: initialDashboard.health,
  readiness: initialDashboard.readiness,
  sessions: initialDashboard.operatorState.sessions,
  sessionsState: createCollectionState(initialDashboard.operatorState.sessions),
  transportMessage: initialDashboard.operatorState.fallbackReason,
  useMocks: apiClient.env.EXPO_PUBLIC_USE_MOCKS,
  setSelectedDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  refreshDashboard: async () => {
    set((state) => ({
      alertsState: { ...state.alertsState, status: 'loading' },
      costsState: { ...state.costsState, status: 'loading' },
      devicesState: { ...state.devicesState, status: 'loading' },
      sessionsState: { ...state.sessionsState, status: 'loading' }
    }));

    try {
      const [dashboardResult, authSession] = await Promise.all([
        apiClient.getOperatorDashboard(),
        authSessionClient.getCurrentSession()
      ]);
      const { payload, transportMessage, transportMode } = dashboardResult;

      set({
        alerts: payload.operatorState.alerts,
        alertsState: createCollectionState(payload.operatorState.alerts),
        authSession,
        costs: payload.operatorState.costs,
        costsState: createCollectionState(payload.operatorState.costs),
        dashboard: payload,
        dashboardTransportMode: transportMode,
        devices: payload.operatorState.devices,
        devicesState: createCollectionState(payload.operatorState.devices),
        health: payload.health,
        lastSyncAt: new Date().toISOString(),
        readiness: payload.readiness,
        sessions: payload.operatorState.sessions,
        sessionsState: createCollectionState(payload.operatorState.sessions),
        transportMessage,
        useMocks: transportMode !== 'live-api'
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Dashboard refresh failed unexpectedly.';

      set((state) => ({
        alertsState: createCollectionState(state.alerts, message),
        costsState: createCollectionState(state.costs, message),
        devicesState: createCollectionState(state.devices, message),
        sessionsState: createCollectionState(state.sessions, message),
        transportMessage: message
      }));
    }
  }
}));
