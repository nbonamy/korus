import type { Options as ClaudeQueryOptions, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { vi } from 'vitest';
import type { ClaudeQueryFactory, ClaudeQueryRuntime } from '../agent-sdk-transport';
import type { ClaudeSdkMessage } from '../protocol';

export function createQueryHarness(initializationModels: Array<Record<string, unknown>> = []): {
  createQuery: ReturnType<typeof vi.fn<ClaudeQueryFactory>>;
  inputs: SDKUserMessage[];
  options: ClaudeQueryOptions[];
  runtimes: Array<ClaudeQueryRuntime & {
    interrupt: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
    setPermissionMode: ReturnType<typeof vi.fn>;
    applyFlagSettings: ReturnType<typeof vi.fn>;
    supportedModels: ReturnType<typeof vi.fn>;
    initializationResult: ReturnType<typeof vi.fn>;
    getContextUsage: ReturnType<typeof vi.fn>;
  }>;
  emit(message: ClaudeSdkMessage, queryIndex?: number): void;
} {
  const inputs: SDKUserMessage[] = [];
  const options: ClaudeQueryOptions[] = [];
  const runtimes: Array<ClaudeQueryRuntime & {
    interrupt: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
    setPermissionMode: ReturnType<typeof vi.fn>;
    applyFlagSettings: ReturnType<typeof vi.fn>;
    supportedModels: ReturnType<typeof vi.fn>;
    initializationResult: ReturnType<typeof vi.fn>;
    getContextUsage: ReturnType<typeof vi.fn>;
  }> = [];
  let output = new TestAsyncQueue<SDKMessage>();
  const outputs: TestAsyncQueue<SDKMessage>[] = [];
  const createQuery = vi.fn<ClaudeQueryFactory>((input) => {
    options.push(input.options);
    void collectInputs(input.prompt, inputs);
    const queryOutput = new TestAsyncQueue<SDKMessage>();
    output = queryOutput;
    outputs.push(queryOutput);
    const runtime: ClaudeQueryRuntime & {
      interrupt: ReturnType<typeof vi.fn>;
      setModel: ReturnType<typeof vi.fn>;
      setPermissionMode: ReturnType<typeof vi.fn>;
      applyFlagSettings: ReturnType<typeof vi.fn>;
      supportedModels: ReturnType<typeof vi.fn>;
      initializationResult: ReturnType<typeof vi.fn>;
      getContextUsage: ReturnType<typeof vi.fn>;
    } = {
      [Symbol.asyncIterator]: () => queryOutput[Symbol.asyncIterator](),
      interrupt: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      applyFlagSettings: vi.fn().mockResolvedValue(undefined),
      supportedModels: vi.fn().mockResolvedValue([]),
      initializationResult: vi.fn().mockResolvedValue({ models: initializationModels }),
      getContextUsage: vi.fn().mockResolvedValue({
        categories: [],
        totalTokens: 0,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 0,
        gridRows: [],
        model: 'sonnet',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
      }),
      close: vi.fn(() => queryOutput.close()),
    };
    runtimes.push(runtime);
    return runtime;
  });

  return {
    createQuery,
    inputs,
    options,
    runtimes,
    emit: (message, queryIndex) => (queryIndex === undefined ? output : outputs[queryIndex]!).push(message as SDKMessage),
  };
}

async function collectInputs(input: AsyncIterable<SDKUserMessage>, values: SDKUserMessage[]): Promise<void> {
  for await (const message of input) {
    values.push(message);
  }
}

class TestAsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
