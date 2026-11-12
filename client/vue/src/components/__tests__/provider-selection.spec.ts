import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, provide, reactive, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySnapshot } from '@workspace/core/snapshot';
import type { HarnessProvider } from '@workspace/core/contracts';
import ProviderSelector from '../ProviderSelector.vue';
import { provideProviderChoices } from '../provider-selection';
import { createGeneralPreferences, generalPreferencesKey } from '../../general-preferences';
import { updateSettingsInSnapshot } from '@workspace/core/settings';
import { deferred } from '../../../tests/support/app-state-test-harness';

afterEach(() => localStorage.removeItem('app:preferredEngines'));

describe('host-scoped manual engine selection', () => {
  it('preserves both host choices when a second selection is made while the first save is pending', async () => {
    const snapshot = reactive(createEmptySnapshot());
    snapshot.providerConnections = (['codex', 'claude', 'antigravity'] as const).map(provider => ({ provider: provider, installed: true, connected: true, checking: false }));
    snapshot.remoteConnections.connections = [{ id: 'remote', kind: 'ssh', host: 'box', name: 'Box', status: 'ready', createdAt: '', updatedAt: '', providerConnections: snapshot.providerConnections }];
    const firstSave = deferred<void>();
    const save = vi.fn(async general => {
      await firstSave.promise;
      updateSettingsInSnapshot(snapshot, { general });
    });
    const preferences = createGeneralPreferences(() => snapshot.general, save);
    const wrapper = mount(defineComponent({ setup() {
      provide(generalPreferencesKey, preferences);
      provideProviderChoices(() => snapshot);
      return () => h('div', [h(ProviderSelector), h(ProviderSelector, { remoteConnectionId: 'remote' })]);
    } }));
    await wrapper.findAll('select')[0]!.setValue('claude');
    await flushPromises();
    await wrapper.findAll('select')[1]!.setValue('antigravity');
    await flushPromises();
    expect(save).toHaveBeenCalledOnce();
    firstSave.resolve();
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(snapshot.general.preferredProviders).toStrictEqual({ local: 'claude', remote: 'antigravity' });
    expect(localStorage.getItem('app:preferredEngines')).toBeNull();
  });

  it.each(['claude', 'antigravity'] as const)('remembers explicit %s choices per host, but not temporary availability fallback', async backend => {
    const snapshot = reactive(createEmptySnapshot());
    snapshot.providerConnections = (['codex', backend] as const).map(provider => ({ provider: provider, installed: true, connected: true, checking: false }));
    snapshot.remoteConnections.connections = [{ id: 'remote', kind: 'ssh', host: 'box', name: 'Box', status: 'ready', createdAt: '', updatedAt: '', providerConnections: structuredClone(snapshot.providerConnections.map(engine => ({ ...engine }))) }];
    const save = vi.fn(async general => { updateSettingsInSnapshot(snapshot, { general }); });
    const preferences = createGeneralPreferences(() => snapshot.general, save);
    const host = ref<string>();
    const model = ref<HarnessProvider>();
    const wrapper = mount(defineComponent({
      setup() {
        provide(generalPreferencesKey, preferences);
        provideProviderChoices(() => snapshot);
        return () => h(ProviderSelector, { remoteConnectionId: host.value, modelValue: model.value, 'onUpdate:modelValue': value => { model.value = value; } });
      },
    }));
    await wrapper.get('select').setValue(backend);
    await flushPromises();
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
    expect(snapshot.general.preferredProviders).toStrictEqual({ local: backend });
    expect(localStorage.getItem('app:preferredEngines')).toBeNull();
    expect(save).toHaveBeenCalledOnce();
    snapshot.providerConnections[1]!.connected = true;
    wrapper.unmount();
    model.value = undefined;
    const reloaded = mount(defineComponent({ setup() {
      provide(generalPreferencesKey, preferences);
      provideProviderChoices(() => snapshot);
      return () => h(ProviderSelector, { modelValue: model.value, 'onUpdate:modelValue': value => { model.value = value; } });
    } }));
    await reloaded.vm.$nextTick();
    expect(model.value).toBe(backend);
  });
});
