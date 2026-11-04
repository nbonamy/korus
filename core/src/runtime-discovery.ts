import { execFileSync as nodeExecFileSync } from 'node:child_process';
import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync, readdirSync as nodeReaddirSync } from 'node:fs';
import { homedir as nodeHomedir } from 'node:os';
import path from 'node:path';
import { product } from './product';

type ExecFileSync = (
  file: string,
  args: string[],
  options?: { encoding?: BufferEncoding; env?: NodeJS.ProcessEnv; stdio?: 'ignore' | 'pipe'; timeout?: number },
) => string | Buffer;

export type RuntimeDiscoveryDependencies = {
  env?: NodeJS.ProcessEnv;
  execFileSync?: ExecFileSync;
  existsSync?: (filePath: string) => boolean;
  homedir?: () => string;
  pathDelimiter?: string;
  platform?: NodeJS.Platform;
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string;
  readdirSync?: (dirPath: string) => string[];
  shell?: string;
};

/**
 * Engines a host links into the private bin (see the remote engine links). A linked engine is found with
 * one file check; every other tool, and any engine without a working link, goes through full discovery.
 */
export const privateBinEngines = ['codex', 'claude'] as const;

function privateBinDirectory(dependencies: RuntimeDiscoveryDependencies): string {
  return path.join(homeDir(dependencies), product.homeDirectory, 'bin');
}

function linkedEngine(executable: string, dependencies: RuntimeDiscoveryDependencies): string | null {
  if ((dependencies.platform ?? process.platform) === 'win32') return null;
  const bin = privateBinDirectory(dependencies);
  // Detection hands launches the absolute path it already resolved, so that form counts as linked too.
  const name = path.isAbsolute(executable) && path.dirname(executable) === bin ? path.basename(executable) : executable.trim();
  if (!(privateBinEngines as readonly string[]).includes(name)) return null;
  const linked = path.join(bin, name);
  return executableExists(linked, dependencies) ? linked : null;
}

export function discoveredRuntimePath(dependencies: RuntimeDiscoveryDependencies = {}): string {
  return discoveredRuntimePathEntries(dependencies).join(pathDelimiter(dependencies));
}

export function discoveredRuntimePathEntries(dependencies: RuntimeDiscoveryDependencies = {}): string[] {
  const delimiter = pathDelimiter(dependencies);
  const env = dependencies.env ?? process.env;
  const entries = [
    // GUI/daemon PATH can contain an older nvm selection or private app runtime.
    // The user's login shell is authoritative; inherited entries are fallbacks.
    ...pathEntries(loginShellPath(dependencies), delimiter),
    ...pathEntries(env.PATH, delimiter),
    ...commonUserBinaryPaths(dependencies),
    ...nvmBinaryPaths(dependencies),
  ];

  return unique(entries);
}

export function withDiscoveredRuntimePath(
  env: NodeJS.ProcessEnv | undefined,
  dependencies: RuntimeDiscoveryDependencies = {},
): NodeJS.ProcessEnv {
  const mergedEnv = {
    ...process.env,
    ...env,
  };

  return {
    ...mergedEnv,
    PATH: discoveredRuntimePath({
      ...dependencies,
      env: mergedEnv,
    }),
  };
}

export function resolveRuntimeExecutable(
  executable: string,
  dependencies: RuntimeDiscoveryDependencies = {},
): string | null {
  return linkedEngine(executable, dependencies)
    ?? executableFromPath(executable, () => discoveredRuntimePathEntries(dependencies), dependencies);
}

