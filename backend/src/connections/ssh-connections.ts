import backendPackage from '../../package.json';
import { product, parseDaemonVersion } from '@workspace/core/product';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddSshConnectionInput, ClaudeAuthentication, RemoteConnection, SshHostCandidate } from '@workspace/core/contracts';
import { createEntityId } from '@workspace/core/ids';
import { backendProviderTokensFilePath } from '../state';
import { remoteCodexVersionCommand } from './remote-codex-command';
import { remoteClaudeAuthenticationCommand, remoteClaudeInstallCommand, remoteClaudeVersionCommand } from './remote-claude-install';
import { remoteEnvironmentCommand, remoteNodeInstallCommand } from './remote-node';

type ExecResult = {
  stdout: string;
  stderr: string;
};

export type SshConnectionDependencies = {
  accessFile?: (filePath: string, mode?: number) => Promise<void>;
  homedir?: () => string;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  run?: (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<ExecResult>;
  now?: () => Date;
  createId?: () => string;
  assetsPath?: string;
  argv?: string[];
  providerTokensFilePath?: string;
};

const remoteDaemonPath = `~/${product.homeDirectory}/daemon.mjs`;
const remoteProviderTokensPath = `~/${product.homeDirectory}/provider-tokens.json`;
const connectTimeoutMs = 15_000;

export class SshConnectionService {
  constructor(private readonly deps: SshConnectionDependencies = {}) {}

  async listHostCandidates(): Promise<SshHostCandidate[]> {
    const configPath = path.join((this.deps.homedir ?? homedir)(), '.ssh', 'config');
    try {
      const content = await (this.deps.readFile ?? readFile)(configPath, 'utf8');
      return parseSshConfig(content, configPath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async createConnection(input: AddSshConnectionInput): Promise<RemoteConnection> {
    const createdAt = this.nowIso();
    const base = normalizeSshConnectionInput(input, createdAt, this.deps.createId?.() ?? createEntityId('connection'));
    return this.checkConnection(base);
  }

  async checkConnection(connection: RemoteConnection): Promise<RemoteConnection> {
    const checkedAt = this.nowIso();
    let next: RemoteConnection = {
      ...connection,
      status: 'checking',
      detail: undefined,
      updatedAt: checkedAt,
      lastCheckedAt: checkedAt,
    };

    try {
      await this.installRemoteDaemon(next.host);
      await this.syncRemoteProviderTokens(next.host);
      const daemonVersion = await this.remoteDaemonVersion(next.host);
      let [codexVersion, claudeVersion] = await Promise.all([
        this.remoteCodexVersion(next.host).catch(() => undefined),
        this.remoteClaudeVersion(next.host).catch(() => undefined),
      ]);
      if (!codexVersion && !claudeVersion) {
        const engines = await Promise.allSettled([
          this.ensureRemoteCodexInstalled(next.host), this.ensureRemoteClaudeInstalled(next.host),
        ]);
        for (const engine of engines) if (engine.status === 'rejected') throw engine.reason;
        codexVersion = (engines[0] as PromiseFulfilledResult<string>).value;
        claudeVersion = (engines[1] as PromiseFulfilledResult<string>).value;
      }
      const runtimeVersions = [`${product.daemonName} ${daemonVersion}`, ...(codexVersion ? [`Codex ${codexVersion}`] : []), ...(claudeVersion ? [`Claude ${claudeVersion}`] : [])];
      next = {
        ...next,
        status: 'ready',
        ...(daemonVersion ? { daemonVersion } : {}),
        codexVersion,
        detail: `Connected (${runtimeVersions.join(', ')})`,
        installedAt: checkedAt,
        transport: sshStdioTransport(next.host),
        updatedAt: checkedAt,
        lastCheckedAt: checkedAt,
      };
    } catch (error) {
      next = {
        ...next,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
        transport: undefined,
        updatedAt: checkedAt,
        lastCheckedAt: checkedAt,
      };
    }

    return next;
  }

  async inspectVersions(connection: RemoteConnection): Promise<RemoteConnection> {
    const [daemonVersion, codexVersion] = await Promise.all([
      this.remoteDaemonVersion(connection.host),
      this.remoteCodexVersion(connection.host).catch(() => undefined),
    ]);
    const runtimeVersions = [`${product.daemonName} ${daemonVersion}`, `Codex ${codexVersion || 'unknown'}`];
    let claudeWarning = '';
    {
      try {
        runtimeVersions.push(`Claude ${await this.remoteClaudeVersion(connection.host)}`);
      } catch (error) {
        claudeWarning = `; Claude unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return { ...connection, daemonVersion, codexVersion, lastCheckedAt: this.nowIso(),
      detail: `Connected (${runtimeVersions.join(', ')})${claudeWarning}` };
  }

  async ensureRemoteClaudeInstalled(host: string): Promise<string> {
    const result = await this.run('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      host,
      remoteEnvironmentCommand(remoteClaudeInstallCommand()),
    ], { timeoutMs: 360_000 });
    return parseRemoteClaudeVersion(result.stdout);
  }

  async ensureRemoteCodexInstalled(host: string): Promise<string> {
    const result = await this.run('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host,
      remoteEnvironmentCommand(`set -eu\nif command -v codex >/dev/null 2>&1 && codex --version >/dev/null 2>&1; then codex --version; exit 0; fi\nnpm install --global --prefix "$HOME/.local" @openai/codex\n"$HOME/.local/bin/codex" --version`),
    ], { timeoutMs: 360_000 });
    const version = /^codex-cli\s+(\S+)/mu.exec(result.stdout)?.[1];
    if (!version) throw new Error('Remote Codex installation could not be verified.');
    return version;
  }

  async getRemoteClaudeAuthentication(host: string): Promise<ClaudeAuthentication> {
    try {
      const result = await this.run('ssh', [
        '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, remoteClaudeAuthenticationCommand(),
      ], { timeoutMs: 15_000 });
      const status: unknown = JSON.parse(result.stdout);
      if (status && typeof status === 'object' && 'loggedIn' in status && typeof status.loggedIn === 'boolean') {
        return { loggedIn: status.loggedIn };
      }
    } catch { /* Do not forward CLI output or SSH diagnostics to the renderer. */ }
    throw new Error('Remote Claude authentication status was unavailable.');
  }

  private async remoteClaudeVersion(host: string): Promise<string> {
    const result = await this.run('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, remoteClaudeVersionCommand(),
    ], { timeoutMs: 15_000 });
    return parseRemoteClaudeVersion(result.stdout);
  }

  private async remoteCodexVersion(host: string): Promise<string> {
    const result = await this.run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, remoteCodexVersionCommand()]);
    return /^codex-cli\s+(\S+)/u.exec(result.stdout.trim())?.[1] ?? '';
  }

  private async installRemoteDaemon(host: string): Promise<void> {
    const localDaemon = await this.resolveLocalDaemonScript();
    const stagedDaemon = `~/${product.homeDirectory}/daemon-${randomUUID()}.mjs`;
    await this.run('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      host,
      remoteNodeInstallCommand(),
    ], { timeoutMs: 240_000 });
    await this.run('scp', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      localDaemon,
      `${host}:${stagedDaemon}`,
    ], { timeoutMs: 120_000 });
    await this.run('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      host,
      remoteEnvironmentCommand(`set -eu\nversion=$(node ${stagedDaemon} --version)\n[ "$version" = "${product.daemonName} ${backendPackage.version}" ] || { echo "Remote Korus verification failed; previous installation kept." >&2; exit 1; }\nchmod 600 ${stagedDaemon}\nmv ${stagedDaemon} ${remoteDaemonPath}`),
    ]);
  }

  private async syncRemoteProviderTokens(host: string): Promise<void> {
    const localProviderTokens = this.deps.providerTokensFilePath ?? backendProviderTokensFilePath();
    try {
      await (this.deps.accessFile ?? access)(localProviderTokens, fsConstants.R_OK);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    await this.run('scp', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      localProviderTokens,
      `${host}:~/${product.homeDirectory}/provider-tokens.json.tmp`,
    ], { timeoutMs: 120_000 });
    await this.run('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      host,
      `mv ~/${product.homeDirectory}/provider-tokens.json.tmp ${remoteProviderTokensPath} && chmod 600 ${remoteProviderTokensPath}`,
    ]);
  }

  private async remoteDaemonVersion(host: string): Promise<string> {
    const result = await this.run('ssh', [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      host,
      remoteEnvironmentCommand(`node ${remoteDaemonPath} --version`),
    ]);
    const version = parseDaemonVersion(result.stdout);
    if (!version) throw new Error('Remote daemon returned an invalid version.');
    return version;
  }

  private async resolveLocalDaemonScript(): Promise<string> {
    const entrypoint = this.deps.argv?.[1] ?? process.argv[1];
    const candidates = [
      // A source-linked daemon may inherit an installed desktop's older assets path.
      entrypoint && path.basename(entrypoint) === 'daemon.mjs' ? entrypoint : undefined,
      path.join(this.deps.assetsPath ?? process.env.APP_ASSETS_PATH ?? path.resolve(process.cwd(), 'assets'), 'daemon', 'daemon.mjs'),
    ].filter((candidate): candidate is string => Boolean(candidate && candidate.endsWith('.mjs')));

    for (const candidate of candidates) {
      try {
        await (this.deps.accessFile ?? access)(candidate, fsConstants.R_OK);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }

    throw new Error('No bundled daemon script was found to install on the remote host.');
  }

  private run(command: string, args: string[], options = { timeoutMs: connectTimeoutMs }): Promise<ExecResult> {
    return (this.deps.run ?? runCommand)(command, ['-o', 'StrictHostKeyChecking=accept-new', ...args], options);
  }

  private nowIso(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }
}

export function parseSshConfig(content: string, configPath?: string): SshHostCandidate[] {
  const hosts: SshHostCandidate[] = [];
  let current: SshHostCandidate[] = [];

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const parsed = parseConfigLine(rawLine);
    if (!parsed) {
      continue;
    }

    const key = parsed.key.toLowerCase();
    if (key === 'host') {
      current = parsed.value
        .split(/\s+/)
        .map((host) => host.trim())
        .filter(isConcreteHostAlias)
        .map((host) => ({
          host,
          configPath,
          line: index + 1,
        }));
      hosts.push(...current);
      continue;
    }

    if (current.length === 0) {
      continue;
    }

    for (const host of current) {
      applySshConfigOption(host, key, parsed.value);
    }
  }

  return hosts.sort((a, b) => a.host.localeCompare(b.host));
}

export function sshStdioTransport(host: string): RemoteConnection['transport'] {
  return {
    type: 'ssh-stdio',
    command: 'ssh',
    args: [
      '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new',
      host,
      remoteEnvironmentCommand(`node ${remoteDaemonPath} connect || { code=$?; [ "$code" -eq 1 ] || exit "$code"; exec node ${remoteDaemonPath} --stdio; }`),
    ],
  };
}

function normalizeSshConnectionInput(input: AddSshConnectionInput, now: string, id: string): RemoteConnection {
  const host = normalizeRequiredHost(input.host);
  const name = input.name?.trim() || host;
  return {
    id,
    kind: 'ssh',
    name,
    host,
    ...(input.hostName?.trim() ? { hostName: input.hostName.trim() } : {}),
    ...(input.user?.trim() ? { user: input.user.trim() } : {}),
    ...(validPort(input.port) ? { port: input.port } : {}),
    ...(input.identityFile?.trim() ? { identityFile: input.identityFile.trim() } : {}),
    status: 'saved',
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeRequiredHost(value: string): string {
  const host = value.trim();
  if (!isConcreteHostAlias(host)) {
    throw new Error('Select a concrete SSH host alias.');
  }
  return host;
}

function parseConfigLine(line: string): { key: string; value: string } | null {
  const withoutComment = stripComment(line).trim();
  if (!withoutComment) {
    return null;
  }

  const match = /^([A-Za-z][A-Za-z0-9_-]*)\s+(.*?)\s*$/.exec(withoutComment);
  if (!match) {
    return null;
  }

  return {
    key: match[1]!,
    value: unquote(match[2] ?? ''),
  };
}

function stripComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? null : char;
      continue;
    }
    if (char === '#' && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function applySshConfigOption(host: SshHostCandidate, key: string, value: string): void {
  if (key === 'hostname' && !host.hostName) {
    host.hostName = value;
  } else if (key === 'user' && !host.user) {
    host.user = value;
  } else if (key === 'port' && !host.port) {
    const port = Number(value);
    if (validPort(port)) {
      host.port = port;
    }
  } else if (key === 'identityfile' && !host.identityFile) {
    host.identityFile = value;
  }
}

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}

function isConcreteHostAlias(host: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host);
}

function parseRemoteClaudeVersion(output: string): string {
  const versionLine = output.split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => /^\d+\.\d+\.\d+ \(Claude Code\)$/u.test(line)).at(-1);
  if (!versionLine) throw new Error('Remote Claude Code version verification failed.');
  return versionLine.split(' ')[0]!;
}

function runCommand(command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = options.timeoutMs
      ? setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${command} timed out.`));
      }, options.timeoutMs)
      : null;

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      reject(new Error(result.stderr.trim() || `${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
