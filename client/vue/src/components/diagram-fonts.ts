import { FONT_FAMILY } from '@excalidraw/excalidraw';
import type { CanvasElement } from '@workspace/core/visualize-canvas';

/** Native editor families keep downloaded scenes portable. */
export const diagramFonts = { title: FONT_FAMILY.Nunito, mono: FONT_FAMILY.Cascadia } as const;

/** Retained Korus diagrams used custom Geist/JetBrains IDs. Reopen them with the native pairing. */
export function normalizeCanvasFonts(elements: readonly CanvasElement[]): CanvasElement[] {
  return elements.map(element => element.type === 'text' && (element.fontFamily === 4 || element.fontFamily === 10)
    ? { ...element, fontFamily: element.fontFamily === 4 ? diagramFonts.title : diagramFonts.mono }
    : element);
}
