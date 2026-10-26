/** What a changed file is for, decided from its path alone so no one has to label files by hand. */
export type FileKind = 'code' | 'test' | 'docs' | 'other';

export const fileKinds: readonly FileKind[] = ['code', 'test', 'docs', 'other'];

export type KindStats = { addedLines: number; removedLines: number; changedFiles: number };
export type KindBreakdown = Record<FileKind, KindStats>;

const generatedDirectories = new Set(['node_modules', 'vendor', 'dist', 'coverage', '__pycache__', '.git', '.next', '.nuxt', '.gradle', '.idea']);
const generatedNames = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'cargo.lock', 'go.sum', 'gemfile.lock', 'composer.lock', 'poetry.lock', 'pipfile.lock', 'bun.lockb']);
const docExtensions = new Set(['md', 'mdx', 'markdown', 'rst', 'adoc', 'asciidoc', 'org']);
const docNames = new Set(['readme', 'changelog', 'changes', 'history', 'license', 'licence', 'copying', 'notice', 'authors', 'contributors', 'contributing', 'code_of_conduct', 'maintainers', 'news']);
const docDirectories = new Set(['docs', 'doc', 'documentation', 'wiki']);
const testDirectories = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'testdata', 'fixtures', '__fixtures__', '__snapshots__', '__mocks__', 'cypress', 'androidtest', 'unittest']);
const typeSuffixExtensions = new Set(['java', 'kt', 'kts', 'scala', 'groovy', 'cs', 'fs', 'vb', 'swift', 'php', 'hs']);
const codeExtensions = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'astro',
  'py', 'pyi', 'java', 'kt', 'kts', 'scala', 'groovy', 'go', 'rs',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'm', 'mm', 'cs', 'fs', 'fsx', 'vb', 'swift',
  'rb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hrl', 'hs', 'ml', 'mli', 'clj', 'cljs', 'cljc', 'elm', 'nim', 'zig', 'sol',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'proto', 'graphql', 'gql',
]);

/** Git prints renames as `old => new` or `dir/{old => new}/file`; keep the new path. */
function currentPath(path: string): string {
  const unquoted = path.trim().replace(/^"(.*)"$/u, '$1').replaceAll('\\', '/');
  const braces = unquoted.replace(/\{[^{}]*? => ([^{}]*)\}/u, '$1').replace(/\/\//gu, '/');
  const arrow = braces.lastIndexOf(' => ');
  return (arrow >= 0 ? braces.slice(arrow + 4) : braces).replace(/^\.\//u, '');
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

function isTestName(name: string, lower: string): boolean {
  if (/^test_.+/u.test(lower) || lower === 'conftest.py') return true;
  if (/(?:_test|_tests|_spec|_unittest)\.[^.]+$/u.test(lower)) return true;
  if (/\.(?:test|tests|spec|cy)\.[^.]+/u.test(lower)) return true;
  const extension = extensionOf(lower);
  if (extension === 'snap' || extension === 'feature') return true;
  if (typeSuffixExtensions.has(extension)) {
    if (/[a-z0-9_](?:Test|Tests|IT|Spec|Specs)\.[a-z]+$/u.test(name)) return true;
    if (/^Test[A-Z]\w*\.[a-z]+$/u.test(name) && extension !== 'hs') return true;
  }
  return false;
}

function isDocumentation(segments: string[], lower: string): boolean {
  const extension = extensionOf(lower);
  const stem = extension ? lower.slice(0, -(extension.length + 1)) : lower;
  if (docExtensions.has(extension) || docNames.has(stem) && (!extension || extension === 'txt')) return true;
  return segments.slice(0, -1).some(segment => docDirectories.has(segment));
}

export function classifyFile(path: string): FileKind {
  const normalized = currentPath(path);
  const segments = normalized.toLowerCase().split('/').filter(Boolean);
  const name = normalized.split('/').filter(Boolean).at(-1) ?? '';
  const lower = name.toLowerCase();
  if (segments.slice(0, -1).some(segment => generatedDirectories.has(segment))) return 'other';
  if (generatedNames.has(lower) || /\.(?:lock|map)$/u.test(lower) || /\.min\.[^.]+$/u.test(lower)) return 'other';
  if (isTestName(name, lower)) return 'test';
  if (isDocumentation(segments, lower)) return 'docs';
  if (segments.slice(0, -1).some(segment => testDirectories.has(segment) || /\.tests?$/u.test(segment))) return 'test';
  if (/\.config\.[^.]+$/u.test(lower) || /^\.(?:eslintrc|prettierrc|babelrc)/u.test(lower)) return 'other';
  return codeExtensions.has(extensionOf(lower)) ? 'code' : 'other';
}

export function emptyKindStats(): KindBreakdown {
  return Object.fromEntries(fileKinds.map(kind => [kind, { addedLines: 0, removedLines: 0, changedFiles: 0 }])) as KindBreakdown;
}

export function addFileToKindStats(stats: KindBreakdown, path: string, addedLines: number, removedLines: number): void {
  const entry = stats[classifyFile(path)];
  entry.addedLines += addedLines;
  entry.removedLines += removedLines;
  entry.changedFiles += 1;
}

export function mergeKindStats(...breakdowns: Array<KindBreakdown | undefined>): KindBreakdown {
  const total = emptyKindStats();
  for (const breakdown of breakdowns) {
    if (!breakdown) continue;
    for (const kind of fileKinds) {
      total[kind].addedLines += breakdown[kind].addedLines;
      total[kind].removedLines += breakdown[kind].removedLines;
      total[kind].changedFiles += breakdown[kind].changedFiles;
    }
  }
  return total;
}
