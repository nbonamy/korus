import { appApi } from './platform-api';

/** Read bounded backend frames, including remote agents, then use the host's download flow. */
export async function downloadAgentFile(agentId: string, filePath: string): Promise<void> {
  if (!appApi) throw new Error('File downloads are unavailable.');
  const parts: ArrayBuffer[] = [];
  let offset = 0;
  let size: number | undefined;
  do {
    const chunk = await appApi.readAgentFileChunk(agentId, filePath, offset);
    if (size !== undefined && chunk.size !== size) throw new Error('File changed while downloading. Try again.');
    size = chunk.size;
    const bytes = Uint8Array.from(atob(chunk.data), character => character.charCodeAt(0));
    if (chunk.nextOffset !== offset + bytes.length || (bytes.length === 0 && offset < size)) {
      throw new Error('File download stopped before completion.');
    }
    parts.push(bytes.buffer);
    offset = chunk.nextOffset;
  } while (offset < size);

  const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filePath.split(/[\\/]/u).at(-1) || 'download';
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    // Leave time for the browser/Electron download manager to accept the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
