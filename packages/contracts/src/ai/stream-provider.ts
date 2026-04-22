import type { AIAgentUsage } from './ai-agent.js';

/** Transport flavour of a StreamProvider implementation. */
export type StreamTransport = 'websocket' | 'sse' | 'polling';

/** How to behave when subscribers can't keep up. */
export interface StreamBackpressureConfig {
  readonly maxBufferEvents: number;
  readonly onOverflow: 'drop-oldest' | 'drop-newest' | 'error';
}

/** Per-stream configuration passed to createStream. */
export interface StreamConfig {
  readonly taskId: string;
  readonly userId: string;
  readonly transport: StreamTransport;
  readonly backpressure?: StreamBackpressureConfig;
}

/** Classification of an incremental output chunk. */
export type StreamDeltaType =
  | 'thinking'
  | 'answer'
  | 'code'
  | 'tool-result';

/** Incremental chunk of agent output. */
export interface StreamDelta {
  readonly type: StreamDeltaType;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

/** Lifecycle status of a tool call visible on the stream. */
export type StreamToolCallStatus =
  | 'requested'
  | 'executing'
  | 'completed'
  | 'failed';

/** Tool call as seen from the stream's perspective. */
export interface StreamToolCall {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly status: StreamToolCallStatus;
  readonly result?: unknown;
}

/** Progress signal emitted during long-running work. */
export interface StreamProgress {
  /** Short label, e.g. 'analyzing', 'writing-code'. */
  readonly stage: string;
  /** 0-100 if known, otherwise undefined. */
  readonly percent?: number;
  readonly message?: string;
}

/** Error surfaced onto the stream without closing it. */
export interface StreamError {
  readonly code: string;
  readonly message: string;
  /** If true, the stream will also close immediately after. */
  readonly fatal: boolean;
}

/** Terminal event summarising what the task produced. */
export interface StreamCompletion {
  readonly status: 'success' | 'partial' | 'failed';
  readonly usage: AIAgentUsage;
  /** Absolute path to any artefact written by the agent. */
  readonly outputPath?: string;
}

/** Discriminated union of events flowing on a stream. */
export type StreamEvent =
  | { type: 'token'; token: string }
  | { type: 'delta'; delta: StreamDelta }
  | { type: 'tool-call'; call: StreamToolCall }
  | { type: 'progress'; progress: StreamProgress }
  | { type: 'error'; error: StreamError }
  | { type: 'completion'; completion: StreamCompletion };

export type StreamListener = (event: StreamEvent) => void;

/** Handle returned by AIResponseStream.subscribe; call to stop. */
export interface StreamSubscription {
  unsubscribe(): void;
}

/**
 * A single active response stream for one task. Publisher is
 * the agent (via emitX methods); subscribers are the backend /
 * mobile clients that render tokens as they arrive.
 *
 * Implementations may be in-memory (dev / local), WebSocket
 * (production mobile), or SSE (browser). The agent does not
 * need to know which — that choice is in the StreamConfig.
 */
export interface AIResponseStream {
  readonly taskId: string;

  emitToken(token: string): Promise<void>;
  emitDelta(delta: StreamDelta): Promise<void>;
  emitToolCall(call: StreamToolCall): Promise<void>;
  emitProgress(progress: StreamProgress): Promise<void>;
  emitError(error: StreamError): Promise<void>;
  emitCompletion(completion: StreamCompletion): Promise<void>;

  subscribe(listener: StreamListener): StreamSubscription;

  close(reason: 'completed' | 'cancelled' | 'error'): Promise<void>;
}

/**
 * Factory for AIResponseStream instances. Every agent owns its
 * own StreamProvider (AIAgent.stream) so the transport choice
 * can differ per agent — e.g. an on-device Ollama agent may
 * use an in-memory transport while a cloud-backed
 * ChatGPTDesktopAgent uses WebSocket.
 */
export interface StreamProvider {
  createStream(config: StreamConfig): AIResponseStream;
}
