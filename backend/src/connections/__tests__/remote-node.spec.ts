import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { remoteNodeInstallCommand } from '../remote-node';

const exec = promisify(execFile);

// A bare SSH shell can lack Node, fetch corrupt bytes, or repeat setup after an update.
// Run the generated installer with a real archive/filesystem; only the download is faked.
describe('remote Node bootstrap', () => {
  it.each([false, true])('verifies the download before activation (corrupt=%s)', async (corrupt) => {
    const home = await mkdtemp(path.join(tmpdir(), 'korus-ssh-node-'));
    try {
      const tools = path.join(home, 'tools');
      const directory = 'node-v26.12.1-linux-x64';
      await mkdir(path.join(home, directory, 'bin'), { recursive: true });
      await mkdir(tools);
      await writeFile(path.join(home, directory, 'bin/node'), '#!/bin/sh\nprintf "v26.12.1\\n"\n', { mode: 0o755 });
      const archive = path.join(home, 'runtime.tar.gz');
      await exec('tar', ['-czf', archive, '-C', home, directory]);
      const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
      await writeFile(path.join(tools, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n', { mode: 0o755 });
      await writeFile(path.join(tools, 'curl'), '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\ncp "$FIXTURE_ARCHIVE" "$2"\nprintf x >> "$HOME/downloads"\n', { mode: 0o755 });
      const config = { version: '26.12.1', checksums: { 'linux-x64': corrupt ? '0'.repeat(64) : digest } };
      const run = () => exec('sh', ['-c', remoteNodeInstallCommand(config)], { env: { ...process.env, HOME: home, PATH: `${tools}:/usr/bin:/bin`, FIXTURE_ARCHIVE: archive } });
      if (corrupt) {
        await expect(run()).rejects.toThrow(/checksum/i);
        await expect(readFile(path.join(home, '.korus/bin/node'))).rejects.toThrow();
      } else {
        await run();
        const node = path.join(home, '.korus/bin/node');
        await chmod(node, 0o755);
        expect((await exec(node, ['--version'])).stdout.trim()).toBe('v26.12.1');
        await run();
        expect(await readFile(path.join(home, 'downloads'), 'utf8')).toBe('x');
      }
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
