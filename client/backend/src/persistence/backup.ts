import { createHash } from 'node:crypto';
import { copyFile, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Copies `source` into `directory` and proves the copy is byte-identical. Any failure
 * throws, so callers can abort before touching anything else.
 */
export async function backupFile(source: string, directory: string, label: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:]/g, '-');
  const target = path.join(directory, `${label}-${stamp}${path.extname(source)}`);
  await copyFile(source, target);
  const handle = await open(target, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const [original, copy] = await Promise.all([readFile(source), readFile(target)]);
  if (original.length !== copy.length || sha256(original) !== sha256(copy)) {
    throw new Error(`Backup verification failed for ${source}; ${target} does not match the original.`);
  }
  return target;
}
