import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import DeferredConversationContent from '../DeferredConversationContent.vue';
import type { ConversationContentChunk } from '@workspace/core/contracts/conversation';

const message = { id: 'message', agentId: 'agent', role: 'assistant', status: 'complete', createdAt: '', parts: [{ type: 'tool', id: 'tool', kind: 'command', title: 'Read', status: 'completed', body: '工具🙂'.repeat(20_000) }] };
const bytes = Buffer.from(JSON.stringify(message));
const props = { agentId: 'agent', sessionId: 'session', messageId: 'message', content: { contentId: 'content', byteLength: bytes.length } };
const chunkAt = (offset: number): ConversationContentChunk => ({ data: bytes.subarray(offset, offset + 64 * 1024).toString('base64'), totalBytes: bytes.length, nextOffset: offset + 64 * 1024 < bytes.length ? offset + 64 * 1024 : null });

describe('DeferredConversationContent', () => {
  it('fetches only on demand, reconstructs Unicode chunks and delivers the full row to the renderer', async () => {
    const read = vi.fn(async (_agentId, input) => chunkAt(input.offset));
    const wrapper = mount(DeferredConversationContent, { props: { ...props, read } });
    expect(read).not.toHaveBeenCalled();
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(read.mock.calls.every(([id, input]) => id === 'agent' && input.sessionId === 'session' && input.contentId === 'content')).toBe(true);
    expect(wrapper.emitted('loaded')).toStrictEqual([['content', message]]);
    wrapper.unmount();
  });
  it('offers retry after failure and drops a late chunk after the session changes', async () => {
    let finish!: (chunk: ConversationContentChunk) => void;
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const wrapper = mount(DeferredConversationContent, { props: { ...props, read } });
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await wrapper.get('button').trigger('click');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ sessionId: 'new-session' });
    finish(chunkAt(0)); await flushPromises();
    expect(wrapper.emitted('loaded')).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('rejects malformed chunk boundaries instead of looping or rendering a partial message', async () => {
    const wrapper = mount(DeferredConversationContent, { props: { ...props, read: async () => ({ ...chunkAt(0), nextOffset: 0 }) } });
    await wrapper.get('button').trigger('click'); await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.emitted('loaded')).toBeUndefined();
    wrapper.unmount();
  });
});
