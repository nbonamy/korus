#!/usr/bin/env node
// Turns a minified renderer CPU profile (Help > Capture Performance Profile) back into readable function
// names and source locations using the source maps that ship with the same build.
//
//   node scripts/symbolicate-profile.mjs <profile.cpuprofile> [--release <tag>] [--maps <dir | app.asar | Korus.app | *-sourcemaps.zip>]... [--out <file>] [--top <n>]
//
// Bundle file names carry a content hash, so a map can only match the exact build that produced the profile,
// and renderer bundles differ between macOS, Windows and Linux. Releases publish one source map zip per target
// (korus_<platform>_<arch>-sourcemaps.zip). --release downloads them all with gh and picks the one whose hash matches.
// Without --maps or --release the script reads the maps from the app.asar the profile was recorded against,
// which works when that build is installed on this Mac.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import product from '../core/src/product.json' with { type: 'json' };
import { readAsar, readZip } from './sourcemap-archive.mjs';

const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes a source map `mappings` string into, per generated line, segments of [column, source, line, column, name?]. */
export function decodeMappings(mappings) {
  const lines = [];
  let source = 0;
  let line = 0;
  let column = 0;
  let name = 0;
  for (const encodedLine of mappings.split(';')) {
    const segments = [];
    let generated = 0;
    for (const encoded of encodedLine.split(',')) {
      if (!encoded) continue;
      const fields = [];
      let value = 0;
      let shift = 0;
      for (const character of encoded) {
        const digit = base64.indexOf(character);
        value |= (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
          continue;
        }
        fields.push(value & 1 ? -(value >> 1) : value >> 1);
        value = 0;
        shift = 0;
      }
      generated += fields[0];
      if (fields.length < 4) continue;
      source += fields[1];
      line += fields[2];
      column += fields[3];
      if (fields.length > 4) name += fields[4];
      segments.push(fields.length > 4 ? [generated, source, line, column, name] : [generated, source, line, column]);
    }
    lines.push(segments);
  }
  return lines;
}

export class SourceMap {
  constructor(json) {
    this.sources = json.sources ?? [];
    this.sourcesContent = json.sourcesContent ?? [];
    this.names = json.names ?? [];
    this.lines = decodeMappings(json.mappings ?? '');
  }

  /** Positions are zero-based, like V8 call frames. */
  originalPositionFor(line, column) {
    const segments = this.lines[line];
    if (!segments?.length) return null;
    let low = 0;
    let high = segments.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (segments[middle][0] <= column) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (found < 0) return null;
    const [, source, sourceLine, sourceColumn, name] = segments[found];
    return {
      source: this.sources[source],
      line: sourceLine,
      column: sourceColumn,
      name: name === undefined ? undefined : this.names[name],
      text: this.sourcesContent[source]?.split('\n')[sourceLine],
    };
  }
}

function walk(directory, depth = 0, found = new Map()) {
  if (depth > 8) return found;
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, depth + 1, found);
    else if (name.endsWith('.map') && !found.has(name)) found.set(name, full);
  }
  return found;
}

