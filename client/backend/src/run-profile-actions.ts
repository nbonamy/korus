import { open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { RunProfileDiscovery } from '@workspace/core/run-profiles';

const MAX_BYTES = 1024 * 1024;
const MAX_ACTIONS = 200;
const safeName = /^[A-Za-z0-9][A-Za-z0-9_./:-]*$/;
const sources = ['package.json', 'GNUmakefile', 'makefile', 'Makefile', 'justfile', 'Justfile'];

/** Static imports only: never evaluate Make/Just expressions or execute package scripts. */
export async function discoverRunProfileActions(root: string, folder: string): Promise<RunProfileDiscovery> {
  const directory = path.relative(root, folder).split(path.sep).join('/') || '.';
  const result: RunProfileDiscovery = { actions: [], warnings: [] };
  const filenames = new Set(await readdir(folder));
  for (const filename of sources.filter(name => filenames.has(name))) {
    try {
      const resolved = await realpath(path.join(folder, filename));
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error();
      const file = await open(resolved, 'r');
      let content: string;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > MAX_BYTES) throw new Error();
        const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_BYTES + 1));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_BYTES || buffer.subarray(0, bytesRead).includes(0)) throw new Error();
        content = buffer.subarray(0, bytesRead).toString('utf8');
      } finally { await file.close(); }
      let names: string[];
      let command: (name: string) => string;
      if (filename === 'package.json') {
        const pkg = JSON.parse(content) as { scripts?: unknown };
        names = pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
          ? Object.entries(pkg.scripts).filter(([, value]) => typeof value === 'string').map(([name]) => name) : [];
        command = name => `npm run ${name}`;
      } else {
        const isJust = filename.toLowerCase() === 'justfile';
        names = content.split(/\r?\n/).flatMap(line => {
          const match = isJust ? /^([A-Za-z0-9][A-Za-z0-9_-]*)\s*:(?!=)/.exec(line) : /^([A-Za-z0-9_. /-]+)\s*:(?![=:])/.exec(line);
          return match ? match[1].trim().split(/\s+/) : [];
        });
        // Pin the discovered file so Make's filename precedence cannot change the imported action.
        command = name => isJust ? `just --justfile ${filename} ${name}` : `make -f ${filename} ${name}`;
      }
      const source = directory === '.' ? filename : `${directory}/${filename}`;
      for (const name of new Set(names.filter(name => safeName.test(name)))) {
        if (result.actions.length >= MAX_ACTIONS) { result.warnings.push('Import is limited to 200 actions. Choose a narrower working directory.'); return result; }
        result.actions.push({ name, command: command(name), directory, source });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.warnings.push(`Could not import ${filename}. Check that it is a valid text file inside this worktree and no larger than 1 MB.`);
    }
  }
  return result;
}
