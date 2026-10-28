import { mount, flushPromises } from '@vue/test-utils';
import { computed } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import AgentHandoffDialog from '../AgentHandoffDialog.vue';
import { backendChoicesKey } from '../backend-selection';

const agent: Agent = { id: 'source', name: 'Worker', folder: '/repo', backend: 'codex', backendSession: { kind: 'codex', threadId: 'one' }, status: { type: 'idle' }, createdAt: '', updatedAt: '' };

describe('AgentHandoffDialog', () => {
  it('sends optional instructions to the handoff operation and closes only after success', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(AgentHandoffDialog, {
      props: { agent, submit, listModels: vi.fn().mockResolvedValue([]) },
      global: { provide: { [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']) } },
    });
    await flushPromises();
    await wrapper.get('textarea').setValue('Explain the flaky test.');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(submit).toHaveBeenCalledWith('source', expect.objectContaining({ operationId: expect.any(String), instructions: 'Explain the flaky test.', selection: { backend: 'claude', model: null, reasoningEffort: null, serviceTier: null } }));
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('explains blockers and does not start a handoff', async () => {
    const submit = vi.fn();
    const wrapper = mount(AgentHandoffDialog, { props: { agent, submit, blocker: 'Resolve pending requests before handing off.', listModels: async () => [] } });
    expect(wrapper.text()).toContain('Resolve pending requests');
    expect(wrapper.get('button[type="submit"]').attributes()).toHaveProperty('disabled');
    await wrapper.get('form').trigger('submit');
    expect(submit).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
