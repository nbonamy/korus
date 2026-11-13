import { onBeforeUnmount } from 'vue';
import { annotationHighlightsSupported, updateChatTextHighlights } from './chat-text-anchor';

/**
 * Keeps the passage being annotated visible while a comment field owns focus, which
 * clears the native selection. The passage is painted as the focused annotation, so
 * it matches what a saved annotation looks like when it is revealed.
 */
export function usePendingAnnotationHighlight() {
  const owner = Symbol('pending-annotation-highlight');

  function release(): void {
    updateChatTextHighlights(owner, []);
  }

  /** Holds `range`, or the current selection, until `release` or unmount. */
  function hold(range?: Range): void {
    if (!annotationHighlightsSupported()) return;
    const selection = window.getSelection();
    const source = range ?? (selection?.rangeCount ? selection.getRangeAt(0) : null);
    // Clone: the native selection is cleared or moved while the comment is written.
    if (source && !source.collapsed) updateChatTextHighlights(owner, [], [source.cloneRange()]);
    else release();
  }

  onBeforeUnmount(release);
  return { hold, release };
}
