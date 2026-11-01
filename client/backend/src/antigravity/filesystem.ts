import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** ACP filesystem calls come from the native process, never from renderer paths. */
export async function handleAcpFileRequest(method: string, params: Record<string, unknown>, roots: string[]): Promise<unknown> {
  if (typeof params.path !== 'string' || !path.isAbsolute(params.path)) throw new Error('ACP requires an absolute file path.');
  if (!['fs/read_text_file', 'fs/write_text_file'].includes(method)) throw new Error('Unsupported ACP client method.');
  const target = path.resolve(params.path);
  let existing = target;
  for (;;) {
    try { await lstat(existing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || existing === path.dirname(existing)) throw error;
      existing = path.dirname(existing);
    }
  }
  const resolved = path.resolve(await realpath(existing), path.relative(existing, target));
  const allowed = await Promise.all(roots.map(root => realpath(root).catch(() => null)));
  if (!allowed.some(root => root && within(root, resolved))) throw new Error('ACP file path is outside this session workspace.');
  if (method === 'fs/write_text_file') {
    if (typeof params.content !== 'string' || Buffer.byteLength(params.content) > 8 * 1024 * 1024) throw new Error('Invalid ACP file content.');
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, params.content, 'utf8');
    return {};
  }
  const content = await readFile(resolved, 'utf8');
  if (Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error('ACP file exceeds the read limit.');
  if (params.line === undefined && params.limit === undefined) return { content };
  const line = params.line ?? 1;
  const limit = params.limit;
  if (!Number.isInteger(line) || (line as number) < 1 || (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1))) throw new Error('Invalid ACP line range.');
  return { content: content.split('\n').slice((line as number) - 1, limit === undefined ? undefined : (line as number) - 1 + (limit as number)).join('\n') };
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
