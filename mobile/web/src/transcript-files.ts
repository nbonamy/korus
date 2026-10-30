import { shallowRef } from 'vue';
import { readConversationDiff, type ConversationDiffContent } from '@workspace/core/conversation-diffs';
import type { ConversationContentInput, ConversationContentChunk } from '@workspace/core/contracts/conversation';
type FileInput = CompanionFileInput & { diffContent?: ConversationDiffContent };
import type { CompanionFileInput, CompanionFilePreview } from '@workspace/core/companion-files';

export type TranscriptFileState = { input: FileInput; mode: 'diff' | 'source'; status: 'loading' | 'ready' | 'error'; preview: CompanionFilePreview | null };

/** One open preview; bounded, memory-only reuse within the same conversation revision. */
export function createTranscriptFiles(options: { agentId(): string | undefined; revision(): string; post(message: Record<string, unknown>): void; readContent(agentId: string, input: ConversationContentInput): Promise<ConversationContentChunk> }) {
  const state = shallowRef<TranscriptFileState | null>(null);
  const cache = new Map<string, CompanionFilePreview>();
  let pending: { id: string; agentId: string; key: string; timer: ReturnType<typeof setTimeout> } | undefined;
  let focusReturn: HTMLElement | null = null;
  function cancel() { if (pending) clearTimeout(pending.timer); pending = undefined; }
  function close() {
    const wasOpen = state.value !== null;
    cancel(); state.value = null;
    if (wasOpen) options.post({ type: 'filePreviewVisibility', open: false });
    focusReturn?.focus(); focusReturn = null;
  }
  function reset() { close(); cache.clear(); }
  function open(input: FileInput, refresh = false) {
    const agentId = options.agentId(); if (!agentId) return;
    if (!state.value) focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel();
    const key = JSON.stringify([options.revision(), input.path, input.action, input.turnId, input.diffContent?.contentId]);
    const preview = refresh ? null : cache.get(key) ?? null;
    const mode = state.value?.input.path === input.path ? state.value.mode : input.action === 'edit' || input.action === 'create' ? 'diff' : 'source';
    state.value = { input, mode, status: preview ? 'ready' : 'loading', preview };
    options.post({ type: 'filePreviewVisibility', open: true });
    if (preview) return;
    const id = crypto.randomUUID();
    pending = { id, agentId, key, timer: setTimeout(() => {
      if (pending?.id !== id) return;
      pending = undefined;
      if (state.value) state.value = { ...state.value, status: 'error' };
    }, 30_000) };
    const { diffContent: _diff, ...fileInput } = input;
    options.post({ type: 'readFilePreview', requestId: id, agentId, input: fileInput });
  }
  async function receive(reply: { requestId: string; agentId: string; preview?: CompanionFilePreview; error?: string }) {
    if (!pending || pending.id !== reply.requestId || pending.agentId !== reply.agentId || reply.agentId !== options.agentId() || !state.value) return;
    const key = pending.key; const id = pending.id; const input = state.value.input;
    if (input.diffContent) {
      try {
        const diff = await readConversationDiff(input.path, input.diffContent, value => options.readContent(reply.agentId, value), () => pending?.id === id && options.agentId() === reply.agentId);
        if (pending?.id !== id) return;
        reply = { ...reply, error: undefined, preview: { path: input.path, source: reply.preview?.source ?? null, diff, diffScope: 'turn' } };
      } catch {
        if (pending?.id !== id) return;
        cancel(); if (state.value) state.value = { ...state.value, status: 'error' }; return;
      }
    }
    cancel();
    if (!reply.preview || reply.error) { state.value = { ...state.value, status: 'error' }; return; }
    cache.set(key, reply.preview);
    const bytes = () => [...cache.values()].reduce((sum, item) => sum + (item.source?.content?.length ?? 0) * 2 + (item.diff?.length ?? 0) * 2, 0);
    while (cache.size > 3 || bytes() > 6 * 1024 * 1024) cache.delete(cache.keys().next().value!);
    state.value = { ...state.value, preview: reply.preview, status: 'ready' };
  }
  return { state, open, receive, close, reset,
    mode(mode: 'diff' | 'source') { if (state.value) state.value = { ...state.value, mode }; },
    refresh() { if (state.value) open(state.value.input, true); } };
}
