import { onScopeDispose, ref, type Ref } from 'vue';

/** Phones and narrow tablet windows switch from side-by-side panes to one pane at a time. */
export const compactViewportQuery = '(max-width: 768px)';

/** Tracks whether the viewport is narrow enough for the single-pane layout. */
export function useCompactViewport(): Ref<boolean> {
  const compact = ref(false);
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return compact;
  const query = window.matchMedia(compactViewportQuery);
  compact.value = query.matches;
  const update = (event: MediaQueryListEvent): void => {
    compact.value = event.matches;
  };
  query.addEventListener('change', update);
  onScopeDispose(() => query.removeEventListener('change', update));
  return compact;
}
