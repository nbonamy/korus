import { flushPromises, mount } from '@vue/test-utils';
import { createConversationPaneController as createCodexConversationPaneController } from 'ai-app-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { product } from '@workspace/core/product';
import { updateSettingsInSnapshot } from '@workspace/core/settings';
import { createGeneralPreferences, generalPreferencesKey } from '../../src/general-preferences';
import { useAppState } from '../../src/app-state';
import { stubElectronTestWindow } from '../support/client';
import ConversationPane from '../../src/components/ConversationPane.vue';

// Exercise the real submission boundary and composer slot: failed/empty sends must
// not count, and a persisted dismissal must survive switching panes/reloading.
describe('GitHub star composer prompt', () => {
  it('appears after five successful human prompts across agents and stays dismissed', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.status = { type: 'working' };
    const sendPrompt = vi.fn(async () => structuredClone(snapshot));
    const steerPrompt = vi.fn(async () => structuredClone(snapshot));
    stubElectronTestWindow({ app: {
      getSnapshot: async () => structuredClone(snapshot), sendPrompt, steerPrompt,
      updateSettings: async input => { updateSettingsInSnapshot(snapshot, input); return structuredClone(snapshot); },
    } });
    const state = useAppState();
    await state.loadSnapshot();
    const global = { provide: { [generalPreferencesKey as symbol]: createGeneralPreferences(() => state.snapshot.value.general, general => state.updateSettings({ general })) } };
    const props = {
      controller: createCodexConversationPaneController({ state: { identity: { conversationKey: 'star', messages: [] } }, actions: {} }),
      agent: snapshot.agents[0]!,
    };
    const pane = mount(ConversationPane, { props, global });
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
    await flushPromises();
    expect(notice().exists()).toBe(false);
    expect(snapshot.general.githubStarPrompt).toStrictEqual({ sentPrompts: 5, dismissed: true });
    pane.unmount();
    await state.loadSnapshot();
    const restored = mount(ConversationPane, { props, global });
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
      updateSettings: vi.fn().mockRejectedValueOnce(new Error('Temporary disk failure'))
        .mockImplementation(async input => { updateSettingsInSnapshot(snapshot, input); return structuredClone(snapshot); }),
    } });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const state = useAppState();
    await state.loadSnapshot();
    const global = { provide: { [generalPreferencesKey as symbol]: createGeneralPreferences(() => state.snapshot.value.general, general => state.updateSettings({ general })) } };
    const props = {
      controller: createCodexConversationPaneController({ state: { identity: { conversationKey: 'star', messages: [] } }, actions: {} }),
      agent: snapshot.agents[0]!,
    };
    const pane = mount(ConversationPane, { props, global });
    expect(pane.find('.github-star-prompt').exists()).toBe(false);
    await state.sendPrompt('Fifth prompt after restarting');
    await flushPromises();
    await pane.get('.github-star-prompt button').trigger('click');
    await flushPromises();
    expect(localStorage.getItem('app:githubStarPrompt:v1')).toBeNull();
    expect(snapshot.general.githubStarPrompt).toStrictEqual({ sentPrompts: 5, dismissed: true });
    expect(product.repositoryUrl).toBe('https://github.com/Korus-Dev/korus');
    expect(open).toHaveBeenCalledWith(product.repositoryUrl, '_blank', 'noopener,noreferrer');
    expect(pane.find('.github-star-prompt').exists()).toBe(false);
    pane.unmount();
    expect(mount(ConversationPane, { props, global }).find('.github-star-prompt').exists()).toBe(false);
    open.mockRestore();
  });
});
