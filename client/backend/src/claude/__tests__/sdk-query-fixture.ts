import { vi, type Mock } from 'vitest';

type Fn = Mock<(...args: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
import { createScriptedClaudeHarness, type ScriptedClaude } from '@korus-dev/multi-agent-sdk/testing';
import { createClaudeDriver } from '../../harness-drivers';

type DriverOptions = Parameters<typeof createClaudeDriver>[0];
const controls = ['interrupt', 'setModel', 'setPermissionMode', 'applyFlagSettings', 'supportedModels', 'initializationResult', 'getContextUsage'] as const;

/**
 * Claude, with the agent connection scripted. `driver()` returns Korus's real Claude driver over the SDK's real host;
 * `emit` plays Claude Agent SDK messages into it.
 */
export function createQueryHarness(initializationModels: Array<Record<string, unknown>> = []) {
  // Drivers made from one fixture share one query numbering, as they shared one query factory before.
  const harnesses: ScriptedClaude[] = [];
  const locate = (queryIndex?: number) => {
    if (queryIndex === undefined) { const last = [...harnesses].reverse().find(h => h.queryOptions.length > 0) ?? harnesses.at(-1)!; return { harness: last, local: undefined as number | undefined }; }
    let offset = 0;
    for (const harness of harnesses) { if (queryIndex < offset + harness.queryOptions.length) return { harness, local: queryIndex - offset }; offset += harness.queryOptions.length; }
    throw new Error(`No query ${queryIndex}.`);
  };
  const total = () => harnesses.reduce((sum, harness) => sum + harness.queryOptions.length, 0);
  const spy = (queryIndex: number, method: string) => {
    const fn: Fn = vi.fn();
    const { harness, local } = locate(queryIndex);
    for (const call of harness.controlCalls(local)) if (call.method === method) fn(...call.args);
    return fn;
  };
  return {
    /** The driver Korus runs for Claude; pass the same options Korus passes. */
    driver(options: DriverOptions = {}) {
      return createClaudeDriver(options, (_provider, harnessOptions) => {
        const scripted = createScriptedClaudeHarness(harnessOptions, initializationModels);
        harnesses.push(scripted);
        return scripted.harness;
      });
    },
    emit: (message: Record<string, unknown>, queryIndex?: number) => { const { harness, local } = locate(queryIndex); harness.emit(message, local); },
    get inputs() { return harnesses.flatMap(harness => harness.inputs) as Array<Record<string, any>>; }, // eslint-disable-line @typescript-eslint/no-explicit-any
    get options() { return harnesses.flatMap(harness => harness.queryOptions) as Array<Record<string, any>>; }, // eslint-disable-line @typescript-eslint/no-explicit-any
    /** Spies over what the harness asked each running query to do, as of now. */
    get runtimes() {
      return Array.from({ length: total() }, (_, index) => ({ close: () => { const { harness, local } = locate(index); harness.closeQuery(local); }, ...Object.fromEntries(controls.map(method => [method, spy(index, method)])) })) as Array<Record<(typeof controls)[number], Fn> & { close(): void }>;
    },
    get createQuery() { const fn: Fn = vi.fn(); for (let i = 0; i < total(); i++) fn(); return fn; },
  };
}
