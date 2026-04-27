import { describe, expect, it } from 'vitest';

import type { AgentRecord } from '@operator-os/contracts';

import { projectAgentSummary } from '../firestore-agent-repository.js';

const FIXTURE_NOW = new Date('2026-04-28T12:00:00Z').getTime();
const FIXTURE_AGENT_ID = 'c5d8b6f0-9ec5-4c7f-8d1a-3a2b1c4d5e6f';

const baseRecord = (overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  agentId: FIXTURE_AGENT_ID,
  userId: 'user-akmal',
  machineName: 'studio-pc',
  capabilities: ['code-generation', 'file-read'],
  tokenHash: '$2b$12$abcdef...',
  tokenLookupHash: 'a'.repeat(16),
  tokenIssuedAt: '2026-04-20T00:00:00.000Z',
  tokenLastRotatedAt: null,
  tokenUseCount: 0,
  previousTokenHash: null,
  previousTokenLookupHash: null,
  previousTokenExpiresAt: null,
  oldTokenUsageCount: 0,
  online: false,
  lastConnectAt: null,
  lastDisconnectAt: null,
  lastHeartbeatAt: null,
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
  revoked: false,
  revokedAt: null,
  revokedReason: null,
  ...overrides
});

describe('projectAgentSummary', () => {
  it('strips the bcrypt + lookup hashes', () => {
    const summary = projectAgentSummary(baseRecord(), FIXTURE_NOW);
    // TS prevents the explicit access at compile time. Runtime
    // assertion uses an `as Record<string, unknown>` cast so a
    // future contributor who breaks the projection sees a
    // failing test.
    const projected = summary as unknown as Record<string, unknown>;
    expect(projected.tokenHash).toBeUndefined();
    expect(projected.tokenLookupHash).toBeUndefined();
    expect(projected.previousTokenHash).toBeUndefined();
    expect(projected.previousTokenLookupHash).toBeUndefined();
    expect(projected.userId).toBeUndefined();
    expect(projected.revoked).toBeUndefined();
  });

  it('reports online when heartbeat is fresh AND online flag set', () => {
    const summary = projectAgentSummary(
      baseRecord({
        online: true,
        lastHeartbeatAt: new Date(FIXTURE_NOW - 30_000).toISOString()
      }),
      FIXTURE_NOW
    );
    expect(summary.onlineState).toBe('online');
  });

  it('reports offline when online=true but heartbeat is stale (>90s)', () => {
    const summary = projectAgentSummary(
      baseRecord({
        online: true,
        lastHeartbeatAt: new Date(FIXTURE_NOW - 91_000).toISOString()
      }),
      FIXTURE_NOW
    );
    expect(summary.onlineState).toBe('offline');
  });

  it('reports offline when online=false even if heartbeat was recent', () => {
    const summary = projectAgentSummary(
      baseRecord({
        online: false,
        lastHeartbeatAt: new Date(FIXTURE_NOW - 5_000).toISOString()
      }),
      FIXTURE_NOW
    );
    expect(summary.onlineState).toBe('offline');
  });

  it('reports offline when lastHeartbeatAt is null (never connected)', () => {
    const summary = projectAgentSummary(
      baseRecord({ online: true, lastHeartbeatAt: null }),
      FIXTURE_NOW
    );
    expect(summary.onlineState).toBe('offline');
  });

  it('forwards capabilities, machineName, agentId, oldTokenUsageCount', () => {
    const summary = projectAgentSummary(
      baseRecord({
        machineName: 'render-pc',
        capabilities: ['code-generation', 'shell-execution'],
        oldTokenUsageCount: 7
      }),
      FIXTURE_NOW
    );
    expect(summary.machineName).toBe('render-pc');
    expect(summary.capabilities).toEqual(['code-generation', 'shell-execution']);
    expect(summary.agentId).toBe(FIXTURE_AGENT_ID);
    expect(summary.oldTokenUsageCount).toBe(7);
  });

  it('boundary: heartbeat exactly 90s ago is offline (strict >, not >=)', () => {
    const summary = projectAgentSummary(
      baseRecord({
        online: true,
        lastHeartbeatAt: new Date(FIXTURE_NOW - 90_000).toISOString()
      }),
      FIXTURE_NOW
    );
    expect(summary.onlineState).toBe('offline');
  });
});
