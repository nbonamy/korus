import { mount, flushPromises } from '@vue/test-utils';
import { computed } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import AgentHandoffDialog from '../AgentHandoffDialog.vue';
import { providerChoicesKey } from '../provider-selection';

const agent: Agent = { id: 'source', name: 'Worker', folder: '/repo', provider: 'codex', providerSession: { kind: 'codex', conversationId: 'one' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' };

describe('AgentHandoffDialog', () => {
  it('hands off with the shared picker model, effort, tier and optional instructions', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(AgentHandoffDialog, { attachTo: document.body,
      props: { agent, submit, pendingOperationId: 'persisted-operation', listModels: vi.fn().mockResolvedValue([{
        id: 'sonnet', model: 'sonnet', displayName: 'Sonnet',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'high', description: '' }],
        serviceTiers: [{ id: 'fast', name: 'Fast', description: '' }],
      }]) },
      global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude']) } },
    });
    await flushPromises();
    const choose = async (label: string) => {
      await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
      await flushPromises();
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent?.trim() === label);
      expect(item).toBeDefined();
      item!.click();
      await flushPromises();
    };
    await choose('high');
    await wrapper.get('[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    document.querySelector<HTMLButtonElement>('button[aria-label="Service tier: Standard"]')!.click();
    await flushPromises();
    expect(wrapper.get('[aria-label="Coding agent and model"]').text()).toMatch(/Sonnet.*high.*fast/);
    await wrapper.get('textarea').setValue('Explain the flaky test.');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submit).toHaveBeenCalledWith('source', expect.objectContaining({ operationId: 'persisted-operation', instructions: 'Explain the flaky test.', selection: { provider: 'claude', model: 'sonnet', reasoningEffort: 'high', serviceTier: 'fast' } }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('explains blockers and does not start a handoff', async () => {
    const submit = vi.fn();
    const wrapper = mount(AgentHandoffDialog, { attachTo: document.body, props: { agent, submit, blocker: 'Resolve pending requests before handing off.', listModels: async () => [] } });
    expect(wrapper.text()).toContain('Resolve pending requests');
    expect(wrapper.get('button[type="submit"]').attributes()).toHaveProperty('disabled');
    await wrapper.get('form').trigger('submit');
    expect(submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the handoff progress instead of the form, without blaming its own handoff for blocking itself', async () => {
    let fail!: (error: Error) => void;
    const submit = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const wrapper = mount(AgentHandoffDialog, { attachTo: document.body,
      props: { agent, submit, blocker: null, listModels: async () => [] },
      global: { provide: { [providerChoicesKey as symbol]: computed(() => ['codex', 'claude']) } },
    });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await wrapper.setProps({
      blocker: 'Wait for the agent to finish before handing it off.',
      agent: { ...agent, status: { type: 'working' }, handoff: { operationId: 'op', selection: {} as never, sourceAgentId: 'source', sourceTitle: 'Worker', sourceRef: {} as never, phase: 'closing' } },
    });

    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('Closing the source conversation');
    expect(wrapper.text()).toContain('Run in background');

    fail(new Error('Handoff note timed out. The source has been kept.'));
    await wrapper.setProps({ blocker: null, agent });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('timed out');
    expect(wrapper.find('form').exists()).toBe(true);
    wrapper.unmount();
  });
});
