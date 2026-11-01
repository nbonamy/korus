<template>
  <Teleport to="body" :disabled="strategy !== 'fixed'">
    <form
      ref="popup"
      class="annotation-popup"
      :aria-label="label"
      :aria-description="description"
      :style="positionStyle"
      @keydown.esc.stop.prevent="cancelDictationOrPopup"
      @keydown.meta.enter="submitWithCommandEnter"
      @submit.prevent="submit()"
    >
    <CodexComposerVoiceField
      v-if="voiceVisible && voiceBusy"
      class="annotation-popup__voice-field"
      :recording="voiceRecording"
      :starting="voiceStarting"
      :transcript="voiceTranscript"
      :before="voiceBefore"
      :after="voiceAfter"
    />
    <input
      v-else
      ref="input"
      v-model="draft"
      class="annotation-popup__input"
      :placeholder="placeholder"
      @blur="rememberSelection"
      @click="rememberSelection"
      @input="rememberSelection"
      @keyup="rememberSelection"
      @select="rememberSelection"
    >
    <CodexComposerVoiceButton
      v-if="voiceVisible"
      :disabled="voiceButtonDisabled"
      :label="voiceButtonLabel"
      :recording="voiceRecording"
      :title="voiceButtonTitle"
      @toggle="voiceController.toggle"
    />
    <button
      class="annotation-popup__submit"
      type="submit"
      :aria-label="submitLabel"
      :disabled="submitDisabled"
      :title="submitLabel"
    >
      ↑
    </button>
    </form>
  </Teleport>
</template>

<script setup lang="ts">
import { translate } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  CodexComposerVoiceButton,
  CodexComposerVoiceField,
  getCodexNativeRendererApi,
  useCodexComposerVoice,
} from '@codex-app-sdk/vue';

export type AnnotationPopupAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const props = withDefaults(defineProps<{
  anchor: AnnotationPopupAnchor;
  commandEnterSubmit?: boolean;
  description?: string;
  initialValue?: string;
  label?: string;
  /** The host accepts an empty comment (for example a measurement that speaks for itself). */
  optional?: boolean;
  placement?: 'above' | 'below';
  placeholder?: string;
  strategy?: 'absolute' | 'fixed';
  submitLabel?: string;
  width?: number;
}>(), {
  description: '',
  commandEnterSubmit: false,
  initialValue: '',
  optional: false,
  label: translate('surface.annotationPopup.annotationComment'),
  placement: 'below',
  placeholder: translate('surface.annotationPopup.enterComment'),
  strategy: 'absolute',
  submitLabel: translate('dynamic.misc.sendAnnotation'),
});

const emit = defineEmits<{
  cancel: [];
  'command-submit': [comment: string];
  submit: [comment: string];
}>();

const draft = ref(props.initialValue);
const input = ref<HTMLInputElement | null>(null);
const popup = ref<HTMLFormElement | null>(null);
const selectionStart = ref(draft.value.length);
const selectionEnd = ref(draft.value.length);
const voiceSubmitPending = ref(false);
const voiceVisible = computed(() => getCodexNativeRendererApi()?.capabilities.transcription === true);
const voiceController = useCodexComposerVoice({
  isDisabled: () => false,
  isSending: () => false,
  onTranscript: insertTranscript,
});
// The locally linked SDK can resolve Vue through a separate package boundary.
// Re-wrap its refs so Vue's template type unwrapping sees this app's Ref identity.
const voiceButtonDisabled = computed(() => voiceController.buttonDisabled.value);
const voiceButtonLabel = computed(() => voiceController.buttonLabel.value);
const voiceButtonTitle = computed(() => voiceController.buttonTitle.value);
const voiceRecording = computed(() => voiceController.isRecording.value);
const voiceTranscribing = computed(() => voiceController.isTranscribing.value);
const voiceStarting = computed(() => voiceController.isStarting.value);
const voiceTranscript = computed(() => voiceController.transcript.value);
const voiceBusy = computed(() => voiceStarting.value || voiceRecording.value || voiceTranscribing.value);
const voiceBefore = computed(() => {
  const text = draft.value.slice(0, selectionStart.value);
  return text && !/\s$/u.test(text) ? `${text} ` : text;
});
const voiceAfter = computed(() => {
  const text = draft.value.slice(selectionEnd.value);
  return text && !/^\s/u.test(text) ? ` ${text}` : text;
});
const submitDisabled = computed(() => (
  voiceStarting.value || voiceTranscribing.value
  || voiceSubmitPending.value
  || (!props.optional && !voiceRecording.value && !draft.value.trim())
));
const positionStyle = computed(() => {
  const popupWidth = props.width ?? 320;
  const left = Math.max(12, Math.min(props.anchor.x, window.innerWidth - popupWidth - 12));
  if (props.placement === 'above') {
    return {
      left: `${left}px`,
      position: props.strategy,
      top: `${Math.max(12, Math.min(props.anchor.y - 8, window.innerHeight - 12))}px`,
      transform: 'translateY(-100%)',
      ...(props.strategy === 'fixed' ? { zIndex: 3000 } : {}),
      ...(props.width ? { width: `${props.width}px` } : {}),
    };
  }
  return {
    left: `${left}px`,
    position: props.strategy,
    top: `${Math.max(12, Math.min(props.anchor.y + props.anchor.height + 8, window.innerHeight - 48))}px`,
    ...(props.strategy === 'fixed' ? { zIndex: 3000 } : {}),
    ...(props.width ? { width: `${props.width}px` } : {}),
  };
});

