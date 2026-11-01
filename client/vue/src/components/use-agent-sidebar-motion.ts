import { nextTick, onUnmounted, watch, type Ref } from 'vue';

/** FLIP by agent identity, including moves between different section parents. */
export function useAgentSidebarMotion(list: Ref<HTMLElement | null>, scope: () => string | null, layout: () => string): void {
  let animations: Animation[] = [];
  let generation = 0;
  const cancel = () => { animations.forEach(animation => animation.cancel()); animations = []; };
  const rows = () => [...(list.value?.querySelectorAll<HTMLElement>('[data-motion-id]') ?? [])]
    .filter(row => row.getClientRects().length);
  watch([scope, layout], async ([current], [previous]) => {
    const token = ++generation;
    const positions = new Map(rows().map(row => [row.dataset.motionId!, row.getBoundingClientRect()]));
    const focused = document.activeElement?.closest<HTMLElement>('[data-motion-id]')?.dataset.motionId;
    const scrollTop = list.value?.scrollTop ?? 0;
    cancel();
    if (current === null || current !== previous) return;
    await nextTick();
    if (generation !== token || !list.value) return;
    list.value.scrollTop = scrollTop;
    for (const row of rows()) {
      if (focused === row.dataset.motionId && document.activeElement === document.body) row.querySelector('button')?.focus({ preventScroll: true });
      const before = positions.get(row.dataset.motionId!);
      if (!before || !row.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue;
      const after = row.getBoundingClientRect();
      const x = before.left - after.left, y = before.top - after.top;
      if (Math.abs(x) + Math.abs(y) < 1) continue;
      const animation = row.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
        duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)',
      });
      animations.push(animation);
      if (row.classList.contains('agent-sidebar__agent-row')) {
        row.classList.add('agent-sidebar__activity-moving');
        const clear = () => row.classList.remove('agent-sidebar__activity-moving');
        void animation.finished.then(clear, clear);
      }
    }
  });
  onUnmounted(() => { generation++; cancel(); });
}
