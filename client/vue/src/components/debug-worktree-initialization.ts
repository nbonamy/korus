import { onScopeDispose, provide, shallowRef, type InjectionKey, type ShallowRef } from 'vue';
import type { Agent } from '@workspace/core/contracts';

type PreviewAgent = Pick<Agent, 'id' | 'folder' | 'worktreeInitialization'>;
export const worktreeInitializationPreviewKey: InjectionKey<ShallowRef<PreviewAgent | null>> = Symbol('worktreeInitializationPreview');

export function useDebugWorktreeInitialization() {
  const preview = shallowRef<PreviewAgent | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  provide(worktreeInitializationPreviewKey, preview);
  onScopeDispose(() => clearTimeout(timer));
  return (agent: Agent | null) => {
    if (!agent || agent.worktreeInitialization?.state === 'running') return;
    clearTimeout(timer);
    preview.value = { id: agent.id, folder: agent.folder, worktreeInitialization: { state: 'running', command: 'npm ci' } };
    timer = setTimeout(() => {
      preview.value = { ...preview.value!, worktreeInitialization: { state: 'complete' } };
    }, 8_000);
  };
}