onMounted(() => {
  document.addEventListener('pointerdown', cancelOnOutsidePointerDown, true);
  void nextTick(() => input.value?.focus());
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', cancelOnOutsidePointerDown, true);
  voiceController.dispose();
});

function cancelOnOutsidePointerDown(event: Event): void {
  if (event.target instanceof Node && !popup.value?.contains(event.target)) {
    emit('cancel');
  }
}

async function cancelDictationOrPopup(): Promise<void> {
  if (!voiceBusy.value) {
    emit('cancel');
    return;
  }
  await voiceController.cancel();
  await nextTick();
  input.value?.focus();
}

function rememberSelection(): void {
  selectionStart.value = input.value?.selectionStart ?? draft.value.length;
  selectionEnd.value = input.value?.selectionEnd ?? selectionStart.value;
}

function insertTranscript(value: string): void {
  const transcript = value.trim();
  if (!transcript) return;
  const start = Math.min(selectionStart.value, draft.value.length);
  const end = Math.min(Math.max(selectionEnd.value, start), draft.value.length);
  const before = draft.value.slice(0, start);
  const after = draft.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) ? ' ' : '';
  const insertion = `${prefix}${transcript}${suffix}`;
  const nextCaret = before.length + insertion.length;
  draft.value = `${before}${insertion}${after}`;
  selectionStart.value = nextCaret;
  selectionEnd.value = nextCaret;
  void nextTick(() => {
    input.value?.focus();
    input.value?.setSelectionRange(nextCaret, nextCaret);
  });
}

function submitWithCommandEnter(event: KeyboardEvent): void {
  if (!props.commandEnterSubmit) return;
  event.preventDefault();
  event.stopPropagation();
  void submit('command-submit');
}

async function submit(eventName: 'command-submit' | 'submit' = 'submit'): Promise<void> {
  if (voiceStarting.value || voiceTranscribing.value || voiceSubmitPending.value) return;

  if (voiceRecording.value) {
    voiceSubmitPending.value = true;
    try {
      if (!await voiceController.stop()) return;
    } finally {
      voiceSubmitPending.value = false;
    }
  }

  const comment = draft.value.trim();
  if (!comment && !props.optional) {
    input.value?.focus();
    return;
  }
  if (eventName === 'command-submit') {
    emit('command-submit', comment);
    return;
  }
  emit('submit', comment);
}
</script>

<style scoped>
.annotation-popup {
  --chat-composer-compact-control-size: 24px;
  position: absolute;
  z-index: 3;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, calc(100% - 24px));
  max-width: calc(100% - 24px);
  padding: 6px 6px 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
  color: var(--color-text);
  font-family: var(--font-family-ui);
  font-size: var(--font-size-14);
}

.annotation-popup__input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
}

.annotation-popup__voice-field {
  padding: 0;
}

.annotation-popup__submit {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font: inherit;
  font-size: var(--font-size-16);
  line-height: 1;
  cursor: pointer;
}

.annotation-popup__submit:disabled {
  opacity: 0.42;
  cursor: default;
}
</style>
