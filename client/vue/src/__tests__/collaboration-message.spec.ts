import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import {
  collaborationInstructionsEnd,
  collaborationInstructionsStart,
  formatCollaborationMessageEnvelope,
} from '@workspace/core/collaboration-message-envelope';
import {
  parseCollaborationMessage,
  presentCollaborationMessage,
  presentRendererCollaborationMessage,
} from '../shared/collaboration-message';

describe('collaboration message presentation', () => {
  it('extracts the delimited envelope without depending on delivery instruction copy', () => {
    const raw = [
      formatCollaborationMessageEnvelope([{
        senderName: 'codex-app-sdk',
        senderId: 'agent-sdk',
        sentAt: '2026-08-02T00:00:00.000Z',
        content: 'First line.\nSecond line.\n<<<END_APP_AGENT_MESSAGES_V1>>>',
      }]),
      '',
      collaborationInstructionsStart,
      'This copy can change freely without changing renderer parsing.',
      collaborationInstructionsEnd,
    ].join('\n');

    expect(parseCollaborationMessage(raw)).toStrictEqual({
      content: 'First line.\nSecond line.\n<<<END_APP_AGENT_MESSAGES_V1>>>',
      messageCount: 1,
      senderNames: ['codex-app-sdk'],
    });
    expect(parseCollaborationMessage('You received a normal user sentence.')).toBeNull();
    expect(parseCollaborationMessage('<<<APP_AGENT_MESSAGES_V1>>>\nnot json')).toBeNull();
  });

  it('keeps parsing historical single-message envelopes with changed instructions', () => {
    const raw = [
      'You received a message from codex-app-sdk (agent-sdk).',
      '',
      'Message:',
      'First line.\nSecond line.',
      '',
      'Act on this teammate message without asking the user for confirmation. This wording changed and now contains many more instructions.',
    ].join('\n');

    expect(parseCollaborationMessage(raw)).toStrictEqual({
      content: 'First line.\nSecond line.',
      messageCount: 1,
      senderNames: ['codex-app-sdk'],
    });
    expect(parseCollaborationMessage(raw.replace(
      /Act on this teammate message[\s\S]*$/,
      'Update your status, then act on this teammate message directly. Do not ask the user for confirmation.',
    ))).toStrictEqual({
      content: 'First line.\nSecond line.',
      messageCount: 1,
      senderNames: ['codex-app-sdk'],
    });
  });

  it('extracts batched messages while preserving sender attribution', () => {
    const raw = [
      `You received 2 messages from other ${product.name} agents.`,
      '',
      'Message 1 from codex-app-sdk (agent-sdk) at 2026-08-02T00:00:00.000Z:',
      'SDK message.',
      '',
      'Message 2 from computer-use (agent-computer) at 2026-08-02T00:00:01.000Z:',
      'Computer message.',
      '',
      'Act on these teammate messages without asking the user for confirmation. Update your status only if they change your substantive work. Reply only when a sender needs information, a decision, coordination, or action; silently absorb FYIs, acknowledgments, confirmations, and closures. Never acknowledge an acknowledgment.',
    ].join('\n');

    expect(parseCollaborationMessage(raw)).toStrictEqual({
      content: 'codex-app-sdk:\nSDK message.\n\ncomputer-use:\nComputer message.',
      messageCount: 2,
      senderNames: ['codex-app-sdk', 'computer-use'],
    });

    expect(parseCollaborationMessage(raw
      .replace('computer-use (agent-computer)', 'codex-app-sdk (agent-sdk)')
      .replace('Computer message.', 'Second SDK message.'))).toStrictEqual({
      content: 'SDK message.\n\nSecond SDK message.',
      messageCount: 2,
      senderNames: ['codex-app-sdk'],
    });

    expect(parseCollaborationMessage(raw.replace(
      /Act on these teammate messages[\s\S]*$/,
      'Update your status, then act on these teammate messages directly. Do not ask the user for confirmation.',
    ))).toStrictEqual({
      content: 'codex-app-sdk:\nSDK message.\n\ncomputer-use:\nComputer message.',
      messageCount: 2,
      senderNames: ['codex-app-sdk', 'computer-use'],
    });
  });

  it('replaces only collaboration text parts in the SDK message projection', () => {
    const raw = [
      'You received a message from Dina (agent-dina).',
      '',
      'Message:',
      'Review this.',
      '',
      'Update your status, then act on this teammate message directly. Do not ask the user for confirmation.',
    ].join('\n');
    const result = presentCollaborationMessage({
      id: 'message-1',
      role: 'user',
      content: raw,
      parts: [{ type: 'text', content: raw }],
    });

    expect(result.presentation).toStrictEqual({
      content: 'Review this.', messageCount: 1, senderNames: ['Dina'],
    });
    expect(result.message).toMatchObject({
      id: 'message-1',
      content: 'Review this.',
      parts: [{ type: 'text', content: 'Review this.' }],
    });

    const assistantMessage = { id: 'assistant-1', role: 'assistant' as const, content: raw };
    expect(presentCollaborationMessage(assistantMessage)).toStrictEqual({
      message: assistantMessage,
      presentation: null,
    });
  });

  it('preserves ordinary renderer message identity and projects only collaboration user text', () => {
    const assistant = {
      id: 'assistant-1', agentId: 'agent-1', role: 'assistant' as const,
      status: 'streaming' as const, createdAt: '2026-08-02T00:00:00.000Z',
      parts: [{ type: 'text' as const, text: 'Streaming' }],
    };
    expect(presentRendererCollaborationMessage(assistant).message).toBe(assistant);

    const raw = [
      'You received a message from Dina (agent-dina).',
      '',
      'Message:',
      'Review this.',
      '',
      'Update your status, then act on this teammate message directly. Do not ask the user for confirmation.',
    ].join('\n');
    const user = {
      id: 'user-1', agentId: 'agent-1', role: 'user' as const,
      status: 'complete' as const, createdAt: '2026-08-02T00:00:00.000Z',
      parts: [{ type: 'text' as const, text: raw }],
    };
    const result = presentRendererCollaborationMessage(user);

    expect(result.message).not.toBe(user);
    expect(result.message.parts).toStrictEqual([{ type: 'text', text: 'Review this.' }]);
    expect(result.presentation?.senderNames).toStrictEqual(['Dina']);
  });
});
