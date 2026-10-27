import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGeneralSettings } from '@workspace/core/settings';
import { setElectronTestClient } from '../../test/client';
import SettingsVoicePanel from '../SettingsVoicePanel.vue';

describe('SettingsVoicePanel', () => {
  beforeEach(() => { setElectronTestClient({}); });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps every option hidden until spoken acknowledgments are switched on', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({ updateSettings });
    await flushPromises();

    expect(wrapper.get('h2').text()).toBe('Voice');
    expect(wrapper.text()).toContain('Let agents talk to you');
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Choose which agents may speak');

    await wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', true);
    expect(updateSettings).toHaveBeenCalledWith({ general: { spokenAnnouncementsEnabled: true } });
  });

  it('chooses a voice from tiles and updates the speaking rules', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({ updateSettings, settings: { ...defaultGeneralSettings, spokenAnnouncementsEnabled: true } });
    await flushPromises();

    const voices = wrapper.findAll('[role="radio"]');
    expect(voices.map(voice => voice.text())).toStrictEqual([
      'HeartAmerican', 'BellaAmerican', 'NicoleAmerican', 'SarahAmerican',
      'AdamAmerican', 'MichaelAmerican', 'EmmaBritish', 'GeorgeBritish',
    ]);
    expect(voices.find(voice => voice.attributes('aria-checked') === 'true')!.text()).toBe('HeartAmerican');
    await voices[6]!.trigger('click');
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { spokenAnnouncementVoice: 'bf_emma' } });

    const rows = wrapper.findAllComponents({ name: 'FormRow' });
    const scope = rows.find(row => row.text().includes('Choose which agents may speak'))!.findComponent({ name: 'ElSelect' });
    expect(scope.props('modelValue')).toBe('selected');
    await scope.vm.$emit('update:modelValue', 'all');
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { spokenAnnouncementScope: 'all' } });

    const dictated = rows.find(row => row.text().includes('Dictated prompts only'))!.findComponent({ name: 'ElSwitch' });
    expect(dictated.props('modelValue')).toBe(true);
    await dictated.vm.$emit('update:modelValue', false);
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { spokenAnnouncementsOnlyForDictatedPrompts: false } });

    const focused = rows.find(row => row.text().includes(`Only speak while ${product.name} is focused`))!.findComponent({ name: 'ElSwitch' });
    expect(focused.props('modelValue')).toBe(true);
    await focused.vm.$emit('update:modelValue', false);
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { spokenAnnouncementsOnlyWhenFocused: false } });
  });

  it('previews any voice without selecting it', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const previewSpokenAnnouncementVoice = vi.fn().mockResolvedValue({ queued: true });
    setElectronTestClient({ previewSpokenAnnouncementVoice });
    const wrapper = mountPanel({ updateSettings, settings: { ...defaultGeneralSettings, spokenAnnouncementsEnabled: true } });
    await flushPromises();

    await wrapper.get('[aria-label="Preview Emma"]').trigger('click');
    await flushPromises();

    expect(previewSpokenAnnouncementVoice).toHaveBeenCalledWith('bf_emma');
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('shows when native voice preview is unavailable', async () => {
    setElectronTestClient({
      previewSpokenAnnouncementVoice: vi.fn().mockResolvedValue({ queued: false, reason: 'unsupported' }),
    });
    const wrapper = mountPanel({ settings: { ...defaultGeneralSettings, spokenAnnouncementsEnabled: true } });
    await flushPromises();

    await wrapper.get('[aria-label="Preview Heart"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Voice preview could not be queued on this device.');
  });

  it('locks every preview and spins only the played voice until it finishes', async () => {
    let finishPreview: (result: { queued: boolean }) => void = () => {};
    const previewSpokenAnnouncementVoice = vi.fn().mockImplementation(() => (
      new Promise<{ queued: boolean }>((resolve) => { finishPreview = resolve; })
    ));
    setElectronTestClient({ previewSpokenAnnouncementVoice });
    const wrapper = mountPanel({ settings: { ...defaultGeneralSettings, spokenAnnouncementsEnabled: true } });
    await flushPromises();
    const previews = wrapper.findAll('button[aria-label^="Preview "]');

    await previews[2]!.trigger('click');
    expect(previews.every(button => button.attributes('disabled') !== undefined)).toBe(true);
    expect(previews.filter(button => button.attributes('aria-busy') === 'true')).toHaveLength(1);
    expect(previews[2]!.attributes('aria-busy')).toBe('true');
    expect(previews[2]!.find('.app-spinner').exists()).toBe(true);
    expect(wrapper.findAll('.app-spinner')).toHaveLength(1);

    finishPreview({ queued: true });
    await flushPromises();
    expect(previews.every(button => button.attributes('disabled') === undefined)).toBe(true);
    expect(wrapper.find('.app-spinner').exists()).toBe(false);
  });
});

function mountPanel(props: Record<string, unknown>) {
  return mount(SettingsVoicePanel, {
    props: {
      settings: defaultGeneralSettings,
      ...props,
    },
  });
}