/** Finds the source map for a profile URL in the given directories, archives or app bundles. */
export function createMapResolver(mapSources = []) {
  const cache = new Map();
  const directories = new Map();
  const zips = new Map();
  const bundleName = (url) => decodeURIComponent(url.split(/[?#]/)[0]).split('/').at(-1);
  const fromSource = (source, url) => {
    const name = `${bundleName(url)}.map`;
    const asar = source.endsWith('.app') ? path.join(source, 'Contents/Resources/app.asar') : source;
    if (asar.endsWith('.zip')) {
      if (!zips.has(asar)) zips.set(asar, existsSync(asar) ? readZip(readFileSync(asar)) : null);
      const zip = zips.get(asar);
      const entry = zip?.names.find((candidate) => candidate.split('/').at(-1) === name);
      return entry ? JSON.parse(zip.read(entry).toString('utf8')) : null;
    }
    if (asar.endsWith('.asar')) {
      const inner = url.startsWith('file:') ? fileURLToPath(url).split('.asar/')[1] : undefined;
      for (const candidate of inner ? [`${inner}.map`] : []) {
        const content = existsSync(asar) ? readAsar(asar, candidate) : null;
        if (content) return JSON.parse(content.toString('utf8'));
      }
      return null;
    }
    if (!existsSync(source)) return null;
    if (!directories.has(source)) directories.set(source, walk(source));
    const file = directories.get(source).get(name);
    return file ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  return (url) => {
    if (!url || /^(node:|chrome|devtools)/.test(url)) return null;
    if (!cache.has(url)) {
      let map = null;
      const sources = [...mapSources];
      if (url.startsWith('file:')) {
        const local = fileURLToPath(url);
        const index = local.indexOf('.asar/');
        if (index >= 0) sources.push(local.slice(0, index + 5));
      }
      for (const source of sources) {
        map = fromSource(source, url);
        if (map) break;
      }
      cache.set(url, map ? new SourceMap(map) : null);
    }
    return cache.get(url);
  };
}

function guessFunctionName(text) {
  if (!text) return undefined;
  const patterns = [
    /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
    /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/,
    /^\s*(?:async\s+|get\s+|set\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

function cleanSource(source) {
  const normalized = path.posix.normalize(source.replaceAll('\\', '/'));
  return normalized.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
}

const looksMinified = (name) => !name || name.length <= 3;

/** Rewrites call frames in place to original names and locations. Returns counts and the URLs it had no map for. */
export function symbolicateProfile(profile, resolveMap) {
  const unresolved = new Set();
  let resolved = 0;
  let total = 0;
  for (const node of profile.nodes) {
    const frame = node.callFrame;
    const map = resolveMap(frame.url);
    if (!map) {
      if (frame.url && !/^(node:|chrome|devtools)/.test(frame.url)) unresolved.add(frame.url);
      continue;
    }
    total += 1;
    const position = map.originalPositionFor(frame.lineNumber, frame.columnNumber);
    if (!position?.source) continue;
    resolved += 1;
    const guessed = position.name ?? (looksMinified(frame.functionName) ? guessFunctionName(position.text) : undefined);
    frame.functionName = guessed ?? frame.functionName;
    frame.url = cleanSource(position.source);
    frame.lineNumber = position.line;
    frame.columnNumber = position.column;
  }
  return { resolved, total, unresolved: [...unresolved] };
}

/** Self and inclusive time per function, in milliseconds, longest first. */
export function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const selfTime = new Map();
  profile.samples.forEach((id, index) => selfTime.set(id, (selfTime.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0)));
  const label = (id) => {
    const frame = nodes.get(id).callFrame;
    const file = frame.url.split('/').slice(-2).join('/');
    return `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}`;
  };
  const self = new Map();
  const inclusive = new Map();
  for (const [id, time] of selfTime) {
    const name = label(id);
    self.set(name, (self.get(name) ?? 0) + time);
    const seen = new Set();
    for (let current = id; current !== undefined; current = parents.get(current)) {
      const currentName = label(current);
      if (seen.has(currentName)) continue;
      seen.add(currentName);
      inclusive.set(currentName, (inclusive.get(currentName) ?? 0) + time);
    }
  }
  const ranked = (entries) => [...entries].map(([name, time]) => ({ name, ms: time / 1000 })).sort((a, b) => b.ms - a.ms);
  return { self: ranked(self), inclusive: ranked(inclusive) };
}

function parseArguments(argv) {
  const options = { maps: [], top: 15 };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--maps') options.maps.push(argv[++index]);
    else if (argument === '--release') options.release = argv[++index];
    else if (argument === '--out') options.out = argv[++index];
    else if (argument === '--top') options.top = Number(argv[++index]);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else positional.push(argument);
  }
  options.input = positional[0];
  return options;
}

function downloadReleaseMaps(tag, directory) {
  execFileSync('gh', ['release', 'download', tag, '--repo', product.repository, '--pattern', '*-sourcemaps.zip', '--dir', directory, '--clobber'], { stdio: ['ignore', 'inherit', 'inherit'] });
  return readdirSync(directory).filter((name) => name.endsWith('-sourcemaps.zip')).map((name) => path.join(directory, name));
}

/** The release a capture belongs to, from the metrics file written beside it. */
function recordedVersion(input) {
  const metrics = path.join(path.dirname(input), path.basename(input).replace(/^(.*)-cpu-/, '$1-metrics-').replace(/\.cpuprofile$/, '.json'));
  try { return JSON.parse(readFileSync(metrics, 'utf8')).appVersion; } catch { return undefined; }
}

export function main(argv, log = console.log, { download = downloadReleaseMaps } = {}) {
  const options = parseArguments(argv);
  if (options.help || !options.input) {
    log('Usage: node scripts/symbolicate-profile.mjs <profile.cpuprofile> [--release <tag>] [--maps <dir | app.asar | Korus.app | *-sourcemaps.zip>]... [--out <file>] [--top <n>]');
    return options.help ? 0 : 1;
  }
  const profile = JSON.parse(readFileSync(options.input, 'utf8'));
  const maps = [...options.maps];
  if (options.release) maps.push(...download(options.release, mkdtempSync(path.join(os.tmpdir(), 'korus-sourcemaps-'))));
  const stats = symbolicateProfile(profile, createMapResolver(maps));
  const out = options.out ?? options.input.replace(/\.cpuprofile$/, '') + '.symbolicated.cpuprofile';
  writeFileSync(out, JSON.stringify(profile));
  log(`Symbolicated ${stats.resolved} of ${stats.total} frames with a source map -> ${out}`);
  const version = recordedVersion(options.input);
  for (const url of stats.unresolved) log(`No source map found for ${url} (use --release <tag> or --maps with the matching build)`);
  if (stats.unresolved.length > 0 && version && !options.release) log(`This profile was recorded on Korus ${version}: try --release v${version}`);
  const summary = summarizeProfile(profile);
  const skip = (entry) => /^\((idle|program|root|garbage collector)\)/.test(entry.name);
  for (const [title, entries] of [['Self time', summary.self], ['Inclusive time', summary.inclusive]]) {
    log(`\n${title} (ms)`);
    for (const entry of entries.filter((candidate) => !skip(candidate)).slice(0, options.top)) log(`${entry.ms.toFixed(1).padStart(9)}  ${entry.name}`);
  }
  return stats.unresolved.length > 0 && stats.resolved === 0 ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