/** Resolve a provider and its child-process environment from one PATH snapshot. */
export function resolveRuntimeLaunch(
  command: string,
  overrides?: NodeJS.ProcessEnv,
  dependencies: RuntimeDiscoveryDependencies = {},
): { command: string; env: NodeJS.ProcessEnv } {
  const executable = command.trim();
  const linked = linkedEngine(executable, dependencies);
  if (linked) {
    // The inherited PATH is already explicit where engines are linked, so no login shell is consulted.
    const merged = { ...process.env, ...overrides };
    const delimiter = pathDelimiter(dependencies);
    const inherited = (dependencies.env ?? merged).PATH ?? merged.PATH;
    return { command: linked, env: { ...merged, PATH: unique([privateBinDirectory(dependencies), ...pathEntries(inherited, delimiter)]).join(delimiter) } };
  }
  const env = withDiscoveredRuntimePath(overrides, dependencies);
  return {
    command: executableFromPath(executable, () => pathEntries(env.PATH, pathDelimiter(dependencies)), { ...dependencies, env }) ?? executable,
    env,
  };
}

function executableFromPath(
  executable: string,
  entries: () => string[],
  dependencies: RuntimeDiscoveryDependencies,
): string | null {
  if (path.isAbsolute(executable)) {
    return executableExists(executable, dependencies) ? executable : null;
  }

  const candidates = executableCandidates(executable, dependencies);
  for (const entry of entries()) {
    for (const candidate of candidates) {
      const filePath = path.join(entry, candidate);
      if (executableExists(filePath, dependencies)) {
        return filePath;
      }
    }
  }

  return null;
}

const pathStart = '__APP_RUNTIME_PATH_START__';
const pathEnd = '__APP_RUNTIME_PATH_END__';
const nvmStart = '__APP_RUNTIME_NVM_START__';
const nvmEnd = '__APP_RUNTIME_NVM_END__';

/** What one login shell reports: its PATH and the node `nvm which current` names. Either is null when unavailable. */
type LoginShellProbe = { path: string | null; nvmNode: string | null };

/**
 * A login shell takes a second or more to start, and every launch lookup needs the same answer, so the answer is
 * kept for a few minutes. Environment changes (a new nvm default, a fresh install) show up on expiry, or at once when
 * the cache is cleared by an explicit re-detection.
 */
const probeLifetimeMs = 5 * 60_000;
let probeGeneration = 0;
const probesByShellRunner = new WeakMap<ExecFileSync, Map<string, { generation: number; at: number; probe: LoginShellProbe }>>();

/** Forget the remembered login-shell answers, so the next lookup asks the shell again. */
export function clearRuntimeDiscoveryCache(): void {
  probeGeneration += 1;
}

function loginShellProbe(dependencies: RuntimeDiscoveryDependencies): LoginShellProbe {
  if ((dependencies.platform ?? process.platform) === 'win32') {
    return { path: null, nvmNode: null };
  }

  const shell = dependencies.shell ?? dependencies.env?.SHELL ?? process.env.SHELL ?? '/bin/bash';
  const env = dependencies.env ?? process.env;
  const execFileSync = dependencies.execFileSync ?? nodeExecFileSync;
  const key = `${shell}\n${homeDir(dependencies)}`;
  let remembered = probesByShellRunner.get(execFileSync);
  if (!remembered) {
    remembered = new Map();
    probesByShellRunner.set(execFileSync, remembered);
  }
  const known = remembered.get(key);
  if (known && known.generation === probeGeneration && Date.now() - known.at < probeLifetimeMs) {
    return known.probe;
  }

  const probe = askLoginShell(shell, env, execFileSync);
  remembered.set(key, { generation: probeGeneration, at: Date.now(), probe });
  return probe;
}

/** One login shell for both answers. Nushell has no nvm, so it is only asked for its PATH. */
function askLoginShell(shell: string, env: NodeJS.ProcessEnv, execFileSync: ExecFileSync): LoginShellProbe {
  const nushell = shell.endsWith('/nu') || shell === 'nu';
  const command = nushell
    ? `print '${pathStart}'; print ($env.PATH | str join ':'); print '${pathEnd}'`
    : `printf '${pathStart}%s${pathEnd}' "$PATH"; printf '${nvmStart}%s${nvmEnd}' "$(nvm which current 2>/dev/null)"`;
  try {
    const output = execFileSync(shell, ['-l', '-c', command], {
      encoding: 'utf8',
      env,
      stdio: 'pipe',
      timeout: 5_000,
    }).toString();
    return { path: between(output, pathStart, pathEnd), nvmNode: between(output, nvmStart, nvmEnd) };
  } catch {
    return { path: null, nvmNode: null };
  }
}

