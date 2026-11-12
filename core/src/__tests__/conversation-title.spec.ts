import { product } from '../product';
import { describe, expect, it } from 'vitest';
import type { Agent } from '../contracts';
import { formatConversationTitle, shouldSyncConversationTitleFromAgent } from '../conversation-title';

describe('conversation titles', () => {
  it(`uses the ${product.name} agent name`, () => {
    expect(formatConversationTitle(agent())).toBe('Dina');
  });

  it('names workspace-free quick chats without exposing implementation details', () => {
    expect(formatConversationTitle({
      ...agent(),
      name: null,
      sessionKind: 'quickChat',
      folder: null,
    })).toBe('Untitled conversation');
  });

  it('uses the generated conversation title for an unnamed quick chat', () => {
    expect(formatConversationTitle({
      ...agent(),
      name: null,
      conversationTitle: 'Plan a summer trip',
      sessionKind: 'quickChat',
      folder: null,
    })).toBe('Plan a summer trip');
  });

  it('leaves unnamed quick-chat titles under backend control', () => {
    expect(shouldSyncConversationTitleFromAgent({
      ...agent(),
      name: null,
      sessionKind: 'quickChat',
      folder: null,
    })).toBe(false);

    expect(shouldSyncConversationTitleFromAgent({
      ...agent(),
      name: 'Trip planner',
      sessionKind: 'quickChat',
      folder: null,
    })).toBe(true);
    expect(shouldSyncConversationTitleFromAgent(agent())).toBe(true);
  });
});

function agent(): Agent {
  return {
    id: 'agent-dina',
    teamId: 'team-app',
    name: 'Dina',
    avatar: 'DI',
    folder: '/tmp/app',
    provider: 'codex',
    providerDefaults: { kind: 'codex' },
    status: { type: 'idle' },
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}
