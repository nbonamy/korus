export type ClassifiedShellCommand =
  | { action: 'read'; files: string[] }
  | { action: 'list'; paths: string[] }
  | { action: 'search'; pattern?: string; paths: string[] };

type FlagSpec = {
  /** Short flag letters that take no value. */
  short: string;
  /** Short flags that consume the next argument unless it is attached (`-A3`). */
  shortValue?: string;
  /** Long flags without a value. */
  long?: string[];
  /** Long flags that consume the next argument unless written `--flag=value`. */
  longValue?: string[];
};

const READ_COMMANDS: Record<string, FlagSpec> = {
  cat: { short: 'AbEnsTvet' },
  head: { short: 'qv', shortValue: 'nc' },
  tail: { short: 'qv', shortValue: 'nc' },
};
const LIST_COMMANDS: Record<string, FlagSpec> = {
  ls: { short: 'aAlhtrSRd1FGLpHiqsfkoOgnU' },
  tree: { short: 'adfilpshugDFqNCnr', shortValue: 'L' },
};
const SEARCH_COMMANDS: Record<string, FlagSpec> = {
  rg: {
    short: 'nilLcvwFEHhsIuUSoqxa',
    shortValue: 'egtTAB' + 'CmM',
    long: ['hidden', 'no-heading', 'files-with-matches', 'line-number', 'ignore-case', 'fixed-strings', 'count', 'no-ignore', 'smart-case', 'with-filename', 'no-filename', 'word-regexp', 'invert-match'],
    longValue: ['glob', 'type', 'max-count', 'regexp', 'after-context', 'before-context', 'context'],
  },
  grep: {
    short: 'rRniIlLcvwFEHhsaoqxPz',
    shortValue: 'emdABC',
    long: ['recursive', 'line-number', 'ignore-case', 'fixed-strings', 'count', 'with-filename', 'no-filename', 'word-regexp', 'invert-match', 'files-with-matches'],
    longValue: ['regexp', 'include', 'exclude', 'exclude-dir', 'max-count', 'after-context', 'before-context', 'context'],
  },
};
const PATTERN_FLAGS = new Set(['-e', '--regexp']);
const FIND_WRITE_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);
const FIND_SEARCH_TESTS = new Set(['-name', '-iname', '-path', '-ipath', '-regex', '-iregex']);

/**
 * Recognizes the simple, read-only shell commands that Codex reports as read,
 * list and search actions so both providers present them alike. Anything with
 * shell syntax (pipes, substitution, redirection, globs) or an unrecognized
 * flag stays a plain run: a wrong summary is worse than a literal command.
 */
export function classifyShellCommand(command: string): ClassifiedShellCommand | null {
  const tokens = tokenize(command);
  const [program, ...args] = tokens ?? [];
  if (!tokens || !program) return null;

  if (READ_COMMANDS[program]) {
    const operands = operandsOf(args, READ_COMMANDS[program]);
    return operands?.positionals.length && operands.positionals.every((file) => file !== '-')
      ? { action: 'read', files: operands.positionals }
      : null;
  }
  if (program === 'sed') return classifySed(args);
  if (LIST_COMMANDS[program]) {
    const operands = operandsOf(args, LIST_COMMANDS[program]);
    return operands ? { action: 'list', paths: operands.positionals.length ? operands.positionals : ['.'] } : null;
  }
  if (SEARCH_COMMANDS[program]) return classifySearch(args, SEARCH_COMMANDS[program]);
  if (program === 'find') return classifyFind(args);
  return null;
}

function classifySed(args: string[]): ClassifiedShellCommand | null {
  const rest = args[0] === '-n' ? args.slice(1) : args;
  const [script, ...files] = rest;
  return script && /^\d+(?:,(?:\d+|\$))?p$/u.test(script) && files.length > 0 && files.every((file) => !file.startsWith('-'))
    ? { action: 'read', files }
    : null;
}

function classifySearch(args: string[], spec: FlagSpec): ClassifiedShellCommand | null {
  const operands = operandsOf(args, spec, PATTERN_FLAGS);
  if (!operands) return null;
  const [positionalPattern, ...positionalPaths] = operands.positionals;
  const pattern = operands.patterns[0] ?? positionalPattern;
  const paths = operands.patterns.length ? operands.positionals : positionalPaths;
  return pattern ? { action: 'search', pattern, paths } : null;
}

function classifyFind(args: string[]): ClassifiedShellCommand | null {
  if (args.some((arg) => FIND_WRITE_ACTIONS.has(arg))) return null;
  const firstExpression = args.findIndex((arg) => arg.startsWith('-') || arg === '!' || arg === '(');
  const paths = (firstExpression === -1 ? args : args.slice(0, firstExpression));
  const test = args.findIndex((arg) => FIND_SEARCH_TESTS.has(arg));
  const pattern = test === -1 ? undefined : args[test + 1];
  const searchPaths = paths.length ? paths : ['.'];
  return pattern ? { action: 'search', pattern, paths: searchPaths } : { action: 'list', paths: searchPaths };
}

type Operands = { positionals: string[]; patterns: string[] };

function operandsOf(args: string[], spec: FlagSpec, patternFlags: ReadonlySet<string> = new Set()): Operands | null {
  const positionals: string[] = [];
  const patterns: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    if (arg.startsWith('--')) {
      const [name = '', ...inline] = arg.split('=');
      const hasInline = inline.length > 0;
      if (spec.long?.includes(name.slice(2)) && !hasInline) continue;
      if (!spec.longValue?.includes(name.slice(2))) return null;
      const value = hasInline ? inline.join('=') : args[++index];
      if (value === undefined) return null;
      if (patternFlags.has(name)) patterns.push(value);
      continue;
    }
    // A short cluster: boolean letters, optionally ending in a value flag.
    for (let letterIndex = 1; letterIndex < arg.length; letterIndex += 1) {
      const letter = arg[letterIndex]!;
      if (spec.short.includes(letter)) continue;
      if (/\d/u.test(letter) && !/\D/u.test(arg.slice(letterIndex))) break;
      if (!spec.shortValue?.includes(letter)) return null;
      const attached = arg.slice(letterIndex + 1);
      const value = attached || args[++index];
      if (value === undefined) return null;
      if (patternFlags.has(`-${letter}`)) patterns.push(value);
      break;
    }
  }
  return { positionals, patterns };
}

const SHELL_SYNTAX = /[|&;<>()`$\\\n\r]/u;
const SHELL_GLOB = /[*?[\]{}~!#]/u;

function tokenize(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else if (quote === '"' && (char === '$' || char === '`' || char === '\\' || char === '\n')) return null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === ' ' || char === '\t') {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else if (SHELL_SYNTAX.test(char) || SHELL_GLOB.test(char)) {
      return null;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) return null;
  if (started) tokens.push(current);
  return tokens;
}
