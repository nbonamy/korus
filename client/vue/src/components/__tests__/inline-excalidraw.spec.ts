import { describe, expect, it } from 'vitest';
import { parseInlineExcalidraw } from '../inline-excalidraw';

describe('inline diagrams', () => {
  it('accepts a small local scene and rejects external links, invalid geometry and oversized scenes', () => {
    const box = { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 };
    const source = (elements: unknown[], files = {}) => JSON.stringify({ elements, files });
    expect(parseInlineExcalidraw(source([box])).elements).toEqual([box]);
    for (const value of [
      '{', source([{ ...box, width: '100' }]), source([{ ...box, link: 'https://example.org' }]),
      source(Array.from({ length: 41 }, (_, i) => ({ ...box, id: String(i) }))),
      source([box], { remote: { id: 'remote', dataURL: 'https://example.org/image.png' } }),
      source([{ ...box, type: 'image' }]),
    ]) expect(() => parseInlineExcalidraw(value)).toThrow();
  });
});
