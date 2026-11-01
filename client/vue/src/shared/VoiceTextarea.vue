<template>
  <div class="voice-textarea" :style="fieldStyle" @keydown.esc="cancelDictation">
    <CodexComposerVoiceField
      v-if="voiceVisible && busy"
      class="voice-textarea__voice-field"
      :recording="voiceRecording"
      :starting="voiceStarting"
      :transcript="voiceTranscript"
      :before="voiceBefore"
      :after="voiceAfter"
    />
    <textarea
      v-else
      :id="id"
      ref="textarea"
      :value="modelValue"
      :aria-label="label"
      :disabled="disabled"
      :placeholder="placeholder"
      :rows="rows"
      @blur="rememberSelection"
      @click="rememberSelection"
      @input="updateValue"
      @keyup="rememberSelection"
      @select="rememberSelection"
    />
    <CodexComposerVoiceButton
      v-if="voiceVisible"
      class="voice-textarea__voice-button"
      :disabled="voiceButtonDisabled"
      :label="voiceButtonLabel"
      :recording="voiceRecording"
      :title="voiceButtonTitle"
      @toggle="voiceController.toggle"
    />
  </div>
</template>

<script setup lang="ts">
import {
  CodexComposerVoiceButton,
  CodexComposerVoiceField,
  getCodexNativeRendererApi,
  useCodexComposerVoice,
} from '@codex-app-sdk/vue';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  disabled?: boolean;
  id?: string;
  label: string;
  modelValue: string;
  placeholder?: string;
  rows?: number;
}>(), {
  disabled: false,
  id: undefined,
  placeholder: '',
  rows: 5,
});

const emit = defineEmits<{
  'busy-change': [busy: boolean];
  'update:modelValue': [value: string];
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const selectionStart = ref(props.modelValue.length);
const selectionEnd = ref(props.modelValue.length);
const voiceVisible = computed(() => getCodexNativeRendererApi()?.capabilities.transcription === true);
const voiceController = useCodexComposerVoice({
  isDisabled: () => props.disabled,
  isSending: () => false,
  onTranscript: insertTranscript,
});
const voiceButtonDisabled = computed(() => voiceController.buttonDisabled.value);
const voiceButtonLabel = computed(() => voiceController.buttonLabel.value);
const voiceButtonTitle = computed(() => voiceController.buttonTitle.value);
const voiceRecording = computed(() => voiceController.isRecording.value);
const voiceTranscribing = computed(() => voiceController.isTranscribing.value);
const voiceStarting = computed(() => voiceController.isStarting.value);
const voiceTranscript = computed(() => voiceController.transcript.value);
const busy = computed(() => voiceStarting.value || voiceRecording.value || voiceTranscribing.value);
const voiceBefore = computed(() => {
  const text = props.modelValue.slice(0, selectionStart.value);
  return text && !/\s$/u.test(text) ? `${text} ` : text;
});
const voiceAfter = computed(() => {
  const text = props.modelValue.slice(selectionEnd.value);
  return text && !/^\s/u.test(text) ? ` ${text}` : text;
});
const fieldStyle = computed(() => ({ minHeight: `${Math.max(2, props.rows) * 20 + 24}px` }));

watch(busy, (value) => emit('busy-change', value));

onBeforeUnmount(() => voiceController.dispose());

async function cancelDictation(event: KeyboardEvent): Promise<void> {
  if (!busy.value) return;
  event.preventDefault();
  event.stopPropagation();
  await voiceController.cancel();
  await nextTick();
  textarea.value?.focus();
}

function updateValue(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  rememberSelection();
}

function rememberSelection(): void {
  selectionStart.value = textarea.value?.selectionStart ?? props.modelValue.length;
  selectionEnd.value = textarea.value?.selectionEnd ?? selectionStart.value;
}

function insertTranscript(value: string): void {
  const transcript = value.trim();
  if (!transcript) return;
  const start = Math.min(selectionStart.value, props.modelValue.length);
  const end = Math.min(Math.max(selectionEnd.value, start), props.modelValue.length);
  const before = props.modelValue.slice(0, start);
  const after = props.modelValue.slice(end);
  const prefix = before && !/\s$/u.test(before) ? ' ' : '';
  const suffix = after && !/^\s/u.test(after) ? ' ' : '';
  const insertion = `${prefix}${transcript}${suffix}`;
  const caret = before.length + insertion.length;
  emit('update:modelValue', `${before}${insertion}${after}`);
  selectionStart.value = caret;
  selectionEnd.value = caret;
  void nextTick(() => {
    textarea.value?.focus();
    textarea.value?.setSelectionRange(caret, caret);
  });
}
</script>

<style scoped>
.voice-textarea {
  position: relative;
  min-width: 0;
}

.voice-textarea textarea {
  width: 100%;
  min-height: inherit;
  display: block;
  padding: var(--space-10) var(--space-24) var(--space-10) var(--space-12);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  background: var(--color-surface);
  font: inherit;
  line-height: var(--line-height-20);
  outline: none;
  resize: vertical;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.voice-textarea textarea:hover:not(:disabled) {
  border-color: var(--color-border-strong);
}

.voice-textarea textarea:focus {
  border-color: var(--color-primary);
  box-shadow: inset 0 0 0 1px var(--color-primary);
}

.voice-textarea textarea:disabled {
  color: var(--color-text-muted);
  background: var(--color-surface-low);
  cursor: not-allowed;
}

.voice-textarea__voice-field {
  min-height: inherit;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.voice-textarea__voice-button {
  position: absolute;
  right: var(--space-8);
  bottom: var(--space-8);
}
</style>
