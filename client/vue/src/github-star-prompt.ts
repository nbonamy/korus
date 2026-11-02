import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { appClientPlatform } from './platform-api';
import { useGeneralPreferences, type GeneralPreferences } from './general-preferences';

const threshold = 5;
const previewVisible = ref(false);

export function showGithubStarPromptPreview(): void {
  previewVisible.value = true;
}

export async function recordSentPrompt(preferences: GeneralPreferences): Promise<void> {
  if (appClientPlatform !== 'desktop') return;
  try {
    await preferences.update(general => {
      const current = general.githubStarPrompt ?? { sentPrompts: 0, dismissed: false };
      if (current.dismissed || current.sentPrompts >= threshold) return {};
      return { githubStarPrompt: { ...current, sentPrompts: current.sentPrompts + 1 } };
    });
  } catch { /* A reminder must never turn a successful prompt into a failed send. */ }
}

export function useGithubStarPrompt() {
  const preferences = useGeneralPreferences();
  return {
    visible: computed(() => {
      const current = preferences?.general().githubStarPrompt;
      return previewVisible.value || Boolean(current && current.sentPrompts >= threshold && !current.dismissed);
    }),
    dismiss: async () => {
      if (previewVisible.value) {
        previewVisible.value = false;
        return;
      }
      try {
        await preferences?.update(general => ({ githubStarPrompt: {
          sentPrompts: general.githubStarPrompt?.sentPrompts ?? threshold, dismissed: true,
        } }));
      } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : String(cause)); }
    },
  };
}
