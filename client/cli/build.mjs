import { build } from 'esbuild';
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtinModules } from 'node:module';
import product from '../../core/src/product.json' with { type: 'json' };
import metadata from './package.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function buildCli({ outdir = path.join(root, 'client/cli/dist') } = {}) {
  const result = await build({ absWorkingDir: root, entryPoints: ['client/cli/src/main.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node26',
    outfile: path.join(outdir, 'cli.mjs'), banner: { js: '#!/usr/bin/env node' }, metafile: true, write: false, logLevel: 'silent' });
  const unexpected = Object.keys(result.metafile.inputs).filter(file => file.startsWith('client/electron/') || /(?:^|\/)node_modules\/electron\//u.test(file));
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports).filter(item => !item.path.startsWith('node:') && !builtinModules.includes(item.path));
  if (unexpected.length || imports.length) throw new Error(`CLI bundle cannot require Electron or external runtime dependencies: ${[...unexpected, ...imports.map(item => item.path)].join(', ')}`);
  await mkdir(outdir, { recursive: true });
  for (const output of result.outputFiles) await writeFile(output.path, output.contents);
  await chmod(path.join(outdir, 'cli.mjs'), 0o755);
  await writeFile(path.join(outdir, 'package.json'), JSON.stringify({ name: product.cliPackageName, version: metadata.version, license: 'Apache-2.0', description: `${product.name} standalone diagnostics and terminal control`,
    type: 'module', bin: { [product.slug]: 'cli.mjs' }, engines: { node: '>=26' }, files: ['cli.mjs', 'README.md', 'LICENSE'], repository: { type: 'git', url: product.repositoryUrl } }, null, 2) + '\n');
  await copyFile(path.join(root, 'client/cli/README.md'), path.join(outdir, 'README.md'));
  await copyFile(path.join(root, 'LICENSE'), path.join(outdir, 'LICENSE'));
  return outdir;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const directory = await buildCli();
  if (!process.argv.includes('--quiet')) console.log(`CLI package: ${path.relative(process.cwd(), directory)}`);
}
