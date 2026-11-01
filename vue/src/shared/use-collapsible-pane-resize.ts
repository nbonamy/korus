import { onScopeDispose, ref } from 'vue';

/** Keep the gesture alive when collapsing removes its separator from the DOM. */
export function useCollapsiblePaneResize() {
  const resizing = ref(false);
  let stopActive: (() => void) | undefined;

  function start(event: PointerEvent, pane: {
    minimum: number;
    width: number;
    widthAt: (event: PointerEvent) => number;
    resize: (width: number) => void;
    setOpen: (open: boolean) => void;
    opposite?: { maximum: number; setOpen: (open: boolean) => void };
    onEnd?: () => void;
  }): void {
    if (event.button !== 0) return;
    event.preventDefault();
    stopActive?.();
    resizing.value = true;
    let collapsed: 'pane' | 'opposite' | null = null;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const width = pane.widthAt(event);
      const maximum = pane.opposite?.maximum ?? Infinity;
      const next = width < (collapsed === 'pane' ? pane.minimum : pane.minimum - 24) ? 'pane'
        : width > (collapsed === 'opposite' ? maximum : maximum + 24) ? 'opposite'
        : null;
      if (next !== collapsed) {
        if (collapsed === 'pane') pane.setOpen(true);
        if (collapsed === 'opposite') pane.opposite?.setOpen(true);
        collapsed = next;
        if (next) {
          pane.resize(pane.width);
          if (next === 'pane') pane.setOpen(false);
          else pane.opposite?.setOpen(false);
        }
      }
      if (!collapsed) pane.resize(width);
    };
    const pointerId = event.pointerId;
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', stop);
      resizing.value = false;
      stopActive = undefined;
      pane.onEnd?.();
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === pointerId) stop();
    };
    stopActive = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', stop);
  }

  onScopeDispose(() => stopActive?.());
  return { resizing, start, stop: () => stopActive?.() };
}
