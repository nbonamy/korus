import { describe, expect, it } from 'vitest';
import { codexHarnessCapabilities, claudeHarnessCapabilities, cursorHarnessCapabilities, antigravityHarnessCapabilities, harnessProviders } from '@korus-dev/multi-agent-sdk/contracts';
import { defaultProviderCapabilities } from '../provider-capabilities';

// Korus may add flags of its own to a harness's capabilities, but a flag that only one harness has is a provider check
// under another name. Such a choice belongs in `providerPolicy`, with its reason, unless it is listed here.
const singleHarnessFlags: Record<string, string> = {
  conversationReplaceWithSummary: 'Compression seeds a new conversation from a summary, which Korus builds only on Codex threads.',
};

describe('provider neutrality', () => {
  it('keeps Korus capability flags that one harness alone has to a short, explained list', () => {
    const sdk = [codexHarnessCapabilities, claudeHarnessCapabilities, cursorHarnessCapabilities, antigravityHarnessCapabilities];
    const sdkKeys = new Set(sdk.flatMap(table => Object.keys(table)));
    const korusKeys = new Set(harnessProviders.flatMap(provider => Object.keys(defaultProviderCapabilities(provider))).filter(key => !sdkKeys.has(key)));
    const single = [...korusKeys].filter(key => harnessProviders.filter(provider => (defaultProviderCapabilities(provider) as Record<string, unknown>)[key] === true).length === 1);
    expect(single.filter(key => !(key in singleHarnessFlags))).toStrictEqual([]);
    expect(Object.keys(singleHarnessFlags).filter(key => !single.includes(key))).toStrictEqual([]);
  });
});
