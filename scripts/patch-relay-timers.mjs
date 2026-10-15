import { readFile, writeFile } from 'node:fs/promises';

// https://github.com/achingbrain/retimeable-signal/issues/27
// Keep reset/clear listener removal symmetric until the dependency ships its repair.
const directory = new URL('../node_modules/retimeable-signal/', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
if (version !== '1.0.1') throw new Error('Revalidate the relay timer repair before changing retimeable-signal.');
for (const file of ['src/index.ts', 'dist/src/index.js']) {
  const url = new URL(file, directory);
  const source = await readFile(url, 'utf8');
  const anonymous = /signal\.addEventListener\('abort', \(\) => \{\s*controller\.abort\(error\);?\s*\}\)/g;
  const matches = [...source.matchAll(anonymous)];
  if (matches.length === 1) {
    await writeFile(url, source.replace(anonymous, "signal.addEventListener('abort', abortHandler)"));
  } else {
    const reset = source.slice(source.indexOf('retimerSignal.reset'), source.indexOf('retimerSignal.clear'));
    if (matches.length || !reset.includes("signal.addEventListener('abort', abortHandler)")) throw new Error(`Unrecognized relay timer implementation in ${file}.`);
  }
}
