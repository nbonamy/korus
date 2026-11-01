import path from 'node:path';
import type { CompanionFileInput, CompanionFilePreview } from '@workspace/core/companion-files';
import { diffForPath } from '@workspace/core/file-diff';
import type { GatewayPort } from './gateway';

/** Companion response shaping only; the desktop's file and Git services own the reads. */
export async function previewFile(port: GatewayPort, agent: { id: string; folder?: string | null }, input: CompanionFileInput): Promise<CompanionFilePreview> {
  if (!port.previewFile) throw new Error('File previews require an updated desktop.');
  const fsPath = /^[a-z]:[\\/]/iu.test(agent.folder ?? input.path) ? path.win32 : path.posix;
  const relative = agent.folder && fsPath.isAbsolute(input.path) ? fsPath.relative(agent.folder, input.path) : input.path;
  const filePath = relative.replace(/\\/gu, '/').replace(/^\.\//u, '');
  const diffScope = (input.action === 'edit' || input.action === 'create') && input.turnId ? 'turn' : 'uncommitted';
  const [file, patch] = await Promise.allSettled([
    port.previewFile(agent.id, input.path),
    port.gitDiff ? port.gitDiff(agent.id, diffScope === 'turn' ? { type: 'turn', turnId: input.turnId! } : { type: 'uncommitted' }) : Promise.reject(new Error('Unavailable')),
  ]);
  let source = file.status === 'fulfilled' ? file.value : null;
  if (source?.content && Buffer.byteLength(source.content) > 2 * 1024 * 1024) source = { path: filePath, size: source.size, kind: 'tooLarge' };
  if (source) source = { ...source, path: filePath };
  const diff = patch.status === 'fulfilled' ? diffForPath(patch.value.diff, filePath) : null;
  const tooLarge = diff !== null && Buffer.byteLength(diff) > 1024 * 1024;
  return { path: filePath, source, diff: tooLarge ? null : diff, diffScope,
    ...(patch.status === 'rejected' || tooLarge ? { diffUnavailable: true } : {}) };
}
