import { flushPromises, mount } from '@vue/test-utils';
import { computed, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const voiceMock = vi.hoisted(() => ({
  isRecording: null as { value: boolean } | null,
  isTranscribing: null as { value: boolean } | null,
  isStarting: null as { value: boolean } | null,
  transcript: null as { value: { finalText: string; partialText: string } } | null,
  cancel: vi.fn(),
  onTranscript: null as ((text: string) => void) | null,
  stop: vi.fn<() => Promise<boolean>>(),
  toggle: vi.fn<() => Promise<void>>(),
}));

vi.mock('@codex-app-sdk/vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex-app-sdk/vue')>();
  const isRecording = ref(false);
  const isTranscribing = ref(false);
  const isStarting = ref(false);
  const transcript = ref({ finalText: '', partialText: '' });
  voiceMock.isStarting = isStarting;
  voiceMock.transcript = transcript;
  voiceMock.isRecording = isRecording;
  voiceMock.isTranscribing = isTranscribing;
  voiceMock.toggle.mockImplementation(async () => {
    isRecording.value = !isRecording.value;
  });
  return {
    ...actual,
    getCodexNativeRendererApi: () => ({ capabilities: { transcription: true } }),
    useCodexComposerVoice: (options: { onTranscript(text: string): void }) => {
      voiceMock.onTranscript = options.onTranscript;
      return {
        buttonDisabled: computed(() => isTranscribing.value),
        buttonLabel: computed(() => isRecording.value ? 'Stop recording' : 'Record voice prompt'),
        buttonTitle: computed(() => isTranscribing.value ? 'Transcribing...' : 'Record voice prompt'),
        error: ref(null),
        isRecording,
        isTranscribing,
        isStarting,
        isLive: ref(true),
        transcript,
        cancel: voiceMock.cancel,
        stop: voiceMock.stop,
        toggle: voiceMock.toggle,
        dispose: vi.fn(),
      };
    },
  };
});

import AnnotationPopup from '../AnnotationPopup.vue';

