import { describe, expect, it, vi } from 'vitest';
import { useListReorderDrag, type ReorderDrop } from '../use-list-reorder-drag';

describe('useListReorderDrag', () => {
  it('maps before and after drops to before-id payloads', () => {
    const drops: ReorderDrop<string>[] = [];
    const reorder = useListReorderDrag<string>({
      itemIds: () => ['a', 'b', 'c'],
      onDrop: (drop) => drops.push(drop),
    });
    const target = elementWithRect({ top: 100, height: 40 });

    reorder.onDragStart('a', dragEvent('dragstart', { currentTarget: elementWithRect({ top: 0, height: 40 }) }));
    expect(reorder.isDragging.value).toBe(true);
    expect(reorder.dropTargetClass('a')).toMatchObject({
      'list-reorder-drag--dragging': true,
    });

    reorder.onDragOver('b', dragEvent('dragover', { currentTarget: target, clientY: 132 }));
    expect(reorder.dropTarget.value).toStrictEqual({ id: 'b', position: 'after' });
    expect(reorder.dropTargetClass('b')).toMatchObject({
      'list-reorder-drag--drop-after': true,
    });
    reorder.onDrop('b', dragEvent('drop', { currentTarget: target, clientY: 132 }));

    expect(drops).toStrictEqual([{ draggedId: 'a', beforeId: 'c' }]);
    expect(reorder.isDragging.value).toBe(false);

    reorder.onDragStart('c', dragEvent('dragstart', { currentTarget: target }));
    reorder.onDragOver('a', dragEvent('dragover', { currentTarget: target, clientY: 108 }));
    reorder.onDrop('a', dragEvent('drop', { currentTarget: target, clientY: 108 }));

    expect(drops).toStrictEqual([
      { draggedId: 'a', beforeId: 'c' },
      { draggedId: 'c', beforeId: 'a' },
    ]);
  });

  it('prevents dragging single-item lists', () => {
    const reorder = useListReorderDrag<string>({
      itemIds: () => ['a'],
      onDrop: vi.fn(),
    });
    const event = dragEvent('dragstart', { currentTarget: elementWithRect({ top: 0, height: 40 }) });

    reorder.onDragStart('a', event);

    expect(event.defaultPrevented).toBe(true);
    expect(reorder.dragItemAttributes('a')).toStrictEqual({
      draggable: false,
      'data-reorder-id': 'a',
    });
    expect(reorder.isDragging.value).toBe(false);
  });

  it('limits dragging and dropping to items in the same scope', () => {
    const drops: ReorderDrop<string>[] = [];
    const reorder = useListReorderDrag<string>({
      itemIds: () => ['a-1', 'a-2', 'b-1'],
      onDrop: (drop) => drops.push(drop),
      scopeForId: (id) => id.split('-')[0]!,
    });
    const source = dragEvent('dragstart', { currentTarget: elementWithRect({ top: 0, height: 40 }) });
    const otherScope = dragEvent('dragover', { currentTarget: elementWithRect({ top: 40, height: 40 }) });

    expect(reorder.dragItemAttributes('a-1').draggable).toBe(true);
    expect(reorder.dragItemAttributes('b-1').draggable).toBe(false);
    reorder.onDragStart('a-1', source);
    reorder.onDragOver('b-1', otherScope);
    reorder.onDrop('b-1', otherScope);

    expect(otherScope.defaultPrevented).toBe(false);
    expect(drops).toStrictEqual([]);

    reorder.onDragStart('a-1', source);
    reorder.onDragOver('a-2', dragEvent('dragover', { currentTarget: elementWithRect({ top: 40, height: 40 }), clientY: 70 }));
    reorder.onDrop('a-2', dragEvent('drop', { currentTarget: elementWithRect({ top: 40, height: 40 }), clientY: 70 }));

    expect(drops).toStrictEqual([{ draggedId: 'a-1', beforeId: null }]);
  });

  it('tolerates browser drag events without dataTransfer', () => {
    const drops: ReorderDrop<string>[] = [];
    const reorder = useListReorderDrag<string>({
      itemIds: () => ['a', 'b'],
      onDrop: (drop) => drops.push(drop),
    });
    const target = elementWithRect({ top: 50, height: 40 });

    reorder.onDragStart('a', dragEvent('dragstart', { currentTarget: target, dataTransfer: false }));
    reorder.onDragOver('b', dragEvent('dragover', { currentTarget: target, clientY: 55, dataTransfer: false }));
    reorder.onDrop('b', dragEvent('drop', { currentTarget: target, clientY: 55, dataTransfer: false }));

    expect(drops).toStrictEqual([{ draggedId: 'a', beforeId: 'b' }]);
  });

  it('clears invalid hover and self-drop states without emitting a drop', () => {
    const onDrop = vi.fn();
    const reorder = useListReorderDrag<string>({
      itemIds: () => ['a', 'b'],
      onDrop,
    });
    const target = elementWithRect({ top: 50, height: 40 });

    reorder.onDragOver('b', dragEvent('dragover', { currentTarget: target }));
    expect(reorder.dropTarget.value).toBeNull();

    reorder.onDragStart('a', dragEvent('dragstart', { currentTarget: target }));
    reorder.onDragOver('a', dragEvent('dragover', { currentTarget: target }));
    expect(reorder.dropTarget.value).toBeNull();

    reorder.onDrop('a', dragEvent('drop', { currentTarget: target }));
    expect(onDrop).not.toHaveBeenCalled();
    expect(reorder.isDragging.value).toBe(false);
  });

  it('clears the drop target only when the dragged pointer leaves the active item', () => {
    const reorder = useListReorderDrag<string>({
      itemIds: () => ['a', 'b'],
      onDrop: vi.fn(),
    });
    const target = elementWithRect({ top: 50, height: 40 });
    const child = document.createElement('span');
    target.appendChild(child);

    reorder.onDragStart('a', dragEvent('dragstart', { currentTarget: target }));
    reorder.onDragOver('b', dragEvent('dragover', { currentTarget: target, target, clientY: 55 }));
    expect(reorder.dropTarget.value).toStrictEqual({ id: 'b', position: 'before' });

    reorder.onDragLeave('b', dragEvent('dragleave', { currentTarget: target, target: child }));
    expect(reorder.dropTarget.value).toStrictEqual({ id: 'b', position: 'before' });

    reorder.onDragLeave('b', dragEvent('dragleave', { currentTarget: target, target }));
    expect(reorder.dropTarget.value).toBeNull();
  });

  it('falls back to after-position drops when no element is available', () => {
    const drops: ReorderDrop<string>[] = [];
    const reorder = useListReorderDrag<string>({
      itemIds: () => ['a', 'b'],
      onDrop: (drop) => drops.push(drop),
    });

    reorder.onDragStart('a', dragEvent('dragstart', {}));
    reorder.onDrop('b', dragEvent('drop', {}));

    expect(drops).toStrictEqual([{ draggedId: 'a', beforeId: null }]);
  });
});

function dragEvent(
  type: string,
  options: { currentTarget?: EventTarget | null; target?: EventTarget | null; clientY?: number; dataTransfer?: boolean },
): DragEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  const dataTransfer = {
    dropEffect: '',
    effectAllowed: '',
    setData: vi.fn(),
  };

  Object.defineProperty(event, 'clientY', { value: options.clientY ?? 0 });
  Object.defineProperty(event, 'currentTarget', { value: options.currentTarget ?? null });
  Object.defineProperty(event, 'target', { value: options.target ?? options.currentTarget ?? null });
  Object.defineProperty(event, 'dataTransfer', { value: options.dataTransfer === false ? null : dataTransfer });
  return event;
}

function elementWithRect(rect: { top: number; height: number }): HTMLElement {
  const element = document.createElement('button');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: rect.top,
    bottom: rect.top + rect.height,
    height: rect.height,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: rect.top,
    toJSON: () => undefined,
  });
  return element;
}
