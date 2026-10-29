import { mount } from '@vue/test-utils';
import { defineComponent, h, reactive, ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import type { AgentBackend } from '@workspace/core/contracts';
import BackendSelector from '../BackendSelector.vue';
import { provideBackendChoices } from '../backend-selection';

afterEach(() => localStorage.removeItem('app:preferredEngines'));

describe('host-scoped manual engine selection', () => {
  it.each(['claude', 'antigravity'] as const)('remembers explicit %s choices per host, but not temporary availability fallback', async backend => {
    const snapshot = reactive(createEmptySnapshot());
    snapshot.providerConnections = (['codex', backend] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    snapshot.remoteConnections.connections = [{ id: 'remote', kind: 'ssh', host: 'box', name: 'Box', status: 'ready', createdAt: '', updatedAt: '', providerConnections: structuredClone(snapshot.providerConnections.map(engine => ({ ...engine }))) }];
    const host = ref<string>();
    const model = ref<AgentBackend>();
    const wrapper = mount(defineComponent({
      setup() {
        provideBackendChoices(() => snapshot);
        return () => h(BackendSelector, { remoteConnectionId: host.value, modelValue: model.value, 'onUpdate:modelValue': value => { model.value = value; } });
      },
    }));
    await wrapper.get('select').setValue(backend);
    expect(model.value).toBe(backend);
    host.value = 'remote';
    await wrapper.vm.$nextTick();
    expect(model.value).toBe('codex');
    host.value = undefined;
    await wrapper.vm.$nextTick();
    expect(model.value).toBe(backend);
    snapshot.providerConnections[1]!.connected = false;
    await wrapper.vm.$nextTick();
    expect(model.value).toBe('codex');
    expect(JSON.parse(localStorage.getItem('app:preferredEngines')!)).toEqual({ local: backend });
    snapshot.providerConnections[1]!.connected = true;
    wrapper.unmount();
    model.value = undefined;
    const reloaded = mount(defineComponent({ setup() {
      provideBackendChoices(() => snapshot);
      return () => h(BackendSelector, { modelValue: model.value, 'onUpdate:modelValue': value => { model.value = value; } });
    } }));
    await reloaded.vm.$nextTick();
    expect(model.value).toBe(backend);
  });
});