beforeEach(() => {
  if (voiceMock.isRecording) voiceMock.isRecording.value = false;
  if (voiceMock.isTranscribing) voiceMock.isTranscribing.value = false;
  voiceMock.isStarting!.value = false;
  voiceMock.transcript!.value = { finalText: '', partialText: '' };
  voiceMock.cancel.mockReset();
  voiceMock.onTranscript = null;
  voiceMock.toggle.mockReset();
  voiceMock.toggle.mockImplementation(async () => {
    voiceMock.isRecording!.value = !voiceMock.isRecording!.value;
  });
  voiceMock.stop.mockReset();
  voiceMock.stop.mockImplementation(async () => {
    if (!voiceMock.isRecording!.value) return false;
    voiceMock.isRecording!.value = false;
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AnnotationPopup', () => {
  it('positions itself from its host-provided anchor and returns trimmed input', async () => {
    const wrapper = mount(AnnotationPopup, {
      props: {
        anchor: { x: 48, y: 80, width: 120, height: 32 },
        description: 'Google Search',
      },
    });

    expect(wrapper.get('form').attributes('style')).toContain('left: 48px');
    expect(wrapper.get('form').attributes('style')).toContain('top: 120px');
    expect(wrapper.get('form').attributes('aria-description')).toBe('Google Search');

    await wrapper.get('input').setValue('  Make this clearer.  ');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('submit')).toStrictEqual([['Make this clearer.']]);
  });

  it('accepts an empty comment only when the host marks the comment optional', async () => {
    const popup = (optional?: boolean) => mount(AnnotationPopup, { props: { anchor: { x: 0, y: 0, width: 0, height: 0 }, ...(optional ? { optional } : {}) } });
    const required = popup();
    expect(required.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    const optionalPopup = popup(true);
    expect(optionalPopup.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    await optionalPopup.get('form').trigger('submit');
    expect(optionalPopup.emitted('submit')).toStrictEqual([['']]);
  });

  it('keeps empty input open and emits cancel on Escape', async () => {
    const wrapper = mount(AnnotationPopup, {
      props: { anchor: { x: 0, y: 0, width: 0, height: 0 } },
    });

    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();

    await wrapper.get('form').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
  });

  it('emits the current comment through the optional Command-Enter action', async () => {
    const wrapper = mount(AnnotationPopup, {
      props: {
        anchor: { x: 0, y: 0, width: 0, height: 0 },
        commandEnterSubmit: true,
      },
    });
    await wrapper.get('input').setValue('Send the whole batch.');
    const shortcut = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    wrapper.get('input').element.dispatchEvent(shortcut);
    await nextTick();

    expect(shortcut.defaultPrevented).toBe(true);
    expect(wrapper.emitted('command-submit')).toStrictEqual([['Send the whole batch.']]);
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('supports host-provided full-width placement above an anchor', () => {
    const wrapper = mount(AnnotationPopup, {
      props: {
        anchor: { x: 12, y: 400, width: 0, height: 0 },
        placement: 'above',
        width: 480,
      },
    });

    const style = wrapper.get('form').attributes('style');
    expect(style).toContain('left: 12px');
    expect(style).toContain('top: 392px');
    expect(style).toContain('width: 480px');
    expect(style).toContain('transform: translateY(-100%)');
  });

  it('can escape host clipping with viewport positioning', () => {
    const wrapper = mount(AnnotationPopup, {
      attachTo: document.body,
      props: {
        anchor: { x: 640, y: 420, width: 0, height: 0 },
        label: 'Fixed annotation',
        strategy: 'fixed',
      },
    });

    const popup = document.body.querySelector<HTMLFormElement>('[aria-label="Fixed annotation"]');
    expect(popup?.style.position).toBe('fixed');
    expect(popup?.style.left).toBe('640px');
    expect(popup?.style.zIndex).toBe('3000');
    wrapper.unmount();
  });

  it('records voice with the SDK controls and inserts the transcript at the saved selection', async () => {
    const wrapper = mount(AnnotationPopup, {
      props: { anchor: { x: 0, y: 0, width: 0, height: 0 } },
    });
    const input = wrapper.get<HTMLInputElement>('.annotation-popup__input');
    await input.setValue('Before after');
    input.element.setSelectionRange(6, 6);
    await input.trigger('select');

    const microphone = wrapper.get('[aria-label="Record voice prompt"]');
    const submit = wrapper.get('.annotation-popup__submit');
    expect(microphone.element.compareDocumentPosition(submit.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await microphone.trigger('click');
    await nextTick();
    expect(wrapper.find('.chat-composer__audio-field').exists()).toBe(true);
    expect(wrapper.get('.annotation-popup__submit').attributes('disabled')).toBeUndefined();

    voiceMock.isRecording!.value = false;
    voiceMock.isTranscribing!.value = true;
    await nextTick();
    expect(wrapper.get('.chat-composer__audio-text').text().replace(/\s+/gu, ' ')).toBe('Before after');

    voiceMock.isTranscribing!.value = false;
    await nextTick();
    voiceMock.onTranscript?.('spoken');
    await nextTick();

    expect(wrapper.get<HTMLInputElement>('.annotation-popup__input').element.value).toBe('Before spoken after');
  });

  it('transcribes into the draft without sending when recording is stopped', async () => {
    const wrapper = mount(AnnotationPopup, {
      props: { anchor: { x: 0, y: 0, width: 0, height: 0 } },
    });

    await wrapper.get('[aria-label="Record voice prompt"]').trigger('click');
    voiceMock.stop.mockImplementation(async () => {
      voiceMock.isRecording!.value = false;
      voiceMock.onTranscript?.('spoken note');
      return true;
    });
    voiceMock.toggle.mockImplementation(async () => { await voiceMock.stop(); });
    await wrapper.get('[aria-label="Stop recording"]').trigger('click');
    await flushPromises();

    expect(wrapper.get<HTMLInputElement>('.annotation-popup__input').element.value).toBe('spoken note');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('keeps Send enabled while recording and submits only after transcription completes', async () => {
    let finishTranscription!: () => void;
    const transcription = new Promise<void>((resolve) => {
      finishTranscription = resolve;
    });
    voiceMock.stop.mockImplementation(async () => {
      voiceMock.isRecording!.value = false;
      voiceMock.isTranscribing!.value = true;
      await transcription;
      voiceMock.onTranscript?.('send this');
      voiceMock.isTranscribing!.value = false;
      return true;
    });
    const wrapper = mount(AnnotationPopup, {
      props: { anchor: { x: 0, y: 0, width: 0, height: 0 } },
    });

    await wrapper.get('[aria-label="Record voice prompt"]').trigger('click');
    expect(wrapper.get('.annotation-popup__submit').attributes('disabled')).toBeUndefined();

    await wrapper.get('form').trigger('submit');
    await nextTick();
    expect(wrapper.get('.annotation-popup__submit').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('submit')).toBeUndefined();

    finishTranscription();
    await flushPromises();

    expect(wrapper.emitted('submit')).toStrictEqual([['send this']]);
  });

  it('emits cancel when the user clicks outside the popup', async () => {
    const host = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(host, outside);
    const wrapper = mount(AnnotationPopup, {
      attachTo: host,
      props: { anchor: { x: 0, y: 0, width: 0, height: 0 } },
    });

    await wrapper.get('input').trigger('pointerdown');
    expect(wrapper.emitted('cancel')).toBeUndefined();

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper.emitted('cancel')).toStrictEqual([[]]);

    wrapper.unmount();
    host.remove();
    outside.remove();
  });

  it('shows live text beside the saved draft, blocks startup submission, and cancels only dictation', async () => {
    const wrapper = mount(AnnotationPopup, { props: { anchor: { x: 0, y: 0, width: 0, height: 0 }, initialValue: 'Keep this' } });
    voiceMock.isStarting!.value = true;
    await nextTick();
    expect(wrapper.get('.chat-composer__audio-text').text()).toBe('Keep this');
    expect(wrapper.get('.annotation-popup__submit').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toBeUndefined();
    voiceMock.isStarting!.value = false;
    voiceMock.isRecording!.value = true;
    voiceMock.transcript!.value = { finalText: 'and ', partialText: 'that' };
    await nextTick();
    expect(wrapper.get('.chat-composer__audio-text').text()).toBe('Keep this and that');
    expect(wrapper.get('[aria-label="Stop recording"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('form').trigger('keydown', { key: 'Escape' });
    expect(voiceMock.cancel).toHaveBeenCalledOnce();
    expect(wrapper.emitted('cancel')).toBeUndefined();
    voiceMock.isRecording!.value = false;
    await nextTick();
    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Keep this');
    wrapper.unmount();
  });
});
