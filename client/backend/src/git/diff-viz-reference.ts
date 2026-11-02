import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utilityImageAttachments } from '../agents/utility-image-attachments';

/** Bundled next to the standalone daemon, or under the desktop's external resource root. */
export async function diffVizReference() {
  const assets = process.env.APP_ASSETS_PATH?.trim() || path.dirname(fileURLToPath(import.meta.url));
  try {
    return await utilityImageAttachments([{ type: 'image', path: path.join(assets, 'viz', 'reference.png'), mimeType: 'image/png' }]);
  } catch (cause) {
    throw new Error('The bundled Viz reference image is unavailable. Rebuild or reinstall the runtime assets.', { cause });
  }
}
