import { encodeConversationShareLink } from '@workspace/core/conversation-sharing';
import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import { appCommandFromDeepLink, deepLinksFromArgv } from '../deep-links';

describe(`${product.name} deep links`, () => {
  it('routes bounded share links and development aliases without interpreting their secret as a prompt', () => {
    const link = encodeConversationShareLink({ v: 1, relay: product.companionRelay, ownerId: product.companionRelay.peerId, handle: 'H'.repeat(32), credential: 'C'.repeat(43) });
    expect(appCommandFromDeepLink(link)).toStrictEqual({ type: 'open-shared-conversation', link });
    const alias = link.replace(`${product.protocolScheme}:`, 'korus-dev-profile:');
    expect(appCommandFromDeepLink(alias, 'korus-dev-profile')).toStrictEqual({ type: 'open-shared-conversation', link });
    expect(appCommandFromDeepLink(alias, 'korus-dev-other')).toBeNull();
    expect(deepLinksFromArgv(['app', alias], 'korus-dev-profile')).toStrictEqual([alias]);
    expect(appCommandFromDeepLink(link.replace('v=1', 'v=9'))).toStrictEqual({ type: 'open-shared-conversation', link: link.replace('v=1', 'v=9') });
    expect(appCommandFromDeepLink(link + 'x'.repeat(2048))).toBeNull();
  });
  it('submits to the active agent by default', () => {
    expect(appCommandFromDeepLink(`${product.protocolScheme}://new?prompt=Profile%20five%20agents`)).toStrictEqual({
      type: 'open-agent-composer',
      prompt: 'Profile five agents',
      submit: true,
    });
  });

  it('selects a named agent and decodes its prompt', () => {
    expect(appCommandFromDeepLink(`${product.protocolScheme}://agents/agent-dina?prompt=Run%20the%20benchmark`)).toStrictEqual({
      type: 'open-agent-composer',
      agentId: 'agent-dina',
      prompt: 'Run the benchmark',
      submit: true,
    });
    expect(appCommandFromDeepLink(`${product.protocolScheme}://agents/agent-dina`)).toStrictEqual({
      type: 'open-agent-composer',
      agentId: 'agent-dina',
    });
  });

  it('supports an explicit draft-only link', () => {
    expect(appCommandFromDeepLink(`${product.protocolScheme}://agents/agent-dina?prompt=Review%20this&submit=false`)).toStrictEqual({
      type: 'open-agent-composer',
      agentId: 'agent-dina',
      prompt: 'Review this',
      submit: false,
    });
  });

  it('rejects malformed, unsupported, credentialed, fragmented, and oversized links', () => {
    expect(appCommandFromDeepLink('https://example.com')).toBeNull();
    expect(appCommandFromDeepLink(`${product.protocolScheme}://unknown?prompt=test`)).toBeNull();
    expect(appCommandFromDeepLink(`${product.protocolScheme}://user:secret@new?prompt=test`)).toBeNull();
    expect(appCommandFromDeepLink(`${product.protocolScheme}://new?prompt=test#fragment`)).toBeNull();
    expect(appCommandFromDeepLink(`${product.protocolScheme}://new?prompt=test&submit=maybe`)).toBeNull();
    expect(appCommandFromDeepLink(`${product.protocolScheme}://new?prompt=${'x'.repeat(100_001)}`)).toBeNull();
    expect(appCommandFromDeepLink(`${product.protocolScheme}://new`)).toBeNull();
  });

  it(`extracts only ${product.name} links from a secondary process argument list`, () => {
    expect(deepLinksFromArgv([
      `/Applications/${product.name}.app`,
      '--flag',
      `${product.protocolScheme}://new?prompt=one`,
      'https://example.com',
      `${product.protocolScheme}://agents/agent-dina?prompt=two`,
    ])).toStrictEqual([
      `${product.protocolScheme}://new?prompt=one`,
      `${product.protocolScheme}://agents/agent-dina?prompt=two`,
    ]);
  });
});
