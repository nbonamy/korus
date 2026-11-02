import { computed, ref } from 'vue';
import { appClientPlatform } from './platform-api';

// A client-local UI preference, like the saved workspace layout. No prompt content.
const storageKey = 'app:githubStarPrompt:v1';
const threshold = 5;
const preference = ref({ sentPrompts: 0, dismissed: false });

function restore(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    preference.value = {
      sentPrompts: Number.isSafeInteger(saved?.sentPrompts) && saved.sentPrompts >= 0 ? Math.min(saved.sentPrompts, threshold) : 0,
      dismissed: saved?.dismissed === true,
    };
  } catch { /* Keep the session preference if storage is unavailable. */ }
}

function save(): void {
  try { localStorage.setItem(storageKey, JSON.stringify(preference.value)); }
  catch { /* A star reminder must never prevent sending a prompt. */ }
}

export function recordSentPrompt(): void {
  if (appClientPlatform !== 'desktop') return;
  restore();
  if (preference.value.dismissed || preference.value.sentPrompts >= threshold) return;
  preference.value.sentPrompts++;
  save();
}

export function useGithubStarPrompt() {
  restore();
  return {
    visible: computed(() => preference.value.sentPrompts >= threshold && !preference.value.dismissed),
    dismiss: () => {
      preference.value.dismissed = true;
      save();
    },
  };
}
