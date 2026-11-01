import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';

export function useForegroundTimeout(eligible: () => boolean, remainingMs: Ref<number>, onElapsed: () => void | Promise<void>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt: number | undefined;
  function pauseTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (startedAt !== undefined) {
      remainingMs.value = Math.max(0, remainingMs.value - (performance.now() - startedAt));
      startedAt = undefined;
    }
  }
  function updateTimer() {
    pauseTimer();
    if (!eligible() || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    startedAt = performance.now();
    timer = setTimeout(() => {
      timer = undefined;
      startedAt = undefined;
      remainingMs.value = 0;
      void onElapsed();
    }, remainingMs.value);
  }
  watch(eligible, updateTimer);
  onMounted(() => {
    document.addEventListener('visibilitychange', updateTimer);
    window.addEventListener('focus', updateTimer);
    window.addEventListener('blur', updateTimer);
    updateTimer();
  });
  onBeforeUnmount(() => {
    pauseTimer();
    document.removeEventListener('visibilitychange', updateTimer);
    window.removeEventListener('focus', updateTimer);
    window.removeEventListener('blur', updateTimer);
  });
}
