import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { tokenize } from '../claude/claude-command-classifier';

const commands = new Set(['status', 'diff', 'show', 'log', 'ls-files', 'ls-tree', 'rev-parse', 'merge-base', 'grep']);
const flags = /^(?:--(?:short|porcelain(?:=v1)?|branch|stat|numstat|name-only|name-status|no-color|no-ext-diff|no-textconv|cached|staged|summary|raw|patch|oneline|root|others|exclude-standard|stage|show-toplevel|show-prefix|verify|is-inside-work-tree|all|abbrev-ref|quiet|end-of-options)|--(?:format|pretty|max-count|unified|diff-filter|find-renames)=[^\r\n]*|-[pnrzswM]|-U\d+|-\d+)$/u;

/** A literal Git invocation, with no shell evaluation, external diff drivers or index refresh writes. */
export function readOnlyGitCommand(command: unknown): string | null {
  if (typeof command !== 'string') return null;
  const tokens = tokenize(command);
  if (!tokens || tokens.shift() !== 'git') return null;
  while (['--no-pager', '--no-optional-locks'].includes(tokens[0] ?? '')) tokens.shift();
  const verb = tokens.shift();
  if (!verb || !commands.has(verb)) return null;
  let paths = false;
  for (const token of tokens) {
    if (token === '--') { paths = true; continue; }
    if (!paths && token.startsWith('-') && !flags.test(token)) return null;
    if (token.includes('\0')) return null;
  }
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return ['git --no-optional-locks --no-pager -c core.fsmonitor=false', verb,
    ...(['diff', 'show', 'log'].includes(verb) ? ['--no-ext-diff', '--no-textconv'] : []),
    ...tokens.map(quote)].join(' ');
}

export async function readOnlyWorkspaceTool(tool: string, input: Record<string, unknown>, cwd: string): Promise<Record<string, unknown> | null> {
  if (tool === 'Bash') {
    const command = readOnlyGitCommand(input.command);
    return command ? { ...input, command } : null;
  }
  if (!['Read', 'Glob', 'Grep'].includes(tool)) return null;
  if (tool === 'Glob' && typeof input.pattern === 'string' && (path.isAbsolute(input.pattern) || input.pattern.split(/[\\/]/u).includes('..'))) return null;
  const value = tool === 'Read' ? input.file_path : input.path ?? cwd;
  if (typeof value !== 'string') return null;
  try {
    const root = await realpath(cwd);
    const target = await realpath(path.resolve(root, value));
    const relative = path.relative(root, target);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? input : null;
  } catch { return null; }
}
