import type { WebSocket as WsWebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

import {
  createAgentSessionRegistry,
  type AgentSession,
  type AgentSessionRegistry
} from '../agent-session-registry.js';
import { createTaskRouter } from '../task-router.js';

const fakeSocket = {
  close: () => undefined,
  terminate: () => undefined
} as unknown as WsWebSocket;

const buildRegistry = (): AgentSessionRegistry => {
  let counter = 0;
  return createAgentSessionRegistry(
    () => `sess-${String(++counter).padStart(3, '0')}`,
    () => '2026-04-24T07:00:00.000Z'
  );
};

const registerAgent = (
  registry: AgentSessionRegistry,
  agentId: string,
  capabilities: readonly string[]
): AgentSession =>
  registry.register({
    agentId,
    userId: 'user-1',
    socket: fakeSocket,
    manifest: {
      capabilities: capabilities.map((c) => ({
        capability: c,
        version: '1.0'
      }))
    }
  });

describe('createTaskRouter — capability matching', () => {
  it('matches an agent whose capabilities are a superset of task requirements', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation', 'tool-use']);
    const router = createTaskRouter({ sessionRegistry: registry });

    const match = router.findMatchingAgent({
      capabilities: ['code-generation']
    });

    expect(match?.agentId).toBe('agent-a');
  });

  it('matches all agents when task.capabilities is empty', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation']);
    registerAgent(registry, 'agent-b', ['planning']);
    const router = createTaskRouter({ sessionRegistry: registry });

    const first = router.findMatchingAgent({ capabilities: [] });
    const second = router.findMatchingAgent({ capabilities: [] });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.agentId).not.toBe(second?.agentId);
  });

  it('returns null when no agent has the required capabilities', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation']);
    const router = createTaskRouter({ sessionRegistry: registry });

    const match = router.findMatchingAgent({
      capabilities: ['voice-output']
    });

    expect(match).toBeNull();
  });

  it('excludes an agent whose manifest fails Zod validation', () => {
    const registry = buildRegistry();
    // Manifest without the required `capabilities` array — should parse-fail
    // and the agent should be excluded from matches.
    registry.register({
      agentId: 'agent-malformed',
      userId: 'user-1',
      socket: fakeSocket,
      manifest: { providerId: 'not-valid-for-router' }
    });
    registerAgent(registry, 'agent-good', ['code-generation']);
    const router = createTaskRouter({ sessionRegistry: registry });

    const match = router.findMatchingAgent({
      capabilities: ['code-generation']
    });

    expect(match?.agentId).toBe('agent-good');
  });

  it('excludes an agent declaring an unknown capability name', () => {
    const registry = buildRegistry();
    registry.register({
      agentId: 'agent-unknown-cap',
      userId: 'user-1',
      socket: fakeSocket,
      manifest: {
        capabilities: [
          { capability: 'not-a-real-capability', version: '1.0' }
        ]
      }
    });
    const router = createTaskRouter({ sessionRegistry: registry });

    const match = router.findMatchingAgent({
      capabilities: ['code-generation']
    });

    expect(match).toBeNull();
  });
});

describe('createTaskRouter — round-robin rotation', () => {
  it('rotates across three matching agents in a single bucket', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation']);
    registerAgent(registry, 'agent-b', ['code-generation']);
    registerAgent(registry, 'agent-c', ['code-generation']);
    const router = createTaskRouter({ sessionRegistry: registry });

    const pick1 = router.findMatchingAgent({ capabilities: ['code-generation'] });
    const pick2 = router.findMatchingAgent({ capabilities: ['code-generation'] });
    const pick3 = router.findMatchingAgent({ capabilities: ['code-generation'] });

    const agents = [pick1?.agentId, pick2?.agentId, pick3?.agentId];
    expect(new Set(agents).size).toBe(3);
  });

  it('wraps the cursor after visiting every candidate', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation']);
    registerAgent(registry, 'agent-b', ['code-generation']);
    const router = createTaskRouter({ sessionRegistry: registry });

    const pick1 = router.findMatchingAgent({ capabilities: ['code-generation'] });
    const pick2 = router.findMatchingAgent({ capabilities: ['code-generation'] });
    const pick3 = router.findMatchingAgent({ capabilities: ['code-generation'] });

    expect(pick3?.agentId).toBe(pick1?.agentId);
    expect(pick2?.agentId).not.toBe(pick1?.agentId);
  });

  it('maintains independent cursors across two capability buckets', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation', 'planning']);
    registerAgent(registry, 'agent-b', ['code-generation', 'planning']);
    const router = createTaskRouter({ sessionRegistry: registry });

    // Bucket 1: code-generation. Advance cursor to index 1 (agent-b).
    router.findMatchingAgent({ capabilities: ['code-generation'] });
    router.findMatchingAgent({ capabilities: ['code-generation'] });

    // Bucket 2: planning. Fresh cursor -> should return agent-a first.
    const planningPick = router.findMatchingAgent({
      capabilities: ['planning']
    });

    expect(planningPick?.agentId).toBe('agent-a');
    expect(router.cursors.get('code-generation')).toBe(1);
    expect(router.cursors.get('planning')).toBe(0);
  });

  it('produces the same bucket key for same required set in different order / duplicates', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation', 'planning']);
    registerAgent(registry, 'agent-b', ['code-generation', 'planning']);
    const router = createTaskRouter({ sessionRegistry: registry });

    // Alternating representations of the same set should share the same
    // cursor: {code-generation, planning}, {planning, code-generation},
    // {code-generation, code-generation, planning} all bucket to
    // 'code-generation|planning'.
    const a = router.findMatchingAgent({
      capabilities: ['code-generation', 'planning']
    });
    const b = router.findMatchingAgent({
      capabilities: ['planning', 'code-generation']
    });
    const c = router.findMatchingAgent({
      capabilities: ['code-generation', 'code-generation', 'planning']
    });

    expect(a?.agentId).toBe('agent-a');
    expect(b?.agentId).toBe('agent-b');
    expect(c?.agentId).toBe('agent-a'); // wrap after 2-agent bucket
    expect(router.cursors.size).toBe(1);
    expect([...router.cursors.keys()][0]).toBe('code-generation|planning');
  });

  it('survives agent churn — removing an agent mid-rotation does not crash', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation']);
    const b = registerAgent(registry, 'agent-b', ['code-generation']);
    registerAgent(registry, 'agent-c', ['code-generation']);
    const router = createTaskRouter({ sessionRegistry: registry });

    router.findMatchingAgent({ capabilities: ['code-generation'] }); // agent-a
    router.findMatchingAgent({ capabilities: ['code-generation'] }); // agent-b

    // Remove agent-b mid-rotation, then continue. Candidate list shrinks
    // to [agent-a, agent-c]; cursor wrap adapts without throwing.
    registry.removeBySessionId(b.sessionId);

    const nextPick = router.findMatchingAgent({
      capabilities: ['code-generation']
    });
    expect(nextPick?.agentId === 'agent-a' || nextPick?.agentId === 'agent-c').toBe(
      true
    );
  });

  it('returns the same agent twice in a row for a single-candidate bucket', () => {
    const registry = buildRegistry();
    registerAgent(registry, 'agent-a', ['code-generation']);
    const router = createTaskRouter({ sessionRegistry: registry });

    const first = router.findMatchingAgent({ capabilities: ['code-generation'] });
    const second = router.findMatchingAgent({ capabilities: ['code-generation'] });

    expect(first?.agentId).toBe('agent-a');
    expect(second?.agentId).toBe('agent-a');
  });
});
