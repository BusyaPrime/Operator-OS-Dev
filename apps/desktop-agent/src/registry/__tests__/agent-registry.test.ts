import type { AIAgent, AIAgentIdentity } from '@operator-os/contracts';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRegistry, type AgentRegistryEvent } from '../agent-registry.js';

const silentLogger = pino({ level: 'silent' });

const makeIdentity = (id: string, providerId: string): AIAgentIdentity => ({
  id,
  providerId,
  providerVersion: '0.0.0-test',
  displayName: `${providerId} test`,
  hostname: 'test-host',
  platform: 'linux',
  arch: 'x64'
});

const makeAgent = (id: string, providerId: string): AIAgent => {
  return {
    identity: makeIdentity(id, providerId),
    runtime: { pid: 1, startedAt: new Date().toISOString(), uptimeSeconds: 0 },
    manifest: {
      manifestVersion: '1',
      providerId,
      providerVersion: '0.0.0-test',
      displayName: providerId,
      description: 'test',
      author: 'test',
      license: 'MIT',
      capabilities: [],
      requirements: {}
    },
    fs: {} as AIAgent['fs'],
    stream: {} as AIAgent['stream'],
    cost: {} as AIAgent['cost'],
    getStatus: async () => ({
      state: 'idle' as const,
      lastHeartbeatAt: new Date().toISOString(),
      healthChecks: {}
    }),
    listCapabilities: () => [],
    start: async () => undefined,
    stop: async () => undefined,
    executeTask: async () => ({
      taskId: 'stub',
      status: 'pending' as const,
      startedAt: new Date().toISOString()
    }),
    cancelTask: async () => undefined
  };
};

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry(silentLogger);
  });

  describe('register + get + list + size', () => {
    it('register adds an agent and list reflects it', () => {
      const agent = makeAgent('agent-1', 'claude-code');
      registry.register(agent);
      expect(registry.size()).toBe(1);
      expect(registry.get('agent-1')).toBe(agent);
      expect(registry.list()).toEqual([agent]);
    });

    it('list returns multiple agents in registration order', () => {
      const a = makeAgent('a', 'claude-code');
      const b = makeAgent('b', 'codex');
      registry.register(a);
      registry.register(b);
      expect(registry.list().map((x) => x.identity.id)).toEqual(['a', 'b']);
    });

    it('register throws on duplicate id', () => {
      const a = makeAgent('dup', 'claude-code');
      const b = makeAgent('dup', 'codex'); // same id, different provider
      registry.register(a);
      expect(() => registry.register(b)).toThrow(/already registered/);
    });

    it('get returns undefined for unknown id', () => {
      expect(registry.get('ghost')).toBeUndefined();
    });
  });

  describe('unregister', () => {
    it('unregister removes the agent and future get/list exclude it', () => {
      const a = makeAgent('a', 'claude-code');
      registry.register(a);
      registry.unregister('a');
      expect(registry.get('a')).toBeUndefined();
      expect(registry.list()).toEqual([]);
      expect(registry.size()).toBe(0);
    });

    it('unregister of unknown id is a silent no-op', () => {
      expect(() => registry.unregister('ghost')).not.toThrow();
    });
  });

  describe('event emission', () => {
    it('emits agent:registered on register', () => {
      const events: AgentRegistryEvent[] = [];
      registry.subscribe((e) => events.push(e));
      registry.register(makeAgent('a', 'claude-code'));
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'agent:registered',
        agentId: 'a',
        providerId: 'claude-code'
      });
    });

    it('emits agent:unregistered on unregister with reason', () => {
      const events: AgentRegistryEvent[] = [];
      registry.register(makeAgent('a', 'claude-code'));
      registry.subscribe((e) => events.push(e));
      registry.unregister('a', 'shutdown');
      expect(events).toEqual([
        { type: 'agent:unregistered', agentId: 'a', reason: 'shutdown' }
      ]);
    });

    it('emits agent:state-changed via notifyStateChanged', () => {
      const events: AgentRegistryEvent[] = [];
      registry.register(makeAgent('a', 'claude-code'));
      registry.subscribe((e) => events.push(e));
      registry.notifyStateChanged('a', 'busy');
      expect(events).toEqual([
        { type: 'agent:state-changed', agentId: 'a', state: 'busy' }
      ]);
    });

    it('notifyStateChanged silent when agent not registered', () => {
      const events: AgentRegistryEvent[] = [];
      registry.subscribe((e) => events.push(e));
      registry.notifyStateChanged('ghost', 'offline');
      expect(events).toEqual([]);
    });

    it('subscribe().unsubscribe() stops future events', () => {
      const events: AgentRegistryEvent[] = [];
      const sub = registry.subscribe((e) => events.push(e));
      registry.register(makeAgent('a', 'claude-code'));
      sub.unsubscribe();
      registry.register(makeAgent('b', 'codex'));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent:registered');
    });

    it('listener exceptions are caught and do not break other subscribers', () => {
      const good = vi.fn();
      const bad = vi.fn(() => {
        throw new Error('listener exploded');
      });
      registry.subscribe(bad);
      registry.subscribe(good);
      registry.register(makeAgent('a', 'claude-code'));
      expect(bad).toHaveBeenCalledOnce();
      expect(good).toHaveBeenCalledOnce();
    });
  });
});
