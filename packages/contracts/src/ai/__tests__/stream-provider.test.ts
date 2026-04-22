import { describe, expectTypeOf, it } from 'vitest';

import type { AIAgentUsage } from '../ai-agent.js';
import type {
  AIResponseStream,
  StreamBackpressureConfig,
  StreamCompletion,
  StreamConfig,
  StreamDelta,
  StreamDeltaType,
  StreamError,
  StreamEvent,
  StreamListener,
  StreamProgress,
  StreamProvider,
  StreamSubscription,
  StreamToolCall,
  StreamToolCallStatus,
  StreamTransport
} from '../stream-provider.js';

describe('Stream enums', () => {
  it('StreamTransport is 3-variant union', () => {
    expectTypeOf<StreamTransport>().toEqualTypeOf<
      'websocket' | 'sse' | 'polling'
    >();
  });

  it('StreamDeltaType is 4-variant union', () => {
    expectTypeOf<StreamDeltaType>().toEqualTypeOf<
      'thinking' | 'answer' | 'code' | 'tool-result'
    >();
  });

  it('StreamToolCallStatus is 4-variant union', () => {
    expectTypeOf<StreamToolCallStatus>().toEqualTypeOf<
      'requested' | 'executing' | 'completed' | 'failed'
    >();
  });
});

describe('StreamConfig + backpressure', () => {
  it('config requires taskId, userId, transport', () => {
    expectTypeOf<StreamConfig['taskId']>().toEqualTypeOf<string>();
    expectTypeOf<StreamConfig['userId']>().toEqualTypeOf<string>();
    expectTypeOf<StreamConfig['transport']>().toEqualTypeOf<StreamTransport>();
  });

  it('backpressure is optional with onOverflow strategy', () => {
    expectTypeOf<StreamConfig['backpressure']>().toEqualTypeOf<
      StreamBackpressureConfig | undefined
    >();
    expectTypeOf<StreamBackpressureConfig['onOverflow']>().toEqualTypeOf<
      'drop-oldest' | 'drop-newest' | 'error'
    >();
  });
});

describe('Stream payload shapes', () => {
  it('StreamDelta requires type + content', () => {
    expectTypeOf<StreamDelta['type']>().toEqualTypeOf<StreamDeltaType>();
    expectTypeOf<StreamDelta['content']>().toEqualTypeOf<string>();
  });

  it('StreamToolCall requires toolName + arguments + status', () => {
    expectTypeOf<StreamToolCall['toolName']>().toEqualTypeOf<string>();
    expectTypeOf<StreamToolCall['arguments']>().toEqualTypeOf<
      Record<string, unknown>
    >();
    expectTypeOf<StreamToolCall['status']>().toEqualTypeOf<StreamToolCallStatus>();
  });

  it('StreamProgress stage required, percent+message optional', () => {
    expectTypeOf<StreamProgress['stage']>().toEqualTypeOf<string>();
    expectTypeOf<StreamProgress>()
      .toHaveProperty('percent')
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<StreamProgress>()
      .toHaveProperty('message')
      .toEqualTypeOf<string | undefined>();
  });

  it('StreamError requires code, message, fatal', () => {
    expectTypeOf<StreamError['code']>().toEqualTypeOf<string>();
    expectTypeOf<StreamError['message']>().toEqualTypeOf<string>();
    expectTypeOf<StreamError['fatal']>().toEqualTypeOf<boolean>();
  });

  it('StreamCompletion carries status, usage, optional outputPath', () => {
    expectTypeOf<StreamCompletion['status']>().toEqualTypeOf<
      'success' | 'partial' | 'failed'
    >();
    expectTypeOf<StreamCompletion['usage']>().toEqualTypeOf<AIAgentUsage>();
    expectTypeOf<StreamCompletion>()
      .toHaveProperty('outputPath')
      .toEqualTypeOf<string | undefined>();
  });
});

describe('StreamEvent discriminated union', () => {
  it('includes all 6 variants', () => {
    expectTypeOf<StreamEvent>().toEqualTypeOf<
      | { type: 'token'; token: string }
      | { type: 'delta'; delta: StreamDelta }
      | { type: 'tool-call'; call: StreamToolCall }
      | { type: 'progress'; progress: StreamProgress }
      | { type: 'error'; error: StreamError }
      | { type: 'completion'; completion: StreamCompletion }
    >();
  });

  it('listener takes an event, returns void', () => {
    expectTypeOf<StreamListener>().toEqualTypeOf<(event: StreamEvent) => void>();
  });

  it('subscription exposes unsubscribe: () => void', () => {
    expectTypeOf<StreamSubscription['unsubscribe']>().toEqualTypeOf<() => void>();
  });
});

describe('AIResponseStream + StreamProvider', () => {
  it('response stream emit* methods all return Promise<void>', () => {
    expectTypeOf<ReturnType<AIResponseStream['emitToken']>>().toEqualTypeOf<
      Promise<void>
    >();
    expectTypeOf<ReturnType<AIResponseStream['emitDelta']>>().toEqualTypeOf<
      Promise<void>
    >();
    expectTypeOf<ReturnType<AIResponseStream['emitCompletion']>>().toEqualTypeOf<
      Promise<void>
    >();
  });

  it('close takes reason union, returns Promise<void>', () => {
    type Arg = Parameters<AIResponseStream['close']>[0];
    expectTypeOf<Arg>().toEqualTypeOf<'completed' | 'cancelled' | 'error'>();
  });

  it('StreamProvider.createStream takes config, returns stream', () => {
    expectTypeOf<StreamProvider['createStream']>().toEqualTypeOf<
      (config: StreamConfig) => AIResponseStream
    >();
  });
});
