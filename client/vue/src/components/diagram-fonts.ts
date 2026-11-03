import { FONT_FAMILY } from '@excalidraw/excalidraw';
import type { CanvasElement } from '@workspace/core/visualize-canvas';

/** Stable native font numbers saved in canvas documents. Existing families keep their meanings. */
export const diagramFonts = { geist: 4, mono: 10 } as const;
Object.assign(FONT_FAMILY, { Geist: diagramFonts.geist, 'JetBrains Mono': diagramFonts.mono });

const faces = [
  { id: diagramFonts.geist, family: 'Geist', url: new URL('../assets/diagram-fonts/Geist.woff2', import.meta.url).href },
  { id: diagramFonts.mono, family: 'JetBrains Mono', url: new URL('../assets/diagram-fonts/JetBrainsMono.woff2', import.meta.url).href },
];
const loading = new WeakMap<FontFaceSet, Map<number, Promise<void>>>();

/** Measure, restore and export text only after its actual face is available. Failed loads remain retryable. */
export async function loadCanvasFonts(elements: readonly CanvasElement[]): Promise<void> {
  const needed = faces.filter(face => elements.some(element => element.type === 'text' && element.fontFamily === face.id));
  if (!needed.length) return;
  const set = document.fonts;
  let pending = loading.get(set);
  if (!pending) { pending = new Map(); loading.set(set, pending); }
  await Promise.all(needed.map(face => {
    let work = pending.get(face.id);
    if (!work) {
      work = new FontFace(face.family, `url("${face.url}")`).load().then(font => { set.add(font); }).catch(error => {
        pending.delete(face.id);
        throw new Error(`Unable to load the diagram font ${face.family}.`, { cause: error });
      });
      pending.set(face.id, work);
    }
    return work;
  }));
}
