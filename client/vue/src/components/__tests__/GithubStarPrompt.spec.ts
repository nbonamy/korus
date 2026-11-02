import { flushPromises, mount } from '@vue/test-utils';
import { createCodexConversationPaneController } from '@codex-app-sdk/vue';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { product } from '@workspace/core/product';
import { useAppState } from '../../app-state';
import { stubElectronTestWindow } from '../../test/client';
import ConversationPane from '../ConversationPane.vue';

// Exercise the real submission boundary and composer slot: failed/empty sends must
// not count, and a client-local dismissal must survive switching panes/reloading.
describe('GitHub star composer prompt', () => {
  it('appears after five successful human prompts across agents and stays dismissed', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.status = { type: 'working' };
    const sendPrompt = vi.fn(async () => structuredClone(snapshot));
    const steerPrompt = vi.fn(async () => structuredClone(snapshot));
    stubElectronTestWindow({ app: {
      getSnapshot: async () => structuredClone(snapshot), sendPrompt, steerPrompt,
    } });
    const state = useAppState();
    await state.loadSnapshot();
    const props = {
      controller: createCodexConversationPaneController({ state: { identity: { conversationKey: 'star', messages: [] } }, actions: {} }),
      agent: snapshot.agents[0]!,
    };
    const pane = mount(ConversationPane, { props });
    const notice = () => pane.find('.github-star-prompt');
    expect(notice().exists()).toBe(false);
    await state.sendPrompt('   ');
    sendPrompt.mockRejectedValueOnce(new Error('Offline'));
    await expect(state.sendPrompt('Failed send')).rejects.toThrow('Offline');
    for (let i = 0; i < 3; i++) await state.sendPrompt('A real prompt');
    await state.steerPrompt('A real follow-up');
    expect(steerPrompt).toHaveBeenCalledOnce();
    expect(notice().exists()).toBe(false);
    await state.sendAgentPrompt(snapshot.agents[1]!.id, 'Fifth prompt');
    await flushPromises();
    expect(notice().exists()).toBe(true);
    expect(notice().findAll('button')).toHaveLength(2);
    await pane.setProps({ keyboardActive: false });
    expect(notice().exists()).toBe(false);
    await pane.setProps({ keyboardActive: true });
    await notice().get('button[aria-label="Dismiss star reminder"]').trigger('click');
    expect(notice().exists()).toBe(false);
    pane.unmount();
    const restored = mount(ConversationPane, { props });
    await state.sendPrompt('Another prompt');
    await flushPromises();
    expect(restored.find('.github-star-prompt').exists()).toBe(false);
  });

  it('restores the prompt count and opens the product repository without asking again', async () => {
    localStorage.setItem('app:githubStarPrompt:v1', JSON.stringify({ sentPrompts: 4, dismissed: false }));
    const snapshot = createInitialSnapshot();
    stubElectronTestWindow({ app: {
      getSnapshot: async () => structuredClone(snapshot),
      sendPrompt: async () => structuredClone(snapshot),
    } });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const state = useAppState();
    await state.loadSnapshot();
    const props = {
      controller: createCodexConversationPaneController({ state: { identity: { conversationKey: 'star', messages: [] } }, actions: {} }),
      agent: snapshot.agents[0]!,
    };
    const pane = mount(ConversationPane, { props });
    expect(pane.find('.github-star-prompt').exists()).toBe(false);
    await state.sendPrompt('Fifth prompt after restarting');
    await flushPromises();
    await pane.get('.github-star-prompt button').trigger('click');
    expect(open).toHaveBeenCalledWith(product.repositoryUrl, '_blank', 'noopener,noreferrer');
    expect(pane.find('.github-star-prompt').exists()).toBe(false);
    pane.unmount();
    expect(mount(ConversationPane, { props }).find('.github-star-prompt').exists()).toBe(false);
    open.mockRestore();
  });
});
