import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Font URLs travel through Vite's asset graph; both hosts also ship their OFL notices. */
export function diagramFontAssets(): Plugin {
  return {
    name: 'app-diagram-font-assets',
    async generateBundle() {
      for (const name of ['OFL-Geist.txt', 'OFL-JetBrainsMono.txt']) {
        this.emitFile({type:'asset',fileName:`diagram-fonts/${name}`,source:await readFile(fileURLToPath(new URL(`./src/assets/diagram-fonts/${name}`,import.meta.url)))});
      }
    },
  };
}
