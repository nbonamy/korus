import { mount } from '@vue/test-utils';
import { ElSelect } from 'element-plus';
import { describe, expect, it } from 'vitest';
import type { RemoteConnection } from '@workspace/core/contracts';
import RepositorySessionSourceDialog from '../RepositorySessionSourceDialog.vue';

const host: RemoteConnection = { id: 'devbox', kind: 'ssh', name: 'devbox', host: 'devbox', status: 'ready', createdAt: '', updatedAt: '' };
const mountDialog = (props: Record<string, unknown> = {}) => mount(RepositorySessionSourceDialog, {
  props: { visible: true, repositoryName: 'korus', branches: [], ...props },
  global: { stubs: { teleport: true } },
  attachTo: document.body,
});

describe('RepositorySessionSourceDialog host footer', () => {
  it('has no footer without remote machines', () => {
    const wrapper = mountDialog();
    expect(wrapper.findComponent(ElSelect).exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows This computer by default instead of an empty placeholder', () => {
    const wrapper = mountDialog({ hosts: [host], hostCheckout: { state: 'cloned', path: '/x' } });
    expect(wrapper.findComponent(ElSelect).props('modelValue')).toBe('local');
    expect(wrapper.find('.repository-session-source-dialog__host').attributes('size')).toBe('small');
    expect(wrapper.text()).toContain('This computer');
    wrapper.unmount();
  });

  it('offers this computer and each machine, and says what a missing checkout will do', async () => {
    const wrapper = mountDialog({ hosts: [host], hostId: 'devbox', hostCheckout: { state: 'missing' } });
    expect(wrapper.findComponent(ElSelect).exists()).toBe(true);
    expect(wrapper.text()).toContain('Will be cloned from its origin first');
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'local');
    expect(wrapper.emitted('change-host')).toStrictEqual([[undefined]]);
    await wrapper.setProps({ hostCheckout: { state: 'cloned', path: '/x' } });
    expect(wrapper.text()).not.toContain('Will be cloned');
    wrapper.unmount();
  });
});
