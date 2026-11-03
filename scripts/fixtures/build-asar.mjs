// Builds a small Electron asar archive in memory: files is { 'dir/name.ext': Buffer | string }.
export function buildAsar(files) {
  const root = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [file, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    let directory = root;
    const parts = file.split('/');
    for (const part of parts.slice(0, -1)) directory = directory.files[part] ??= { files: {} };
    directory.files[parts.at(-1)] = { size: data.length, offset: String(offset) };
    chunks.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(root));
  const aligned = Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(16 + aligned);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(8 + aligned, 4);
  prefix.writeUInt32LE(4 + aligned, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  return Buffer.concat([prefix, ...chunks]);
}
