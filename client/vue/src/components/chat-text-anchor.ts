import type { ChatTextSelection } from './use-chat-text-annotations';

// The text slot is owned by Korus; SDK markup and message DOM are not inspected.
export function captureChatTextAnchor(selection: ChatTextSelection | null): ChatTextSelection | null {
  const current = window.getSelection();
  if (!selection || !current?.rangeCount) return null;
  const range = current.getRangeAt(0);
  const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const content = element?.closest<HTMLElement>('[data-chat-annotation-content]');
  const block = content?.parentElement;
  if (!content || !block || !content.contains(range.endContainer)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(content);
  prefix.setEnd(range.startContainer, range.startOffset);
  const blocks = [...(block.closest('.conversation-pane')?.querySelectorAll<HTMLElement>('[data-chat-annotation-message]') ?? [])]
    .filter(candidate => candidate.dataset.chatAnnotationMessage === block.dataset.chatAnnotationMessage);
  return {
    ...selection,
    textStart: prefix.toString().length + (range.toString().length - range.toString().trimStart().length),
    textBlockIndex: blocks.indexOf(block),
  };
}

export function textRange(content: HTMLElement, text: string, start?: number): Range | null {
  const value = content.textContent ?? '';
  let offset = start ?? value.indexOf(text);
  let length = text.length;
  if (offset < 0 || value.slice(offset, offset + length) !== text) {
    // Selection.toString() includes rendered paragraph/list breaks that are not
    // necessarily present in textContent. Match characters while mapping back
    // to the original DOM offsets; keep an explicit start anchored in place.
    const positions: number[] = [];
    let normalized = '';
    for (let index = 0; index < value.length; index += 1) {
      if (/\s/u.test(value[index]!)) continue;
      normalized += value[index];
      positions.push(index);
    }
    const selected = text.replace(/\s+/gu, '');
    const from = start === undefined ? 0 : positions.findIndex(position => position >= start);
    if (!selected || from < 0) return null;
    const match = normalized.indexOf(selected, from);
    const matchedStart = positions[match];
    if (matchedStart === undefined || (start !== undefined && matchedStart !== start)) return null;
    offset = matchedStart;
    length = positions[match + selected.length - 1]! + 1 - offset;
  }
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let position = 0;
  let started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const end = position + (node.textContent?.length ?? 0);
    if (!started && offset < end) {
      range.setStart(node, offset - position);
      started = true;
    }
    if (started && offset + length <= end) {
      range.setEnd(node, offset + length - position);
      return range;
    }
    position = end;
  }
  return null;
}

// One highlight paints the ranges from all mounted conversation panes. Owners
// release their ranges on removal or unmount so detached DOM is never retained.
const highlightedRanges = new Map<symbol, { ranges: readonly Range[]; focusedRanges: readonly Range[] }>();
export function updateChatTextHighlights(owner: symbol, ranges: readonly Range[], focusedRanges: readonly Range[] = []): void {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
  if (ranges.length || focusedRanges.length) highlightedRanges.set(owner, { ranges, focusedRanges });
  else highlightedRanges.delete(owner);
  const all = [...highlightedRanges.values()];
  for (const [name, painted] of [
    ['chat-annotations', all.flatMap(entry => [...entry.ranges])],
    ['chat-annotation-focus', all.flatMap(entry => [...entry.focusedRanges])],
  ] as const) {
    if (painted.length) CSS.highlights.set(name, new Highlight(...painted));
    else CSS.highlights.delete(name);
  }
}
