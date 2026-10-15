import { companionMaxUploadBytes, companionMaxUploads } from '@workspace/core/companion-protocol';
import type { CompanionUpload } from './companion-port';

/** Bound native payloads before they reach the encrypted RPC frame. The laptop validates independently. */
export function validPromptUploads(uploads: readonly CompanionUpload[]): boolean {
  if (uploads.length > companionMaxUploads) return false;
  let bytes = 0;
  for (const upload of uploads) {
    if (!['image', 'file'].includes(upload.type) || !upload.name || upload.name.length > 200 || upload.mimeType.length > 120
      || upload.data.length > Math.ceil(companionMaxUploadBytes / 3) * 4 || upload.data.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(upload.data)) return false;
    bytes += upload.data.length / 4 * 3 - (upload.data.endsWith('==') ? 2 : upload.data.endsWith('=') ? 1 : 0);
  }
  return bytes <= companionMaxUploadBytes;
}
