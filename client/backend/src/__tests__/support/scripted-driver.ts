import { createScriptedHarness, type HarnessScript, type ScriptedHarnessOptions } from '@korus-dev/multi-agent-sdk/testing';
import type { AgentProviderDriver } from '@workspace/core/provider-driver';
import type { HarnessProvider } from '@workspace/core/contracts';
import { AgentRegistry, HarnessAgentDriver } from '../../harness-agent-driver';

/** Korus's driver over a provider that only does what the test scripts. */
export function scriptedDriver(provider: HarnessProvider, options?: ScriptedHarnessOptions): { driver: AgentProviderDriver; script: HarnessScript } {
  const { harness, script } = createScriptedHarness(provider, options);
  return { driver: new HarnessAgentDriver(provider, harness, { agents: new AgentRegistry() }) as AgentProviderDriver, script };
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
