import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// cross-zip 4.0.1 uses recursive rmdir before Windows ZIP creation, removed in
// Node 26. Repair only Forge's installed dependency, without changing global fs.
const require = createRequire(new URL('../electron/package.json', import.meta.url));
const makerRequire = createRequire(require.resolve('@electron-forge/maker-zip'));
const file = makerRequire.resolve('cross-zip');
const { version } = JSON.parse(await readFile(path.join(path.dirname(file), 'package.json'), 'utf8'));
if (version !== '4.0.1') throw new Error('Revalidate the Windows ZIP repair before changing cross-zip.');
const before = 'fs.rmdir(outPath, { recursive: true, maxRetries: 3 }, doZip2)';
const after = 'fs.rm(outPath, { recursive: true, force: true, maxRetries: 3 }, doZip2)';
const source = await readFile(file, 'utf8');
if (source.split(before).length === 2) {
  await writeFile(file, source.replace(before, after));
} else if (!source.includes(after) || source.includes(before)) {
  throw new Error('Unrecognized cross-zip implementation; revalidate the Windows ZIP repair.');
}
