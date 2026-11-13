import { onBeforeUnmount } from 'vue';
import './annotation-selection-highlight.css';

const ranges = new Map<symbol, Range>();

/** Paint independently of native selection so comment inputs can take keyboard focus. */
export function useAnnotationSelectionHighlight() {
  const owner = Symbol('annotation-selection');

  function paint(): void {
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    if (ranges.size) CSS.highlights.set('annotation-selection', new Highlight(...ranges.values()));
    else CSS.highlights.delete('annotation-selection');
  }

  function clear(): void {
    ranges.delete(owner);
    paint();
  }

  function retain(range?: Range): void {
    clear();
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
    const selection = window.getSelection();
    const source = range ?? (selection?.rangeCount ? selection.getRangeAt(0) : null);
    if (!source || source.collapsed) return;
    ranges.set(owner, source.cloneRange());
    paint();
  }

  onBeforeUnmount(clear);
  return { retain, clear };
}
