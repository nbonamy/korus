import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createZip } from './sourcemap-archive.mjs';
import { build } from 'esbuild';
import { createMapResolver, main, symbolicateProfile } from './symbolicate-profile.mjs';

/** A real minified bundle with an external map, and a profile whose frame points at the minified function. */
async function minifiedBundle(directory, bundleName = 'index-ABC123.js') {
  const source = path.join(directory, 'feature.ts');
  writeFileSync(source, 'export function renderMessageActions(items: string[]) {\n  return items.map((item) => item + "!");\n}\n');
  const outfile = path.join(directory, 'assets', bundleName);
  await build({ entryPoints: [source], bundle: true, minify: true, format: 'esm', sourcemap: 'external', outfile, logLevel: 'silent' });
  const code = readFileSync(outfile, 'utf8');
  const match = /function ([\w$]+)\(/.exec(code);
  assert.ok(match, 'the bundle keeps a function declaration');
  return { outfile, minifiedName: match[1], column: match.index + 'function '.length };
}

function profileFor(url, functionName, columnNumber) {
  return {
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 }, children: [2] },
      { id: 2, callFrame: { functionName, scriptId: '1', url, lineNumber: 0, columnNumber }, children: [] },
    ],
    samples: [2, 2, 1],
    timeDeltas: [1000, 3000, 500],
  };
}

