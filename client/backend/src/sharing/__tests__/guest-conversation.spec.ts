import { describe, expect, it } from 'vitest';
import type { Message, SessionPatchOp, SessionState } from '@korus-dev/multi-agent-sdk';
import { deliveredMessages, guestConversationUpdate, type SessionConversationEvent } from '../guest-conversation';

// A guest may fetch only what it was shown, so every way a patch delivers message content must be accounted for.
const message = (id: string, parts: Message['parts'], extra: Partial<Message> = {}) => ({ id, agentId: 'a', role: 'assistant', createdAt: '2026-11-11T00:00:00.000Z', parts, ...extra }) as Message;
const patch = (ops: SessionPatchOp[]): SessionConversationEvent => ({ type: 'conversation.sessionPatch', agentId: 'a', provider: 'claude', payload: { conversation: 'c', epoch: 'e', patch: { revision: 2, ops } } }) as SessionConversationEvent;
const state = (messages: Message[]) => ({ messages }) as SessionState;

describe('guest conversation patches', () => {
  it('keeps the ops that change a message and drops the owner-only fields', () => {
    const ops: SessionPatchOp[] = [
      { op: 'set', key: 'permission', value: 'full-access' }, { op: 'set', key: 'busy', value: true },
      { op: 'appendPartText', index: 0, part: 0, field: 'text', text: 'lo' },
      { op: 'spliceParts', index: 0, start: 1, deleteCount: 0, parts: [] },
      { op: 'setMessageFields', index: 0, fields: { status: 'complete' } },
    ];
    const update = guestConversationUpdate(patch(ops));
    expect(update.type === 'conversation.sessionPatch' && update.payload.patch.ops.map(op => op.op === 'set' ? op.key : op.op))
      .toStrictEqual(['busy', 'appendPartText', 'spliceParts', 'setMessageFields']);
  });

  it('reports the whole message a message-level op changed, as the guest now holds it', () => {
    const after = state([message('m0', [{ type: 'text', text: 'Earlier' }]), message('m1', [{ type: 'text', text: '![shot](/tmp/shot.png)' }])]);
    const update = guestConversationUpdate(patch([{ op: 'appendPartText', index: 1, part: 0, field: 'text', text: '.png)' }, { op: 'setMessageFields', index: 1, fields: { status: 'complete' } }]));
    expect(deliveredMessages(update, after)).toStrictEqual([after.messages[1]]);
  });

  it('falls back to what the ops carry when the resulting state is not at hand', () => {
    const part = { type: 'text', text: 'New' } as Message['parts'][number];
    const update = guestConversationUpdate(patch([
      { op: 'spliceParts', index: 0, start: 0, deleteCount: 0, parts: [part] },
      { op: 'setMessageFields', index: 0, fields: { deferredContent: { contentId: 'content-1' } } },
    ]));
    expect(deliveredMessages(update)).toMatchObject([{ parts: [part] }, { deferredContent: { contentId: 'content-1' }, parts: [] }]);
  });
});
