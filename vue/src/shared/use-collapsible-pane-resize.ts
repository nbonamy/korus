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
  }): void {
    if (event.button !== 0) return;
    event.preventDefault();
    stopActive?.();
    resizing.value = true;
    const collapseThreshold = pane.minimum - 24;
    let collapsed = false;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const width = pane.widthAt(event);
      if (!collapsed && width < collapseThreshold) {
        collapsed = true;
        pane.resize(pane.width);
        pane.setOpen(false);
      } else if (width >= (collapsed ? pane.minimum : collapseThreshold)) {
        if (collapsed) pane.setOpen(true);
        collapsed = false;
        pane.resize(width);
      }
    };
    const pointerId = event.pointerId;
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', stop);
      resizing.value = false;
      stopActive = undefined;
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
  return { resizing, start };
}
