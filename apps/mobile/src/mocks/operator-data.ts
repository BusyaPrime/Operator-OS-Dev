import type {
  Alert,
  CostSnapshot,
  DeviceState,
  Session
} from '@operator-os/contracts';

export const mockDevices: DeviceState[] = [
  {
    deviceId: 'desktop-1',
    displayName: 'Main Studio PC',
    platform: 'windows',
    runtimeStatus: 'ready',
    agentVersion: '0.1.0',
    lastHeartbeatAt: '2026-04-19T08:40:00.000Z',
    capabilities: ['heartbeat', 'commands', 'exports', 'trusted-session'],
    metadata: { region: 'local', queue: 'commands' }
  },
  {
    deviceId: 'desktop-2',
    displayName: 'Render Backup',
    platform: 'windows',
    runtimeStatus: 'busy',
    agentVersion: '0.1.0',
    lastHeartbeatAt: '2026-04-19T08:39:10.000Z',
    capabilities: ['heartbeat', 'commands', 'exports'],
    metadata: { region: 'remote', queue: 'exports' }
  }
];

export const mockSessions: Session[] = [
  {
    id: 'session-1',
    deviceId: 'desktop-1',
    operatorId: 'owner',
    status: 'active',
    mode: 'trusted',
    visibility: 'visible',
    createdAt: '2026-04-19T08:00:00.000Z',
    startedAt: '2026-04-19T08:05:00.000Z'
  },
  {
    id: 'session-2',
    deviceId: 'desktop-2',
    operatorId: 'owner',
    status: 'pending',
    mode: 'observe-only',
    visibility: 'visible',
    createdAt: '2026-04-19T08:20:00.000Z'
  }
];

export const mockAlerts: Alert[] = [
  {
    id: 'alert-1',
    source: 'budget-events',
    severity: 'warning',
    status: 'open',
    title: 'Budget threshold nearing',
    message: 'Bootstrap budget reached 72% of planned threshold.',
    createdAt: '2026-04-19T07:58:00.000Z',
    metadata: { budget: 'bootstrap-dev' }
  },
  {
    id: 'alert-2',
    source: 'session-events',
    severity: 'info',
    status: 'acknowledged',
    title: 'Trusted session requested',
    message: 'A visible session request is waiting on desktop-2.',
    createdAt: '2026-04-19T08:21:00.000Z',
    metadata: {}
  }
];

export const mockCosts: CostSnapshot[] = [
  {
    id: 'cost-1',
    scope: 'project',
    scopeId: 'operator-os-dev',
    totalUsd: 14.82,
    currency: 'USD',
    windowStart: '2026-04-01T00:00:00.000Z',
    windowEnd: '2026-04-19T00:00:00.000Z',
    budgetName: 'bootstrap-dev',
    alertsOpen: 1
  }
];
