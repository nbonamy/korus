import type { InjectionKey, Ref } from 'vue';

/** Per-window debug display state, never persisted or sent to a backend. */
export const providerUpdatePreviewKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('provider-update-preview');
