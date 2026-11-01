import { onScopeDispose, ref } from 'vue';

/** Debounces edits, serializes writes, and flushes pending changes on disposal. */
export function useDebouncedSave<T>(persist: (value: T) => Promise<void>, delay = 600) {
  const saving = ref(false);
  const saved = ref(false);
  const error = ref('');
  let pending: { value: T } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<boolean> | undefined;
  function schedule(value: T) {
    pending = { value };
    saved.value = false;
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, delay);
  }
  async function flush(): Promise<boolean> {
    clearTimeout(timer);
    if (running) {
      const success = await running;
      return pending ? flush() : success;
    }
    if (!pending) return !error.value;
    saving.value = true;
    running = (async () => {
      while (pending) {
        const { value } = pending;
        pending = undefined;
        error.value = '';
        try { await persist(value); }
        catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
          return false;
        }
      }
      saved.value = true;
      return true;
    })();
    try { return await running; }
    finally { running = undefined; saving.value = false; }
  }
  onScopeDispose(() => { void flush(); });
  return { schedule, flush, saving, saved, error };
}
