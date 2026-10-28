import { nextTick, ref } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { useCodeSelection } from '../use-code-selection';

const host = document.createElement('div');
let selection: ReturnType<typeof useCodeSelection>;

function build(lines: { number: number; text: string; side?: 'old' | 'new'; prefix?: string }[], path = 'src/a.ts'): HTMLElement {
  host.innerHTML = '';
  const container = document.createElement('div');
  container.setAttribute('data-code-path', path);
  for (const line of lines) {
    const row = document.createElement('div');
    row.setAttribute('data-code-line', String(line.number));
    if (line.side) row.setAttribute('data-code-side', line.side);
    if (line.prefix !== undefined) row.setAttribute('data-code-prefix', line.prefix);
    const code = document.createElement('code');
    code.setAttribute('data-code-text', '');
    code.textContent = line.text;
    row.append(code);
    container.append(row);
  }
  host.append(container);
  document.body.append(host);
  selection = useCodeSelection(ref(container));
  return container;
}
const row = (container: HTMLElement, index: number) => container.querySelectorAll<HTMLElement>('[data-code-line]')[index]!;
afterEach(() => { host.remove(); window.getSelection()?.removeAllRanges(); });

describe('picking lines with the plus', () => {
  const source = [{ number: 1, text: 'one' }, { number: 2, text: 'two' }, { number: 3, text: 'three' }, { number: 4, text: 'four' }];
  const press = (element: HTMLElement, shiftKey = false) => selection.lineDragStart(element, new MouseEvent('mousedown', { shiftKey }));
  const over = (element: HTMLElement) => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const release = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const selected = (container: HTMLElement) => [0, 1, 2, 3].map((index) => row(container, index).classList.contains('code-annotation-line--selected'));

  it('hands a single line to the comment box as soon as the plus is released', () => {
    const container = build(source);
    press(row(container, 1));
    expect(selection.commenting.value).toBeNull();
    expect(selected(container)).toStrictEqual([false, true, false, false]);
    release();
    expect(selection.commenting.value).toMatchObject({ path: 'src/a.ts', startLine: 2, endLine: 2, text: 'two' });
    expect(selection.selection.value).toBeNull();
  });

  it('follows the pointer over the lines, in either direction, and settles when released', () => {
    const container = build(source);
    press(row(container, 1));
    over(row(container, 3));
    expect(selected(container)).toStrictEqual([false, true, true, true]);
    over(row(container, 0));
    expect(selected(container)).toStrictEqual([true, true, false, false]);
    release();
    expect(selection.commenting.value).toMatchObject({ startLine: 1, endLine: 2, text: 'one\ntwo' });
    over(row(container, 3));
    expect(selection.commenting.value).toMatchObject({ startLine: 1, endLine: 2 });
  });

  it('follows the pointer over the code inside a line, and stays within the file', () => {
    const container = build(source);
    const other = document.createElement('div');
    other.setAttribute('data-code-path', 'src/b.ts');
    other.innerHTML = '<div data-code-line="1"><code data-code-text>other</code></div>';
    container.append(other);
    press(row(container, 0));
    over(row(container, 2).querySelector('code')!);
    over(other.querySelector<HTMLElement>('[data-code-line]')!);
    release();
    expect(selection.commenting.value).toMatchObject({ path: 'src/a.ts', startLine: 1, endLine: 3 });
  });

  it('runs on from the earlier pick with shift, without waiting for a release', () => {
    const container = build(source);
    press(row(container, 0));
    release();
    press(row(container, 2), true);
    expect(selection.commenting.value).toMatchObject({ startLine: 1, endLine: 3, text: 'one\ntwo\nthree' });
    over(row(container, 3));
    expect(selection.commenting.value).toMatchObject({ endLine: 3 });
  });

  it('starts over with a new press and clears on demand', () => {
    const container = build(source);
    press(row(container, 0)); release();
    press(row(container, 2)); release();
    expect(selection.commenting.value).toMatchObject({ startLine: 3, endLine: 3 });
    expect(selected(container)).toStrictEqual([false, false, true, false]);
    selection.clear();
    expect(selection.commenting.value).toBeNull();
    expect(container.querySelector('.code-annotation-line--selected')).toBeNull();
  });

  it('numbers a diff by the side it shows, and marks the lines it quotes', () => {
    const container = build([
      { number: 10, text: 'old()', side: 'old', prefix: '-' },
      { number: 10, text: 'renamed()', side: 'new', prefix: '+' },
      { number: 11, text: 'same()', side: 'new', prefix: ' ' },
    ]);
    press(row(container, 0)); release();
    expect(selection.commenting.value).toMatchObject({ startLine: 10, endLine: 10, side: 'old', text: '-old()' });
    press(row(container, 2), true);
    expect(selection.commenting.value).toMatchObject({ startLine: 10, endLine: 11, side: 'new', text: '-old()\n+renamed()\n same()' });
  });
});

describe('selecting text', () => {
  const source = [{ number: 1, text: 'alpha beta' }, { number: 2, text: 'gamma delta' }, { number: 3, text: 'epsilon' }];
  function select(from: Node, fromOffset: number, to: Node, toOffset: number) {
    const range = document.createRange();
    range.setStart(from, fromOffset);
    range.setEnd(to, toOffset);
    const current = window.getSelection()!;
    current.removeAllRanges();
    current.addRange(range);
    selection.textSelected();
  }
  const textOf = (container: HTMLElement, index: number) => row(container, index).querySelector('code')!.firstChild!;

  it('reports the line and the words picked inside one line', () => {
    const container = build(source);
    select(textOf(container, 0), 6, textOf(container, 0), 10);
    expect(selection.selection.value).toMatchObject({ path: 'src/a.ts', startLine: 1, endLine: 1, text: 'beta' });
  });

  it('reports the lines a selection runs across', () => {
    const container = build(source);
    select(textOf(container, 0), 6, textOf(container, 1), 5);
    // A browser separates the lines with a newline; the test DOM has no layout to do that.
    expect(selection.selection.value).toMatchObject({ startLine: 1, endLine: 2, text: expect.stringMatching(/^beta\s*gamma$/) });
  });

  it('does not count the next line when a whole line was picked up to the start of it', () => {
    const container = build(source);
    select(textOf(container, 0), 0, textOf(container, 1), 0);
    expect(selection.selection.value).toMatchObject({ startLine: 1, endLine: 1 });
  });

  it('ignores selections outside the code, and an emptied selection clears the old one', () => {
    const container = build(source);
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    host.append(outside);
    select(outside.firstChild!, 0, outside.firstChild!, 4);
    expect(selection.selection.value).toBeNull();
    select(textOf(container, 0), 0, textOf(container, 0), 5);
    expect(selection.selection.value).not.toBeNull();
    window.getSelection()!.removeAllRanges();
    selection.textSelected();
    expect(selection.selection.value).toBeNull();
  });
});