/** The text between the last start marker and its end marker; shell startup output around them is ignored. */
function between(output: string, start: string, end: string): string | null {
  const from = output.lastIndexOf(start);
  const to = output.indexOf(end, from + start.length);
  return from >= 0 && to >= 0 ? output.slice(from + start.length, to).trim() : null;
}

function loginShellPath(dependencies: RuntimeDiscoveryDependencies): string | null {
  return loginShellProbe(dependencies).path;
}

function commonUserBinaryPaths(dependencies: RuntimeDiscoveryDependencies): string[] {
  if ((dependencies.platform ?? process.platform) === 'win32') {
    return [];
  }

  const home = homeDir(dependencies);
  return [
    path.join(home, '.local/bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].filter((entry) => executableExists(entry, dependencies));
}

function nvmBinaryPaths(dependencies: RuntimeDiscoveryDependencies): string[] {
  if ((dependencies.platform ?? process.platform) === 'win32') {
    return [];
  }

  return unique([
    nvmBinaryPathFromCommand(dependencies),
    nvmBinaryPathFromFiles(dependencies),
  ].filter((entry): entry is string => Boolean(entry)));
}

function nvmBinaryPathFromCommand(dependencies: RuntimeDiscoveryDependencies): string | null {
  const nodePath = loginShellProbe(dependencies).nvmNode;
  return nodePath && executableExists(nodePath, dependencies) ? path.dirname(nodePath) : null;
}

function nvmBinaryPathFromFiles(dependencies: RuntimeDiscoveryDependencies): string | null {
  const home = homeDir(dependencies);
  const aliasPath = path.join(home, '.nvm/alias/default');
  const versionsPath = path.join(home, '.nvm/versions/node');
  if (!executableExists(aliasPath, dependencies) || !executableExists(versionsPath, dependencies)) {
    return null;
  }

  const readFileSync = dependencies.readFileSync ?? nodeReadFileSync;
  const readdirSync = dependencies.readdirSync ?? nodeReaddirSync;
  try {
    let current = readFileSync(aliasPath, 'utf8').trim();
    if (!current) {
      return null;
    }
    if (!current.startsWith('v')) {
      current = `v${current}`;
    }

    const best = readdirSync(versionsPath)
      .filter((version) => version === current || version.startsWith(current))
      .sort()
      .at(-1);
    return best ? path.join(versionsPath, best, 'bin') : null;
  } catch {
    return null;
  }
}

function executableCandidates(executable: string, dependencies: RuntimeDiscoveryDependencies): string[] {
  if ((dependencies.platform ?? process.platform) !== 'win32' || path.extname(executable)) {
    return [executable];
  }

  const pathExt = dependencies.env?.PATHEXT ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
  return [
    executable,
    ...pathExt.split(';').filter(Boolean).map((extension) => `${executable}${extension.toLowerCase()}`),
  ];
}

function pathEntries(value: string | undefined | null, delimiter: string): string[] {
  return value
    ? value.split(delimiter).map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function unique(entries: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function executableExists(filePath: string, dependencies: RuntimeDiscoveryDependencies): boolean {
  return (dependencies.existsSync ?? nodeExistsSync)(filePath);
}

function homeDir(dependencies: RuntimeDiscoveryDependencies): string {
  return dependencies.homedir?.() ?? dependencies.env?.HOME ?? process.env.HOME ?? nodeHomedir();
}

function pathDelimiter(dependencies: RuntimeDiscoveryDependencies): string {
  return dependencies.pathDelimiter ?? path.delimiter;
}
