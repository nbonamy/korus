import { randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/** Save on the agent's host. Exclusive creation protects against overwrite races. */
export async function saveMarkdownFile(folder: string | undefined, filePath: string, content: string, overwrite: boolean, protectedHome: string): Promise<string> {
  if (!filePath.trim() || !/\.(md|markdown)$/iu.test(filePath) || filePath.includes('\0')) throw new Error('Choose a Markdown filename (.md).');
  if (!path.isAbsolute(filePath) && !folder) throw new Error('This session does not have a project workspace.');
  const target = path.resolve(folder ?? '.', filePath);
  const parent = await realpath(path.dirname(target));
  const resolved = path.join(parent, path.basename(target));
  const home = await realpath(protectedHome).catch(() => path.resolve(protectedHome));
  if (resolved === home || resolved.startsWith(`${home}${path.sep}`)) throw new Error('Choose a location outside application data.');
  const existing = await lstat(resolved).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Choose a regular file, not a directory or symbolic link.');
  if (existing && !overwrite) throw new Error('File already exists. Confirm replacement to save.');
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', existing?.mode ?? 0o600);
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
    if (overwrite) await rename(temporary, resolved);
    else await createExclusively(temporary, resolved, content);
  } finally { await rm(temporary, { force: true }); }
  return resolved;
}

/** Hard links give atomic exclusive creation; volumes without them fall back to exclusive open. */
async function createExclusively(temporary: string, resolved: string, content: string): Promise<void> {
  try { await link(temporary, resolved); }
  catch (error) {
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    const file = await open(resolved, 'wx', 0o600);
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
  }
}
