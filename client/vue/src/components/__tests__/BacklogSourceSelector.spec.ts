import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import { ElOption, ElSelect } from 'element-plus';
import 'element-plus/theme-chalk/el-select.css';
import type { WorkIntegrationConnection, WorkProviderKind } from '@workspace/core/contracts';
import BacklogSourceSelector from '../BacklogSourceSelector.vue';
import { useBacklogProviders } from '../backlog-providers';

describe('BacklogSourceSelector', () => {
  it('renders smaller text and lets a standalone provider fill its container', async () => {
    const wrapper = mount(BacklogSourceSelector, {
      props: { provider: 'github', providers: ['github', 'linear'], size: 'small' },
      global: { components: { ElSelect, ElOption } },
    });
    const controls = wrapper.findAll('.el-select__wrapper');
    expect(controls).toHaveLength(2);
    for (const control of controls) expect(getComputedStyle(control.element).fontSize).toBe('12px');
    await wrapper.setProps({ fullWidth: true, showSource: false });
    expect(getComputedStyle(wrapper.get('.backlog-source-selector__provider').element).flexGrow).toBe('1');
  });

  it('shows the provider icon on the selected value', () => {
    const wrapper = mount(BacklogSourceSelector, {
      props: { provider: 'linear', providers: ['github', 'linear'], showSource: false },
      global: { components: { ElSelect, ElOption } },
    });
    expect(wrapper.find('.backlog-source-selector__provider .el-select__prefix .linear-icon').exists()).toBe(true);
  });

  it('offers connected providers only, hides a redundant choice, and falls back after disconnect', async () => {
    const connections = reactive<WorkIntegrationConnection[]>([
      { provider: 'github', status: 'connected' },
      { provider: 'linear', status: 'disconnected' },
    ]);
    const Harness = defineComponent({ setup() {
      const { providers, provider } = useBacklogProviders(() => connections, 'linear');
      return () => h('div', [
        h('output', provider.value),
        h(BacklogSourceSelector, { provider: provider.value, providers: providers.value, showSource: false, onSelectProvider: (value: WorkProviderKind) => { provider.value = value; } }),
      ]);
    } });
    const wrapper = mount(Harness);
    expect(wrapper.get('output').text()).toBe('github');
    expect(wrapper.find('[aria-label="Backlog provider"]').exists()).toBe(false);
    connections[1]!.status = 'connected';
    await flushPromises();
    expect(wrapper.findAll('option').map(option => option.element.value)).toEqual(['github', 'linear']);
    await wrapper.get('select').setValue('github');
    expect(wrapper.get('output').text()).toBe('github');
    connections[0]!.status = 'error';
    await flushPromises();
    expect(wrapper.get('output').text()).toBe('linear');
    expect(wrapper.find('select').exists()).toBe(false);
    connections[1]!.status = 'connecting';
    await flushPromises();
    expect(wrapper.find('select').exists()).toBe(false);
  });
});
