import { execFile, spawn } from 'node:child_process';
import { constants as osConstants, homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { product } from '@workspace/core/product';
import { configuredAppHome } from '@workspace/core/app-home';

type CommandResult = { stdout: string; stderr: string };
export type CliContext = {
  env: NodeJS.ProcessEnv; userHome: string; cwd: string; platform: NodeJS.Platform; interactive: boolean; signal?: AbortSignal;
  write(text: string): void; out(text: string): void; err(text: string): void; ask(question: string): Promise<string>; now(): Date;
  exec(file: string, args: string[], options?: { timeout?: number; env?: NodeJS.ProcessEnv }): Promise<CommandResult>;
  launch(file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<number>;
};
export type CliOptions = { home: string; socket: string; timeout: number; json: boolean; offline: boolean; yes: boolean; lines: number; since?: number; agent?: string; model?: string; noLaunch: boolean; output?: string; follow: boolean; mcpUrl?: string; includeLogs: boolean; signal?: AbortSignal };
export class CliError extends Error { constructor(message: string, readonly exitCode = 1) { super(message); } }
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

export function nodeContext(overrides: Partial<CliContext>): CliContext {
  const env = overrides.env ?? process.env;
  const signal = overrides.signal;
  return {
    env, userHome: homedir(), cwd: process.cwd(), platform: process.platform,
    interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
    write: text => { process.stdout.write(text); },
    out: text => { process.stdout.write(text.endsWith('\n') ? text : `${text}\n`); },
    err: text => { process.stderr.write(text.endsWith('\n') ? text : `${text}\n`); },
    now: () => new Date(),
    ask: async question => {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      const interrupted = new AbortController();
      const cancel = () => interrupted.abort(new CliError('Cancelled.', 130));
      input.once('SIGINT', cancel); input.once('close', cancel);
      try { return await input.question(question, { signal: AbortSignal.any([interrupted.signal, ...(signal ? [signal] : [])]) }); }
      finally { input.off('SIGINT', cancel); input.off('close', cancel); input.close(); }
    },
    exec: (file, args, options) => new Promise((resolve, reject) => {
      execFile(file, args, { env: options?.env ?? env, signal, encoding: 'utf8', timeout: options?.timeout ?? 2500, maxBuffer: 128 * 1024, windowsHide: true }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }));
    }),
    launch: (file, args, options) => new Promise((resolve, reject) => {
      const child = spawn(file, args, { ...options, signal, stdio: 'inherit', shell: false });
      child.once('error', reject); child.once('exit', (code, killedBy) => resolve(code ?? (killedBy ? 128 + osConstants.signals[killedBy] : 1)));
    }), ...overrides,
  };
}
export function appHome(context: CliContext, explicit?: string): string {
  return path.resolve(context.cwd, explicit ?? configuredAppHome(context.env) ?? path.join(context.userHome, product.homeDirectory));
}
export async function fileExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error) {
    if (record(error) && ['ENOENT', 'ENOTDIR'].includes(String(error.code))) return false;
    throw new CliError(`${path.basename(file)} could not be accessed.`);
  }
}
export async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    if ((await stat(file)).size > 16 * 1024 * 1024) throw new CliError(`${path.basename(file)} is too large for a diagnostic read.`);
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!record(value)) throw new CliError(`${path.basename(file)} must contain a JSON object.`);
    return value;
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error instanceof SyntaxError) throw new CliError(`${path.basename(file)}: invalid JSON; the file was left untouched.`);
    throw new CliError(`${path.basename(file)} could not be read.`);
  }
}
export async function providerBinary(context: CliContext, id: 'codex' | 'claude' | 'antigravity', home: string): Promise<string | undefined> {
  const executable = id === 'antigravity' ? 'agy' : id;
  const extensions = context.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const folders = (context.env.PATH ?? '').split(context.platform === 'win32' ? ';' : ':').filter(Boolean);
  folders.push(path.join(home, 'bin'), path.join(context.userHome, '.local', 'bin'));
  for (const folder of folders) for (const ext of extensions) {
    const file = path.resolve(context.cwd, folder, `${executable}${ext}`);
    try { if ((await stat(file)).isFile()) { await access(file, context.platform === 'win32' ? constants.F_OK : constants.X_OK); return file; } } catch { /* Try the next executable. */ }
  }
  return undefined;
}
export function print(context: CliContext, options: CliOptions, value: unknown, human: string): void {
  context.signal?.throwIfAborted();
  context.out(options.json ? JSON.stringify(value, null, 2) : human);
}
export function redact(text: string, context: CliContext, home: string): string {
  return text.replaceAll(home, '<APP_HOME>').replaceAll(context.userHome, '~')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s"',}]+/giu, '$1[REDACTED]')
    .replace(/((?:token|password|secret|api[_-]?key|authorization)[\\"'\s]*[:=])[^\n]*/giu, '$1 [REDACTED]');
}
