import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceTextarea from '../VoiceTextarea.vue';

const sdk = vi.hoisted(() => ({
  available: true,
  onTranscript: null as null | ((value: string) => void),
  recording: null as null | { value: boolean },
  transcribing: null as null | { value: boolean },
  starting: null as null | { value: boolean },
  transcript: null as null | { value: { finalText: string; partialText: string } },
  stop: vi.fn(),
  cancel: vi.fn(),
  toggle: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@codex-app-sdk/vue', async (importOriginal) => {
  const vue = await import('vue');
  const actual = await importOriginal<typeof import('@codex-app-sdk/vue')>();
  return {
    CodexComposerVoiceButton: defineComponent({
      name: 'CodexComposerVoiceButton',
      emits: ['toggle'],
      setup(_props, { emit }) {
        return () => h('button', { class: 'voice-button', onClick: () => emit('toggle') }, 'Mic');
      },
    }),
    CodexComposerVoiceField: actual.CodexComposerVoiceField,
    getCodexNativeRendererApi: () => sdk.available ? { capabilities: { transcription: true } } : undefined,
    useCodexComposerVoice: (options: { onTranscript: (value: string) => void }) => {
      sdk.onTranscript = options.onTranscript;
      sdk.recording = vue.ref(false);
      sdk.transcribing = vue.ref(false);
      sdk.starting = vue.ref(false);
      sdk.transcript = vue.ref({ finalText: '', partialText: '' });
      return {
        buttonDisabled: vue.ref(false),
        buttonLabel: vue.ref('Record voice prompt'),
        buttonTitle: vue.ref('Record voice prompt'),
        isRecording: sdk.recording,
        isTranscribing: sdk.transcribing,
        isStarting: sdk.starting,
        isLive: vue.ref(true),
        transcript: sdk.transcript,
        stop: sdk.stop,
        cancel: sdk.cancel,
        toggle: sdk.toggle,
        dispose: sdk.dispose,
      };
    },
  };
});

describe('VoiceTextarea', () => {
  beforeEach(() => {
    sdk.available = true;
    sdk.toggle.mockReset();
    sdk.dispose.mockReset();
    sdk.stop.mockReset();
    sdk.cancel.mockReset();
  });

  it('emits typed text and exposes the microphone when transcription is available', async () => {
    const wrapper = mountControlled();

    await wrapper.get('textarea').setValue('Pick security issues');
    await wrapper.get('.voice-button').trigger('click');

    expect(wrapper.getComponent(VoiceTextarea).emitted('update:modelValue')?.at(-1)).toStrictEqual(['Pick security issues']);
    expect(sdk.toggle).toHaveBeenCalledOnce();
  });

  it('inserts a transcript at the saved caret', async () => {
    const wrapper = mountControlled('Pick issues');
    const textarea = wrapper.get('textarea').element as HTMLTextAreaElement;
    textarea.setSelectionRange(4, 4);
    await wrapper.get('textarea').trigger('select');

    sdk.onTranscript?.('urgent');
    await nextTick();

    expect(wrapper.get('textarea').element.value).toBe('Pick urgent issues');
  });

  it('keeps its height while recording and reports the busy state', async () => {
    const wrapper = mountControlled('', 6);
    const initialHeight = wrapper.get('.voice-textarea').attributes('style');

    sdk.recording!.value = true;
    await nextTick();

    expect(wrapper.find('.chat-composer__audio-field').exists()).toBe(true);
    expect(wrapper.get('.voice-textarea').attributes('style')).toBe(initialHeight);
    expect(wrapper.getComponent(VoiceTextarea).emitted('busy-change')).toStrictEqual([[true]]);
  });

  it('hides voice controls when transcription is unavailable', () => {
    sdk.available = false;
    const wrapper = mountControlled();

    expect(wrapper.find('.voice-button').exists()).toBe(false);
    expect(wrapper.find('textarea').exists()).toBe(true);
  });

  it('shows live corrections at the caret without committing them and wires stop and cancel', async () => {
    const wrapper = mountControlled('Pick issues');
    wrapper.get<HTMLTextAreaElement>('textarea').element.setSelectionRange(4, 4);
    await wrapper.get('textarea').trigger('select');
    sdk.starting!.value = true;
    await nextTick();
    expect(wrapper.get('.chat-composer__audio-text').text().replace(/\s+/gu, ' ')).toBe('Pick issues');
    expect(wrapper.find('.voice-button').exists()).toBe(true);
    sdk.starting!.value = false;
    sdk.recording!.value = true;
    sdk.transcript!.value = { finalText: '', partialText: 'urgent' };
    await nextTick();
    expect(wrapper.get('.chat-composer__audio-text').text()).toBe('Pick urgent issues');
    sdk.transcript!.value = { finalText: 'security', partialText: '' };
    await nextTick();
    expect(wrapper.get('.chat-composer__audio-text').text()).toBe('Pick security issues');
    expect(wrapper.getComponent(VoiceTextarea).emitted('update:modelValue')).toBeUndefined();
    await wrapper.get('.voice-button').trigger('click');
    expect(sdk.toggle).toHaveBeenCalledOnce();
    await wrapper.get('.voice-textarea').trigger('keydown', { key: 'Escape' });
    expect(sdk.cancel).toHaveBeenCalledOnce();
    sdk.recording!.value = false;
    await nextTick();
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('Pick issues');
    wrapper.unmount();
  });
});

function mountControlled(initialValue = '', rows = 5) {
  return mount(defineComponent({
    components: { VoiceTextarea },
    setup() {
      const value = ref(initialValue);
      return { rows, value };
    },
    template: '<VoiceTextarea v-model="value" label="Instructions" :rows="rows" />',
  }));
}
