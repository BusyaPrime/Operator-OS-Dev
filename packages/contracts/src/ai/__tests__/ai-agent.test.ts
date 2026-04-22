import { describe, expectTypeOf, it } from 'vitest';

import type {
  AIAgent,
  AIAgentHealthCheckStatus,
  AIAgentIdentity,
  AIAgentRuntime,
  AIAgentState,
  AIAgentStatus,
  AIAgentTaskConstraints,
  AIAgentTaskContext,
  AIAgentTaskError,
  AIAgentTaskHandle,
  AIAgentTaskInput,
  AIAgentTaskOutput,
  AIAgentTaskStatus,
  AIAgentTaskType,
  AIAgentToolCall,
  AIAgentUsage
} from '../ai-agent.js';
import type { AgentCapability } from '../capabilities.js';
import type { AgentManifest } from '../agent-manifest.js';
import type { CostProvider } from '../cost-provider.js';
import type { FileSystemProvider } from '../filesystem-provider.js';
import type { StreamProvider } from '../stream-provider.js';

describe('AIAgentIdentity type', () => {
  it('exposes readonly stable id as string', () => {
    expectTypeOf<AIAgentIdentity['id']>().toEqualTypeOf<string>();
  });

  it('platform is a narrow union (not string)', () => {
    expectTypeOf<AIAgentIdentity['platform']>().toEqualTypeOf<
      'win32' | 'darwin' | 'linux'
    >();
  });

  it('carries provider id + version + display name + hostname + arch', () => {
    expectTypeOf<AIAgentIdentity>().toHaveProperty('providerId').toEqualTypeOf<string>();
    expectTypeOf<AIAgentIdentity>().toHaveProperty('providerVersion').toEqualTypeOf<string>();
    expectTypeOf<AIAgentIdentity>().toHaveProperty('displayName').toEqualTypeOf<string>();
    expectTypeOf<AIAgentIdentity>().toHaveProperty('hostname').toEqualTypeOf<string>();
    expectTypeOf<AIAgentIdentity>().toHaveProperty('arch').toEqualTypeOf<string>();
  });
});

describe('AIAgentRuntime type', () => {
  it('exposes pid, startedAt, uptimeSeconds', () => {
    expectTypeOf<AIAgentRuntime['pid']>().toEqualTypeOf<number>();
    expectTypeOf<AIAgentRuntime['startedAt']>().toEqualTypeOf<string>();
    expectTypeOf<AIAgentRuntime['uptimeSeconds']>().toEqualTypeOf<number>();
  });
});

describe('AIAgentStatus type', () => {
  it('state is a narrow AIAgentState union', () => {
    expectTypeOf<AIAgentState>().toEqualTypeOf<
      'idle' | 'busy' | 'degraded' | 'offline'
    >();
    expectTypeOf<AIAgentStatus['state']>().toEqualTypeOf<AIAgentState>();
  });

  it('healthChecks is a Record keyed by string', () => {
    expectTypeOf<AIAgentStatus['healthChecks']>().toEqualTypeOf<
      Record<string, AIAgentHealthCheckStatus>
    >();
  });

  it('currentTaskId is optional', () => {
    expectTypeOf<AIAgentStatus>()
      .toHaveProperty('currentTaskId')
      .toEqualTypeOf<string | undefined>();
  });
});

