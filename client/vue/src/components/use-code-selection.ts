import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { CodeRange } from './use-code-annotations';

export type CodeSelectionAnchor = { x: number; y: number; width: number; height: number };
export type CodeSelection = CodeRange & { text: string; anchor: CodeSelectionAnchor };

const lineSelector = '[data-code-line]';
const selectedClass = 'code-annotation-line--selected';
const noAnchor: CodeSelectionAnchor = { x: 0, y: 0, width: 0, height: 0 };

const asElement = (node: Node | null): Element | null => (node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element | null);
const lineOf = (node: Node | null): HTMLElement | null => asElement(node)?.closest<HTMLElement>(lineSelector) ?? null;
const pathOf = (line: HTMLElement): string | undefined => line.closest<HTMLElement>('[data-code-path]')?.getAttribute('data-code-path') ?? undefined;
const numberOf = (line: HTMLElement): number => Number(line.getAttribute('data-code-line'));
const sideOf = (line: HTMLElement): 'old' | 'new' | undefined => {
  const side = line.getAttribute('data-code-side');
  return side === 'old' || side === 'new' ? side : undefined;
};
const codeOf = (line: HTMLElement): string => (line.querySelector('[data-code-text]') ?? line).textContent ?? '';
const rectOf = (rect: DOMRect | undefined): CodeSelectionAnchor => (rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : noAnchor);

/**
 * Lets people point at code: click or drag from a line's plus, or select text. The code
 * marks each line `data-code-line` (its number) inside an element carrying `data-code-path`; diff lines also
 * say which side they number (`data-code-side`) and how they are quoted (`data-code-prefix`).
 */
export function useCodeSelection(container: Ref<HTMLElement | null>) {
  /** Text the person selected: the host offers an Annotate button for it. */
  const selection = ref<CodeSelection | null>(null);
  /** Lines picked with the plus: the host opens the comment box on them right away. */
  const commenting = ref<CodeSelection | null>(null);
  let anchorLine: HTMLElement | null = null;

  const lines = () => [...(container.value?.querySelectorAll<HTMLElement>(lineSelector) ?? [])];

  function highlight(selected: readonly HTMLElement[]): void {
    for (const line of lines()) line.classList.toggle(selectedClass, selected.includes(line));
  }

  /** A selection built from whole lines: the lines' own text, with a diff's markers. */
  function fromLines(selected: readonly HTMLElement[], anchor: CodeSelectionAnchor): CodeSelection | null {
    const first = selected[0];
    const path = first && pathOf(first);
    if (!first || !path) return null;
    const sides = selected.map(sideOf);
    const side = sides.length > 0 && sides.every((candidate) => candidate === 'old') ? 'old' : sides.some((candidate) => candidate) ? 'new' : undefined;
    const numbered = selected.filter((line) => !side || sideOf(line) !== 'old' || side === 'old');
    const numbers = (numbered.length > 0 ? numbered : selected).map(numberOf);
    return {
      path,
      startLine: Math.min(...numbers),
      endLine: Math.max(...numbers),
      ...(side ? { side } : {}),
      text: selected.map((line) => `${line.getAttribute('data-code-prefix') ?? ''}${codeOf(line)}`).join('\n'),
      anchor,
    };
  }

  /** Marks the lines from the anchor to `line` (or just `line`) and describes them. */
  function pickLines(line: HTMLElement, extend: boolean): CodeSelection | null {
    const all = lines();
    const index = all.indexOf(line);
    if (index < 0) return null;
    const extending = extend && anchorLine && all.includes(anchorLine) && pathOf(anchorLine) === pathOf(line);
    if (!extending) anchorLine = line;
    const from = extending ? all.indexOf(anchorLine!) : index;
    const picked = all.slice(Math.min(from, index), Math.max(from, index) + 1);
    highlight(picked);
    return fromLines(picked, rectOf(line.getBoundingClientRect()));
  }

  /**
   * Pressing the plus on a line picks it; dragging on picks the lines the pointer passes over. Letting go
   * hands the lines to the comment box. With shift, the lines run on from the earlier pick.
   */
  let stopDragging: (() => void) | undefined;
  function commentLine(line: HTMLElement, event: { shiftKey: boolean }): void {
    stopDragging?.();
    selection.value = null;
    commenting.value = pickLines(line, event.shiftKey);
  }
  function lineDragStart(line: HTMLElement, event: { shiftKey: boolean }): void {
    stopDragging?.();
    selection.value = null;
    commenting.value = null;
    let picked = pickLines(line, event.shiftKey);
    if (event.shiftKey || !container.value) {
      commenting.value = picked;
      return;
    }
    const element = container.value;
    const over = (move: MouseEvent) => {
      const hovered = lineOf(move.target as Node);
      if (hovered && element.contains(hovered) && anchorLine && pathOf(hovered) === pathOf(anchorLine)) picked = pickLines(hovered, true) ?? picked;
    };
    const release = () => {
      element.removeEventListener('mouseover', over);
      document.removeEventListener('mouseup', release);
      stopDragging = undefined;
      commenting.value = picked;
    };
    stopDragging = () => {
      element.removeEventListener('mouseover', over);
      document.removeEventListener('mouseup', release);
      stopDragging = undefined;
    };
    element.addEventListener('mouseover', over);
    document.addEventListener('mouseup', release);
  }

  /** Call when the person lets go of the mouse: turns what they selected in the code into a selection. */
  function textSelected(): void {
    const current = window.getSelection();
    const range = current && current.rangeCount > 0 ? current.getRangeAt(0) : null;
    const keepOffer = () => {
      if (selection.value && !lines().some((line) => line.classList.contains(selectedClass))) selection.value = null;
    };
    if (!range || range.collapsed || !current) return keepOffer();
    const first = lineOf(range.startContainer);
    let last = lineOf(range.endContainer);
    const inside = first && last && container.value?.contains(first) && container.value.contains(last) && pathOf(first) === pathOf(last);
    if (!inside) return keepOffer();
    const all = lines();
    // Picking a whole line usually ends at the very start of the next one; that line is not part of it.
    if (range.endOffset === 0 && last !== first) last = all[all.indexOf(last!) - 1] ?? last;
    const covered = all.slice(all.indexOf(first), all.indexOf(last!) + 1);
    highlight([]);
    anchorLine = null;
    commenting.value = null;
    const built = fromLines(covered, rectOf(typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : undefined));
    selection.value = built ? { ...built, text: current.toString().replace(/\s+$/u, '') } : null;
  }

  function clear(): void {
    stopDragging?.();
    highlight([]);
    anchorLine = null;
    selection.value = null;
    commenting.value = null;
  }

  watch(container, (element, previous) => {
    previous?.removeEventListener('mouseup', textSelected);
    element?.addEventListener('mouseup', textSelected);
  }, { immediate: true });
  onBeforeUnmount(() => {
    container.value?.removeEventListener('mouseup', textSelected);
    stopDragging?.();
  });

  return { selection, commenting, commentLine, lineDragStart, textSelected, clear };
}
