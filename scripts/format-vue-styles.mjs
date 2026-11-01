import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import prettier from 'prettier';

const sourceRoot = resolve('client/vue/src');
const checkOnly = process.argv.includes('--check');
const styleBlockPattern = /(<style(?:\s[^>]*)?>)([\s\S]*?)(<\/style>)/g;

const files = await vueFiles(sourceRoot);
const changedFiles = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const formatted = await formatStyleBlocks(source);
  if (formatted === source) continue;

  changedFiles.push(file);
  if (!checkOnly) await writeFile(file, formatted);
}

if (changedFiles.length > 0) {
  console.error(`${checkOnly ? 'Unformatted' : 'Formatted'} Vue style blocks:`);
  for (const file of changedFiles) console.error(`  ${file}`);
}

if (checkOnly && changedFiles.length > 0) process.exitCode = 1;

async function vueFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return vueFiles(path);
    return entry.isFile() && entry.name.endsWith('.vue') ? [path] : [];
  }));
  return files.flat();
}

async function formatStyleBlocks(source) {
  let output = '';
  let lastIndex = 0;

  for (const match of source.matchAll(styleBlockPattern)) {
    const [block, openingTag, css, closingTag] = match;
    output += source.slice(lastIndex, match.index);
    const formattedCss = await prettier.format(css.trim(), { parser: 'css' });
    output += `${openingTag}\n${spaceSelectorScopes(formattedCss)}${closingTag}`;
    lastIndex = (match.index ?? 0) + block.length;
  }

  return output + source.slice(lastIndex);
}

function spaceSelectorScopes(css) {
  return css.replace(/}\n(?=[^\s}])/g, '}\n\n');
}