describe('AIAgent task types', () => {
  it('task type and status are narrow unions', () => {
    expectTypeOf<AIAgentTaskType>().toEqualTypeOf<
      'plan' | 'code' | 'review' | 'answer' | 'tool-use'
    >();
    expectTypeOf<AIAgentTaskStatus>().toEqualTypeOf<
      'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    >();
  });

  it('task input carries taskId, type, prompt', () => {
    expectTypeOf<AIAgentTaskInput['taskId']>().toEqualTypeOf<string>();
    expectTypeOf<AIAgentTaskInput['type']>().toEqualTypeOf<AIAgentTaskType>();
    expectTypeOf<AIAgentTaskInput['prompt']>().toEqualTypeOf<string>();
  });

  it('task context files are readonly string array, optional', () => {
    expectTypeOf<AIAgentTaskContext['files']>().toEqualTypeOf<
      readonly string[] | undefined
    >();
  });

  it('task constraints expose cost / duration / tokens / tools', () => {
    expectTypeOf<AIAgentTaskConstraints>()
      .toHaveProperty('maxCostUsd')
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<AIAgentTaskConstraints>()
      .toHaveProperty('maxDurationSeconds')
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<AIAgentTaskConstraints>()
      .toHaveProperty('maxTokens')
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<AIAgentTaskConstraints>()
      .toHaveProperty('allowedTools')
      .toEqualTypeOf<readonly string[] | undefined>();
  });

  it('task output carries text, usage, optional artefacts + tool calls', () => {
    expectTypeOf<AIAgentTaskOutput['text']>().toEqualTypeOf<string>();
    expectTypeOf<AIAgentTaskOutput['usage']>().toEqualTypeOf<AIAgentUsage>();
    expectTypeOf<AIAgentTaskOutput['artifacts']>().toEqualTypeOf<
      readonly string[] | undefined
    >();
    expectTypeOf<AIAgentTaskOutput['toolCalls']>().toEqualTypeOf<
      readonly AIAgentToolCall[] | undefined
    >();
  });

  it('task error requires code + message + retriable', () => {
    expectTypeOf<AIAgentTaskError['code']>().toEqualTypeOf<string>();
    expectTypeOf<AIAgentTaskError['message']>().toEqualTypeOf<string>();
    expectTypeOf<AIAgentTaskError['retriable']>().toEqualTypeOf<boolean>();
  });

  it('task handle carries status transitions and optional output/error', () => {
    expectTypeOf<AIAgentTaskHandle['taskId']>().toEqualTypeOf<string>();
    expectTypeOf<AIAgentTaskHandle['status']>().toEqualTypeOf<AIAgentTaskStatus>();
    expectTypeOf<AIAgentTaskHandle['startedAt']>().toEqualTypeOf<string>();
    expectTypeOf<AIAgentTaskHandle>()
      .toHaveProperty('output')
      .toEqualTypeOf<AIAgentTaskOutput | undefined>();
    expectTypeOf<AIAgentTaskHandle>()
      .toHaveProperty('error')
      .toEqualTypeOf<AIAgentTaskError | undefined>();
  });

  it('usage carries prompt/completion/total tokens + USD', () => {
    expectTypeOf<AIAgentUsage['promptTokens']>().toEqualTypeOf<number>();
    expectTypeOf<AIAgentUsage['completionTokens']>().toEqualTypeOf<number>();
    expectTypeOf<AIAgentUsage['totalTokens']>().toEqualTypeOf<number>();
    expectTypeOf<AIAgentUsage['costUsd']>().toEqualTypeOf<number>();
  });
});

describe('AIAgent interface', () => {
  it('bundles identity + runtime + manifest', () => {
    expectTypeOf<AIAgent['identity']>().toEqualTypeOf<AIAgentIdentity>();
    expectTypeOf<AIAgent['runtime']>().toEqualTypeOf<AIAgentRuntime>();
    expectTypeOf<AIAgent['manifest']>().toEqualTypeOf<AgentManifest>();
  });

  it('owns fs / stream / cost providers as readonly fields', () => {
    expectTypeOf<AIAgent['fs']>().toEqualTypeOf<FileSystemProvider>();
    expectTypeOf<AIAgent['stream']>().toEqualTypeOf<StreamProvider>();
    expectTypeOf<AIAgent['cost']>().toEqualTypeOf<CostProvider>();
  });

  it('listCapabilities returns readonly AgentCapability array', () => {
    type Caps = ReturnType<AIAgent['listCapabilities']>;
    expectTypeOf<Caps>().toEqualTypeOf<readonly AgentCapability[]>();
  });

  it('getStatus is async, returns AIAgentStatus', () => {
    type Ret = ReturnType<AIAgent['getStatus']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<AIAgentStatus>>();
  });

  it('start returns Promise<void>, stop takes reason union', () => {
    type StartRet = ReturnType<AIAgent['start']>;
    expectTypeOf<StartRet>().toEqualTypeOf<Promise<void>>();
    type StopArg = Parameters<AIAgent['stop']>[0];
    expectTypeOf<StopArg>().toEqualTypeOf<'user' | 'shutdown' | 'error'>();
  });

  it('executeTask takes AIAgentTaskInput, returns task handle', () => {
    type InputArg = Parameters<AIAgent['executeTask']>[0];
    expectTypeOf<InputArg>().toEqualTypeOf<AIAgentTaskInput>();
    type Ret = ReturnType<AIAgent['executeTask']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<AIAgentTaskHandle>>();
  });

  it('cancelTask takes taskId string, returns Promise<void>', () => {
    type Arg = Parameters<AIAgent['cancelTask']>[0];
    expectTypeOf<Arg>().toEqualTypeOf<string>();
    type Ret = ReturnType<AIAgent['cancelTask']>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<void>>();
  });
});
