import type { AgentCapability } from './capabilities.js';
import type { AgentManifest } from './agent-manifest.js';
import type { CostProvider } from './cost-provider.js';
import type { FileSystemProvider } from './filesystem-provider.js';
import type { StreamProvider } from './stream-provider.js';

/**
 * Stable identity of a concrete AI agent. Survives process
 * restarts and is the primary key for registry operations.
 */
export interface AIAgentIdentity {
  /** UUID assigned once at first boot, persisted to disk. */
  readonly id: string;
  /** Registry id for the provider implementation, e.g. 'claude-code'. */
  readonly providerId: string;
  /** Semver of the provider binary or SDK at boot. */
  readonly providerVersion: string;
  /** Human-readable label, e.g. 'Claude Code 2.1'. */
  readonly displayName: string;
  /** Hostname of the machine running the agent. */
  readonly hostname: string;
  /** Operating system family. */
  readonly platform: 'win32' | 'darwin' | 'linux';
  /** CPU architecture, e.g. 'x64', 'arm64'. */
  readonly arch: string;
}

/** Process-level state of an AI agent instance. */
export interface AIAgentRuntime {
  /** OS process id of the agent host process. */
  readonly pid: number;
  /** ISO8601 timestamp when the agent process started. */
  readonly startedAt: string;
  /** Seconds since the agent process started. */
  readonly uptimeSeconds: number;
}

/** Lifecycle state of an agent. */
export type AIAgentState =
  | 'idle'
  | 'busy'
  | 'degraded'
  | 'offline';

/** Per-check health probe report. */
export type AIAgentHealthCheckStatus = 'ok' | 'warn' | 'fail';

/** Current snapshot of an agent's operational state. */
export interface AIAgentStatus {
  readonly state: AIAgentState;
  /** Task id currently executing, if any. */
  readonly currentTaskId?: string;
  /** ISO8601 timestamp of the last successful heartbeat. */
  readonly lastHeartbeatAt: string;
  /** Named health checks with their current status. */
  readonly healthChecks: Record<string, AIAgentHealthCheckStatus>;
}

/** Classification of a task the agent is asked to execute. */
export type AIAgentTaskType =
  | 'plan'
  | 'code'
  | 'review'
  | 'answer'
  | 'tool-use';

/** Status transitions a task handle can be in. */
export type AIAgentTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Optional context fed into an agent task. */
export interface AIAgentTaskContext {
  /** Absolute paths, must be within FileSystemProvider scope. */
  readonly files?: readonly string[];
  /** Previous task id for conversation chaining. */
  readonly previousTaskId?: string;
  /** Arbitrary caller metadata, string-only by convention. */
  readonly metadata?: Record<string, string>;
}

/** Hard constraints the caller enforces on the agent's work. */
export interface AIAgentTaskConstraints {
  /** Maximum total cost in USD for the task. */
  readonly maxCostUsd?: number;
  /** Maximum wall-clock seconds before the task is cancelled. */
  readonly maxDurationSeconds?: number;
  /** Maximum tokens (prompt + completion) the agent may consume. */
  readonly maxTokens?: number;
  /** Whitelist of tool names the agent is permitted to call. */
  readonly allowedTools?: readonly string[];
}

/** Input shape for an agent task. */
export interface AIAgentTaskInput {
  /** UUID assigned by the caller (typically the api). */
  readonly taskId: string;
  readonly type: AIAgentTaskType;
  readonly prompt: string;
  readonly context?: AIAgentTaskContext;
  readonly constraints?: AIAgentTaskConstraints;
}

/** Token counts + cost for a single agent-task invocation. */
export interface AIAgentUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

/** Record of a tool call the agent made during task execution. */
export interface AIAgentToolCall {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly result: 'ok' | 'error';
  readonly durationMs: number;
}

/** Terminal output of a task that completed (success or failure). */
export interface AIAgentTaskOutput {
  /** Final text response or summary. */
  readonly text: string;
  /** Absolute paths to any files the agent wrote. */
  readonly artifacts?: readonly string[];
  readonly toolCalls?: readonly AIAgentToolCall[];
  readonly usage: AIAgentUsage;
}

/** Error shape when a task fails. */
export interface AIAgentTaskError {
  /** Stable error code for programmatic handling. */
  readonly code: string;
  /** Human-readable message. */
  readonly message: string;
  /** Whether the caller may retry. */
  readonly retriable: boolean;
  /** Extra context, free-form but JSON-serialisable. */
  readonly details?: Record<string, unknown>;
}

/**
 * Handle returned by AIAgent.executeTask. Represents a task
 * whose lifecycle can be polled, awaited, or cancelled.
 *
 * Implementations may produce handles incrementally (pending →
 * running → completed/failed/cancelled). Callers should treat
 * the handle as a snapshot — re-read the agent's view of the
 * task for fresh state.
 */
export interface AIAgentTaskHandle {
  readonly taskId: string;
  readonly status: AIAgentTaskStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly output?: AIAgentTaskOutput;
  readonly error?: AIAgentTaskError;
}

/**
 * Universal contract for every AI coding / task agent in
 * Operator-OS. Concrete implementations — ClaudeCodeAgent,
 * CodexAgent, CursorCLIAgent, GeminiCLIAgent, OllamaAgent,
 * ChatGPTDesktopAgent, CopilotWorkspaceAgent, CustomAgent —
 * conform to this shape from Day 1 of the Desktop Agent.
 *
 * Core code branches on capabilities, never on vendor. That is
 * the implementation of LAW #3 (Multi-AI Agnostic): agents plug
 * into the runtime through this interface, and adding a new
 * vendor touches zero existing code paths.
 *
 * Providers are DI'd as readonly fields so each agent can ship
 * with specialised implementations (e.g. CursorCLI with its
 * own sandboxed file system, Ollama with a zero-cost cost
 * provider).
 */
export interface AIAgent {
  readonly identity: AIAgentIdentity;
  readonly runtime: AIAgentRuntime;
  readonly manifest: AgentManifest;

  /** Get a fresh snapshot of the agent's operational state. */
  getStatus(): Promise<AIAgentStatus>;
  /** Narrow union of capabilities the agent advertises at runtime. */
  listCapabilities(): readonly AgentCapability[];

  /** Lifecycle: start accepting tasks. */
  start(): Promise<void>;
  /** Lifecycle: stop with a reason for audit. */
  stop(reason: 'user' | 'shutdown' | 'error'): Promise<void>;

  /** Submit a task, receive a handle whose status evolves. */
  executeTask(input: AIAgentTaskInput): Promise<AIAgentTaskHandle>;
  /** Request cancellation of a running task. Best-effort. */
  cancelTask(taskId: string): Promise<void>;

  /** Scoped file-system provider owned by the agent. */
  readonly fs: FileSystemProvider;
  /** Response-streaming provider owned by the agent. */
  readonly stream: StreamProvider;
  /** Cost tracking and budget enforcement owned by the agent. */
  readonly cost: CostProvider;
}
