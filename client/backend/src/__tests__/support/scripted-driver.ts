import { createScriptedHarness, type HarnessScript, type ScriptedHarnessOptions, type ScriptedOperation } from '@korus-dev/multi-agent-sdk/testing';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import type { Agent, HarnessProvider, SendPromptOptions } from '@workspace/core/contracts';
import { AgentRegistry, HarnessAgentDriver } from '../../harness-agent-driver';

type OperationHandler = (...args: never[]) => unknown;

export type ScriptedPrompt = { agent: Agent; prompt: string; options: SendPromptOptions | undefined };

/**
 * Korus's driver over a provider that only does what the test scripts. A prompt the test sends succeeds with a plausible
 * result unless `script.on('sendPrompt', ...)` replaces it; replace it by returning the provider's whole result, session included.
 */
export function scriptedDriver(provider: HarnessProvider, options?: ScriptedHarnessOptions, policy: Omit<ConstructorParameters<typeof HarnessAgentDriver>[2], 'agents'> = {}) {
  const { harness, script } = createScriptedHarness(provider, options);
  const driver = new HarnessAgentDriver(provider, harness, { agents: new AgentRegistry(), ...policy }) as AgentProviderDriver;
  const promptCalls = (operation: 'sendPrompt' | 'steerPrompt'): ScriptedPrompt[] => script.calls(operation).map(({ args }) => {
    const [agent, prompt, promptOptions] = args as [Agent, string, SendPromptOptions | undefined];
    return { agent, prompt, options: promptOptions };
  });
  const queued = new Map<ScriptedOperation, OperationHandler[]>();
  const fallbacks = new Map<ScriptedOperation, OperationHandler>();
  const install = (operation: ScriptedOperation) => {
    if (queued.has(operation)) return;
    queued.set(operation, []);
    script.on(operation, ((...args: never[]) => {
      const handler = queued.get(operation)!.shift() ?? fallbacks.get(operation);
      if (!handler) throw new Error(`Script ${operation} with respondOnce or respondAlways before it is called.`);
      return handler(...args);
    }) as OperationHandler);
  };
  return {
    provider,
    driver,
    script,
    /** Makes the agents' saved conversations known, so provider events and prompts resolve to them. */
    admit: async (...agents: Agent[]): Promise<void> => { for (const agent of agents) await driver.loadConversation!(agent); },
    /** The arguments of every call an operation received, oldest first. */
    calls: (operation: ScriptedOperation): unknown[][] => script.calls(operation).map(({ args }) => args),
    /** The prompts that reached the provider, oldest first. */
    sentPrompts: (): ScriptedPrompt[] => promptCalls('sendPrompt'),
    /** The prompts the provider was asked to steer into an active turn, oldest first. */
    steeredPrompts: (): ScriptedPrompt[] => promptCalls('steerPrompt'),
    /** What the next call of an operation does; later calls use `respondAlways`. A handler that throws rejects the call. */
    respondOnce: (operation: ScriptedOperation, handler: OperationHandler): void => { install(operation); queued.get(operation)!.push(handler); },
    /** What every call of an operation does once no `respondOnce` is queued. */
    respondAlways: (operation: ScriptedOperation, handler: OperationHandler): void => { install(operation); fallbacks.set(operation, handler); },
    /** The provider proposes a plan for the user to review. */
    proposePlan: (agentId: string, turnId: string, markdown: string): void => script.emit({ type: 'plan.readyForReview', agentId, provider, turnId, payload: { markdown, itemId: turnId } }),
  };
}

type ScriptedDriver = ReturnType<typeof scriptedDriver>;
export type PromptLogEntry = { provider: HarnessProvider; agentId: string; prompt: string; options: SendPromptOptions | undefined };

/**
 * One chronological record of the prompts that reach several drivers, for tests that assert order across providers.
 * Each prompt is accepted as the agent's own session, which suits agents that already have one.
 */
export function orderedPromptLog(...drivers: ScriptedDriver[]): PromptLogEntry[] {
  const log: PromptLogEntry[] = [];
  for (const { provider, script } of drivers) {
    script.on('sendPrompt', ((context: { id: string; providerSession: unknown }, prompt: string, options?: SendPromptOptions) => {
      log.push({ provider, agentId: context.id, prompt, options });
      return { providerSession: context.providerSession };
    }) as OperationHandler);
  }
  return log;
}

/** A Claude driver whose local sign-in state the test controls. */
export function claudeAuthenticationDriver(auth: { check: () => Promise<{ loggedIn: boolean }>; logout: () => Promise<{ loggedIn: boolean }> }): AgentProviderDriver {
  const { driver, script } = scriptedDriver('claude');
  script.on('authenticate', (async (request: { action: string }) => {
    const state = request.action === 'logout' ? await auth.logout() : await auth.check();
    return { kind: 'claude', connected: request.action !== 'logout' && state.loggedIn, state };
  }) as never);
  return driver;
}
