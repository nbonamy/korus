export function diffForPath(diff: string, filePath: string): string | null {
  const targetPath = normalizePathSeparators(filePath).replace(/^\.\//u, '');
  const sections = diff.split(/(?=^diff --git )/mu).filter((section) => section.startsWith('diff --git '));
  return sections.filter((section) => {
    const header = section.split('\n', 1)[0] ?? '';
    const paths = /^diff --git ("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*"|b\/.*)$/u.exec(header);
    if (!paths) return false;
    return paths.slice(1).some((candidate) => (
      normalizePathSeparators(gitPath(candidate)).replace(/^[ab]\//u, '') === targetPath
    ));
  }).join('') || null;
}

/** Git quotes control characters and UTF-8 bytes in patch headers. */
function gitPath(value: string): string {
  if (!value.startsWith('"')) return value;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const body = value.slice(1, -1);
  for (let index = 0; index < body.length;) {
    if (body[index] === '\\') {
      const octal = /^[0-7]{3}/u.exec(body.slice(index + 1));
      if (octal) { bytes.push(parseInt(octal[0], 8)); index += 4; continue; }
      const escaped = body[++index] ?? '';
      bytes.push(...encoder.encode(({ t: '\t', n: '\n', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v' } as Record<string, string>)[escaped] ?? escaped));
      index++;
    } else {
      const character = String.fromCodePoint(body.codePointAt(index)!);
      bytes.push(...encoder.encode(character)); index += character.length;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function normalizePathSeparators(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}
