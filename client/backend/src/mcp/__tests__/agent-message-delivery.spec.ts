import { describe, expect, it } from 'vitest';
import { parseCollaborationMessageEnvelope } from '@workspace/core/collaboration-message-envelope';
import { agentMessagesPrompt } from '../agent-prompts';

describe('agent message delivery', () => {
  it('preserves one teammate message in the collaboration envelope', () => {
    const prompt = agentMessagesPrompt([{
      from: 'SDK',
      fromId: 'agent-sdk',
      timestamp: '2026-08-02T12:00:00.000Z',
      content: 'The facade is ready.',
    }]);

    expect(parseCollaborationMessageEnvelope(prompt)).toStrictEqual({
      version: 1,
      messages: [{
        senderName: 'SDK',
        senderId: 'agent-sdk',
        sentAt: '2026-08-02T12:00:00.000Z',
        content: 'The facade is ready.',
      }],
    });
  });

  it('preserves the order and attribution of a teammate message batch', () => {
    const prompt = agentMessagesPrompt([{
      from: 'SDK',
      fromId: 'agent-sdk',
      timestamp: '2026-08-02T12:00:00.000Z',
      content: 'First',
    }, {
      from: 'Computer Use',
      fromId: 'agent-computer-use',
      timestamp: '2026-08-02T12:01:00.000Z',
      content: 'Second',
    }]);

    expect(parseCollaborationMessageEnvelope(prompt)?.messages).toStrictEqual([
      {
        senderName: 'SDK',
        senderId: 'agent-sdk',
        sentAt: '2026-08-02T12:00:00.000Z',
        content: 'First',
      },
      {
        senderName: 'Computer Use',
        senderId: 'agent-computer-use',
        sentAt: '2026-08-02T12:01:00.000Z',
        content: 'Second',
      },
    ]);
  });
});
