// Source map archives for releases: reads the maps that ship inside a packaged app.asar and bundles them
// into a small zip that is published beside the installers, so a profile can be symbolicated without
// downloading an installer. Zip and asar are handled here directly to avoid extra dependencies.
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function readExactly(descriptor, length, position) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = readSync(descriptor, buffer, read, length - read, position + read);
    if (count === 0) throw new Error('Unexpected end of file.');
    read += count;
  }
  return buffer;
}

function asarHeader(descriptor) {
  const prefix = readExactly(descriptor, 16, 0);
  const headerSize = prefix.readUInt32LE(4);
  const jsonLength = prefix.readUInt32LE(12);
  const header = JSON.parse(readExactly(descriptor, jsonLength, 16).toString('utf8'));
  return { header, dataStart: 8 + headerSize };
}

/** Reads one file out of an Electron asar archive without Electron. Returns null when it is not in the archive. */
export function readAsar(archivePath, innerPath) {
  const descriptor = openSync(archivePath, 'r');
  try {
    const { header, dataStart } = asarHeader(descriptor);
    let entry = header;
    for (const part of innerPath.split('/').filter(Boolean)) {
      entry = entry.files?.[part];
      if (!entry) return null;
    }
    if (entry.offset === undefined) return null;
    return readExactly(descriptor, entry.size, dataStart + Number(entry.offset));
  } finally { closeSync(descriptor); }
}

/** Lists the paths of packed files in an asar archive that satisfy the predicate. */
export function listAsar(archivePath, predicate = () => true) {
  const descriptor = openSync(archivePath, 'r');
  try {
    const found = [];
    const visit = (directory, prefix) => {
      for (const [name, entry] of Object.entries(directory.files ?? {})) {
        const inner = prefix ? `${prefix}/${name}` : name;
        if (entry.files) visit(entry, inner);
        else if (entry.offset !== undefined && predicate(inner)) found.push(inner);
      }
    };
    visit(asarHeader(descriptor).header, '');
    return found;
  } finally { closeSync(descriptor); }
}

const dosDate = (1 << 5) | 1; // 1980-01-01, so archives of the same maps are byte-identical

/** Writes a zip from [{ name, data }]. */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 26);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Reads a zip made by createZip (or any plain, non-zip64 archive): { names, read(name) }. */
export function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('Not a zip archive.');
  const count = buffer.readUInt16LE(end + 10);
  let position = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const local = buffer.readUInt32LE(position + 42);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    entries.set(name, { method, compressedSize, local });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const start = entry.local + 30 + buffer.readUInt16LE(entry.local + 26) + buffer.readUInt16LE(entry.local + 28);
      const data = buffer.subarray(start, start + entry.compressedSize);
      return entry.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    },
  };
}

/** Finds the packaged app.asar under Forge's output directory, ignoring installers in make/. */
export function findPackagedAsar(directory) {
  const visit = (current, depth) => {
    if (depth > 6) return null;
    for (const entry of readdirSync(current).sort()) {
      if (entry === 'make') continue;
      const full = path.join(current, entry);
      if (entry === 'app.asar' && statSync(full).isFile()) return full;
      if (statSync(full).isDirectory()) {
        const found = visit(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(directory, 0);
}

/** Bundles the .vite/**.map files that ship in an app.asar, plus a manifest, into one zip. */
export function sourcemapZip({ asarPath, version, target }) {
  const names = listAsar(asarPath, (inner) => inner.startsWith('.vite/') && inner.endsWith('.map'));
  if (names.length === 0) throw new Error(`No source maps found in ${asarPath}.`);
  const entries = names.sort().map((name) => ({ name: name.slice('.vite/'.length), data: readAsar(asarPath, name) }));
  const manifest = { version, target, maps: entries.map(({ name, data }) => ({ name, bytes: data.length })) };
  return createZip([{ name: 'sourcemaps.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...entries]);
}
