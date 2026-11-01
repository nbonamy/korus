import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { handleAcpFileRequest } from '../filesystem';

it('confines native reads/writes to approved session roots and rejects symlink escapes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'korus-acp-fs-'));
  const cwd = path.join(root, 'workspace');
  await mkdir(cwd);
  await writeFile(path.join(root, 'private'), 'outside');
  await symlink(root, path.join(cwd, 'escape'));
  try {
    await handleAcpFileRequest('fs/write_text_file', { path: path.join(cwd, 'src/example'), content: 'first\nsecond\nthird' }, [cwd]);
    expect(await handleAcpFileRequest('fs/read_text_file', { path: path.join(cwd, 'src/example'), line: 2, limit: 1 }, [cwd])).toEqual({ content: 'second' });
    await expect(handleAcpFileRequest('fs/read_text_file', { path: path.join(cwd, 'escape/private') }, [cwd])).rejects.toThrow('outside');
    await expect(handleAcpFileRequest('fs/write_text_file', { path: path.join(cwd, 'escape/private'), content: 'changed' }, [cwd])).rejects.toThrow('outside');
    expect(await readFile(path.join(root, 'private'), 'utf8')).toBe('outside');
  } finally { await rm(root, { recursive: true, force: true }); }
});
