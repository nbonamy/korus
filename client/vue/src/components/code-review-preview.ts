import type { InjectionKey, Ref } from 'vue';

/** Per-window debug display state, never persisted or sent to a backend. */
export const codeReviewUncommittedPreviewKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('code-review-uncommitted-preview');
