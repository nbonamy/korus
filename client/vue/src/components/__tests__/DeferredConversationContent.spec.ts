import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import DeferredConversationContent from '../DeferredConversationContent.vue';
import type { ConversationContentChunk } from '@workspace/core/contracts/conversation';

const message = { id: 'message', agentId: 'agent', role: 'assistant', status: 'complete', createdAt: '', parts: [{ type: 'tool', id: 'tool', kind: 'command', title: 'Read', status: 'completed', body: '工具🙂'.repeat(20_000) }] };
const bytes = Buffer.from(JSON.stringify(message));
const props = { agentId: 'agent', sessionId: 'session', messageId: 'message', content: { contentId: 'content', byteLength: bytes.length } };
const chunkAt = (offset: number): ConversationContentChunk => ({ data: bytes.subarray(offset, offset + 64 * 1024).toString('base64'), totalBytes: bytes.length, nextOffset: offset + 64 * 1024 < bytes.length ? offset + 64 * 1024 : null });

describe('DeferredConversationContent', () => {
  it('reads a cut row by itself, in order, and hands the full row to the pane without showing anything', async () => {
    const read = vi.fn(async (_agentId, input) => chunkAt(input.offset));
    const wrapper = mount(DeferredConversationContent, { props: { ...props, read } });
    await flushPromises();
    expect(read.mock.calls.every(([id, input]) => id === 'agent' && input.sessionId === 'session' && input.contentId === 'content')).toBe(true);
    expect(wrapper.emitted('loaded')).toStrictEqual([['content', message]]);
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
    wrapper.unmount();
  });
  it('never reads more than two rows at a time', async () => {
    const releases: (() => void)[] = []; let active = 0; let peak = 0;
    const read = vi.fn(async (_agentId, input) => { active++; peak = Math.max(peak, active); await new Promise<void>((resolve) => releases.push(resolve)); active--; return chunkAt(input.offset); });
    const wrappers = Array.from({ length: 4 }, (_, index) => mount(DeferredConversationContent, { props: { ...props, content: { contentId: `content-${index}`, byteLength: bytes.length }, read } }));
    for (let round = 0; round < 40 && wrappers.some((wrapper) => !wrapper.emitted('loaded')); round++) { await flushPromises(); releases.splice(0).forEach((release) => release()); await flushPromises(); }
    expect(wrappers.map((wrapper) => wrapper.emitted('loaded')?.length)).toEqual([1, 1, 1, 1]);
    expect(peak).toBeLessThanOrEqual(2);
    wrappers.forEach((wrapper) => wrapper.unmount());
  });
  it('leaves a very large row as its preview without even asking for it', async () => {
    const read = vi.fn();
    const wrapper = mount(DeferredConversationContent, { props: { ...props, content: { contentId: 'huge', byteLength: 20 * 1024 * 1024 }, read } });
    await flushPromises();
    expect(read).not.toHaveBeenCalled();
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.unmount();
  });
  it('keeps the preview, silently, when a read fails', async () => {
    const wrapper = mount(DeferredConversationContent, { props: { ...props, read: vi.fn().mockRejectedValue(new Error('offline')) } });
    await flushPromises();
    expect(wrapper.emitted('loaded')).toBeUndefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.unmount();
  });
  it('drops a late chunk after the session changes', async () => {
    let finish!: (chunk: ConversationContentChunk) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementation(async () => { throw new Error('gone'); });
    const wrapper = mount(DeferredConversationContent, { props: { ...props, read } });
    await flushPromises();
    await wrapper.setProps({ sessionId: 'new-session' });
    finish(chunkAt(0)); await flushPromises();
    expect(wrapper.emitted('loaded')).toBeUndefined();
    wrapper.unmount();
  });
  it('rejects malformed chunk boundaries instead of looping or rendering a partial message', async () => {
    const wrapper = mount(DeferredConversationContent, { props: { ...props, read: async () => ({ ...chunkAt(0), nextOffset: 0 }) } });
    await flushPromises();
    expect(wrapper.emitted('loaded')).toBeUndefined();
    wrapper.unmount();
  });
});