test('restores original names and locations from the map that ships beside the bundle', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'symbolicate-'));
  try {
    const { outfile, minifiedName, column } = await minifiedBundle(directory);
    const profile = profileFor(pathToFileURL(outfile).href, minifiedName, column);
    const stats = symbolicateProfile(profile, createMapResolver([directory]));
    const frame = profile.nodes[1].callFrame;
    assert.equal(frame.functionName, 'renderMessageActions');
    assert.match(frame.url, /feature\.ts$/);
    assert.equal(frame.lineNumber, 0);
    assert.deepEqual({ resolved: stats.resolved, total: stats.total, unresolved: stats.unresolved }, { resolved: 1, total: 1, unresolved: [] });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('reads maps out of an app.asar for a file URL inside it, without Electron', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'symbolicate-'));
  try {
    const { outfile, minifiedName, column } = await minifiedBundle(directory);
    const map = readFileSync(`${outfile}.map`);
    const inner = '.vite/renderer/main_window/assets/index-ABC123.js.map';
    const header = Buffer.from(JSON.stringify({ files: { '.vite': { files: { renderer: { files: { main_window: { files: { assets: { files: { 'index-ABC123.js.map': { size: map.length, offset: '0' } } } } } } } } } } }));
    const aligned = Math.ceil(header.length / 4) * 4;
    const prefix = Buffer.alloc(16 + aligned);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(8 + aligned, 4);
    prefix.writeUInt32LE(4 + aligned, 8);
    prefix.writeUInt32LE(header.length, 12);
    header.copy(prefix, 16);
    const archive = path.join(directory, 'app.asar');
    writeFileSync(archive, Buffer.concat([prefix, map]));
    // The profile was recorded against a path that no longer exists on this machine.
    const url = 'file:///Applications/Korus.app/Contents/Resources/app.asar/.vite/renderer/main_window/assets/index-ABC123.js';
    const profile = profileFor(url, minifiedName, column);
    symbolicateProfile(profile, createMapResolver([archive]));
    assert.equal(profile.nodes[1].callFrame.functionName, 'renderMessageActions');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('leaves frames alone and names the bundle when no map matches', () => {
  const profile = profileFor('file:///Applications/Korus.app/Contents/Resources/app.asar/.vite/renderer/main_window/assets/index-OTHER.js', 'e', 10);
  const stats = symbolicateProfile(profile, createMapResolver([]));
  assert.equal(profile.nodes[1].callFrame.functionName, 'e');
  assert.deepEqual(stats.unresolved, [profile.nodes[1].callFrame.url]);
});

test('writes a symbolicated profile and prints where the time went', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'symbolicate-'));
  try {
    const { outfile, minifiedName, column } = await minifiedBundle(directory);
    const input = path.join(directory, 'korus-cpu.cpuprofile');
    writeFileSync(input, JSON.stringify(profileFor(pathToFileURL(outfile).href, minifiedName, column)));
    const lines = [];
    const status = main([input, '--maps', directory, '--top', '3'], (line) => lines.push(line));
    assert.equal(status, 0);
    const written = JSON.parse(readFileSync(path.join(directory, 'korus-cpu.symbolicated.cpuprofile'), 'utf8'));
    assert.equal(written.nodes[1].callFrame.functionName, 'renderMessageActions');
    assert.ok(lines.some((line) => /4\.0\s+renderMessageActions .*feature\.ts:1/.test(line)), lines.join('\n'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('explains usage when no profile is given', () => {
  const lines = [];
  assert.equal(main([], (line) => lines.push(line)), 1);
  assert.match(lines[0], /Usage:/);
});

test('reads maps from a published source map zip, matching the bundle by its hashed name', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'symbolicate-'));
  try {
    const { outfile, minifiedName, column } = await minifiedBundle(directory);
    const archive = path.join(directory, 'korus_linux_x64-sourcemaps.zip');
    writeFileSync(archive, createZip([
      { name: 'sourcemaps.json', data: Buffer.from('{}') },
      { name: 'renderer/main_window/assets/index-OTHER.js.map', data: Buffer.from('{"version":3,"sources":[],"names":[],"mappings":""}') },
      { name: 'renderer/main_window/assets/index-ABC123.js.map', data: readFileSync(`${outfile}.map`) },
    ]));
    const profile = profileFor('file:///Applications/Korus.app/Contents/Resources/app.asar/.vite/renderer/main_window/assets/index-ABC123.js', minifiedName, column);
    symbolicateProfile(profile, createMapResolver([archive]));
    assert.equal(profile.nodes[1].callFrame.functionName, 'renderMessageActions');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('--release fetches the release\'s source map zips and uses the one that matches', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'symbolicate-'));
  try {
    const { outfile, minifiedName, column } = await minifiedBundle(directory);
    const input = path.join(directory, 'korus-cpu-2026.cpuprofile');
    writeFileSync(input, JSON.stringify(profileFor('file:///opt/Korus/resources/app.asar/.vite/renderer/main_window/assets/index-ABC123.js', minifiedName, column)));
    const downloads = [];
    const download = (tag, into) => {
      downloads.push(tag);
      const other = path.join(into, 'korus-win32-x64-sourcemaps.zip');
      writeFileSync(other, createZip([{ name: 'renderer/main_window/assets/index-WIN.js.map', data: Buffer.from('{"version":3,"sources":[],"names":[],"mappings":""}') }]));
      const match = path.join(into, 'korus-linux-x64-sourcemaps.zip');
      writeFileSync(match, createZip([{ name: 'renderer/main_window/assets/index-ABC123.js.map', data: readFileSync(`${outfile}.map`) }]));
      return [other, match];
    };
    const lines = [];
    assert.equal(main([input, '--release', 'v0.50.6', '--top', '2'], (line) => lines.push(line), { download }), 0);
    assert.deepEqual(downloads, ['v0.50.6']);
    assert.match(lines.join('\n'), /renderMessageActions/);
    assert.doesNotMatch(lines.join('\n'), /No source map found/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('suggests the release to fetch from the capture metrics next to the profile', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'symbolicate-'));
  try {
    const input = path.join(directory, 'korus-cpu-2026-11-03T17-27-12.cpuprofile');
    writeFileSync(input, JSON.stringify(profileFor('file:///opt/Korus/resources/app.asar/.vite/renderer/main_window/assets/index-NOPE.js', 'e', 10)));
    writeFileSync(path.join(directory, 'korus-metrics-2026-11-03T17-27-12.json'), JSON.stringify({ appVersion: '0.50.6' }));
    const lines = [];
    main([input], (line) => lines.push(line));
    assert.match(lines.join('\n'), /recorded on Korus 0\.50\.6.*--release v0\.50\.6/i);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
