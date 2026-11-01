import { product, parseDaemonVersion } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { DaemonStatus } from '@workspace/core/contracts';
import { runtimeDaemonCommand, runtimeDaemonHome, runtimeDaemonServeCommand, runtimeDaemonSocketPath, type RuntimeDaemonConfigDeps, type RuntimeDaemonCommand } from './runtime-config';

const execFile = promisify(execFileCallback);
const launchAgentLabel = `${product.appId}.daemon`;

type ExecFileResult = {
  stdout?: string | Buffer;
};
type ExecFile = (file: string, args: string[]) => Promise<ExecFileResult>;

export type DaemonLaunchAgentDependencies = RuntimeDaemonConfigDeps & {
  access?: typeof access;
  connectSocket?: typeof net.createConnection;
  execFile?: ExecFile;
  getuid?: () => number;
  homedir?: () => string;
  mkdir?: typeof mkdir;
  platform?: NodeJS.Platform;
  unlink?: typeof unlink;
  writeFile?: typeof writeFile;
};

type ResolvedLaunchAgent = {
  command: RuntimeDaemonCommand | null;
  homeDir: string;
  launchAgentPath: string;
  logDir: string;
  socketPath: string;
};

export async function getDaemonStatus(
  dependencies: DaemonLaunchAgentDependencies = {},
): Promise<DaemonStatus> {
  const resolved = resolveLaunchAgent(dependencies);
  const installed = await pathExists(resolved.launchAgentPath, dependencies);
  const health = await probeDaemonSocket(resolved.socketPath, dependencies);
  const command = resolved.command;
  const platformSupported = isSupportedPlatform(dependencies);
  const supported = platformSupported && Boolean(command);

  return {
    supported,
    installed,
    running: health.ok,
    socketPath: resolved.socketPath,
    launchAgentPath: resolved.launchAgentPath,
    ...(health.version ? { version: health.version } : {}),
    ...(typeof health.pid === 'number' ? { pid: health.pid } : {}),
    detail: statusDetail({ command, health, platformSupported }),
  };
}

export async function setDaemonEnabled(
  enabled: boolean,
  dependencies: DaemonLaunchAgentDependencies = {},
): Promise<DaemonStatus> {
  if (enabled) {
    return installDaemon(dependencies);
  }

  return uninstallDaemon(dependencies);
}

export async function installDaemon(
  dependencies: DaemonLaunchAgentDependencies = {},
): Promise<DaemonStatus> {
  const resolved = resolveLaunchAgent(dependencies);
  if (!isSupportedPlatform(dependencies)) {
    throw new Error('daemon background daemon installation is only supported on macOS.');
  }
  if (!resolved.command) {
    throw new Error('No daemon runtime is available to install as a background daemon.');
  }

  await (dependencies.mkdir ?? mkdir)(path.dirname(resolved.launchAgentPath), { recursive: true });
  await (dependencies.mkdir ?? mkdir)(resolved.logDir, { recursive: true });
  await (dependencies.mkdir ?? mkdir)(resolved.homeDir, { recursive: true, mode: 0o700 });
  await (dependencies.writeFile ?? writeFile)(resolved.launchAgentPath, launchAgentPlist(resolved));
  await launchctl(['bootout', launchctlDomain(dependencies), resolved.launchAgentPath], dependencies).catch(() => undefined);
  await launchctl(['bootstrap', launchctlDomain(dependencies), resolved.launchAgentPath], dependencies);
  await launchctl(['kickstart', '-k', launchctlServiceTarget(dependencies)], dependencies);
  return getDaemonStatus(dependencies);
}

export async function refreshDaemon(
  dependencies: DaemonLaunchAgentDependencies = {},
): Promise<DaemonStatus> {
  return installDaemon(dependencies);
}

export async function getResolvedDaemonVersion(
  dependencies: DaemonLaunchAgentDependencies = {},
): Promise<string | null> {
  const command = runtimeDaemonCommand(dependencies);
  if (!command) {
    return null;
  }

  const result = await (dependencies.execFile ?? execFile)(command.command, versionArgsFromRuntimeArgs(command.args));
  return parseDaemonVersion(result.stdout?.toString() ?? '');
}

async function uninstallDaemon(
  dependencies: DaemonLaunchAgentDependencies = {},
): Promise<DaemonStatus> {
  const resolved = resolveLaunchAgent(dependencies);
  if (isSupportedPlatform(dependencies)) {
    await launchctl(['bootout', launchctlDomain(dependencies), resolved.launchAgentPath], dependencies).catch(() => undefined);
  }
  await (dependencies.unlink ?? unlink)(resolved.launchAgentPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  return getDaemonStatus(dependencies);
}

function resolveLaunchAgent(dependencies: DaemonLaunchAgentDependencies): ResolvedLaunchAgent {
  const userHome = (dependencies.homedir ?? homedir)();
  return {
    command: runtimeDaemonServeCommand(dependencies),
    homeDir: runtimeDaemonHome(dependencies),
    launchAgentPath: path.join(userHome, 'Library', 'LaunchAgents', `${launchAgentLabel}.plist`),
    logDir: path.join(userHome, 'Library', 'Logs', `${product.name}`),
    socketPath: runtimeDaemonSocketPath(dependencies),
  };
}

function launchAgentPlist(resolved: ResolvedLaunchAgent): string {
  if (!resolved.command) {
    throw new Error('Cannot build a LaunchAgent plist without a daemon command.');
  }

  const env = {
    ...resolved.command.env,
    APP_HOME: resolved.homeDir,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(launchAgentLabel)}</string>
  <key>ProgramArguments</key>
  <array>
${plistStringArray([resolved.command.command, ...resolved.command.args])}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${plistStringDictionary(env)}
  </dict>
  <key>WorkingDirectory</key>
  <string>${escapeXml(resolved.homeDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(resolved.logDir, 'daemon.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(resolved.logDir, 'daemon.err.log'))}</string>
</dict>
</plist>
`;
}

function plistStringArray(values: string[]): string {
  return values.map((value) => `    <string>${escapeXml(value)}</string>`).join('\n');
}

function plistStringDictionary(values: NodeJS.ProcessEnv): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
    .join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function pathExists(filePath: string, dependencies: DaemonLaunchAgentDependencies): Promise<boolean> {
  try {
    await (dependencies.access ?? access)(filePath);
    return true;
  } catch {
    return false;
  }
}

async function launchctl(args: string[], dependencies: DaemonLaunchAgentDependencies): Promise<void> {
  await (dependencies.execFile ?? execFile)('launchctl', args);
}

function launchctlDomain(dependencies: DaemonLaunchAgentDependencies): string {
  return `gui/${userId(dependencies)}`;
}

function launchctlServiceTarget(dependencies: DaemonLaunchAgentDependencies): string {
  return `${launchctlDomain(dependencies)}/${launchAgentLabel}`;
}

function userId(dependencies: DaemonLaunchAgentDependencies): number {
  return dependencies.getuid?.() ?? process.getuid?.() ?? 501;
}

function isSupportedPlatform(dependencies: DaemonLaunchAgentDependencies): boolean {
  return (dependencies.platform ?? process.platform) === 'darwin';
}

function statusDetail(options: {
  command: RuntimeDaemonCommand | null;
  health: DaemonHealthProbe;
  platformSupported: boolean;
}): string | undefined {
  if (!options.platformSupported) {
    return 'Background daemon installation is only supported on macOS.';
  }
  if (!options.command) {
    return 'No packaged daemon runtime was found.';
  }
  if (!options.health.ok && options.health.error) {
    return options.health.error;
  }
  return undefined;
}

type DaemonHealthProbe = {
  ok: boolean;
  error?: string;
  version?: string;
  pid?: number;
};

function probeDaemonSocket(
  socketPath: string,
  dependencies: DaemonLaunchAgentDependencies,
): Promise<DaemonHealthProbe> {
  return new Promise((resolve) => {
    const socket = (dependencies.connectSocket ?? net.createConnection)(socketPath);
    let buffer = '';
    let done = false;

    const finish = (result: DaemonHealthProbe) => {
      if (done) {
        return;
      }
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: backendMethods.backendHealthGet })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      try {
        const message = JSON.parse(buffer.slice(0, newlineIndex));
        const result = message?.result;
        finish({
          ok: message?.id === 1 && Boolean(result) && !message.error,
          ...(typeof result?.version === 'string' ? { version: result.version } : {}),
          ...(typeof result?.pid === 'number' ? { pid: result.pid } : {}),
        });
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : 'Invalid daemon health response.' });
      }
    });
    socket.once('timeout', () => finish({ ok: false, error: 'daemon daemon health check timed out.' }));
    socket.once('error', (error) => finish({ ok: false, error: error.message }));
  });
}

function versionArgsFromRuntimeArgs(args: string[]): string[] {
  const modeIndex = args.findIndex((arg) => arg === '--stdio' || arg === 'serve');
  if (modeIndex >= 0) {
    return [
      ...args.slice(0, modeIndex),
      '--version',
      ...args.slice(modeIndex + 1),
    ];
  }

  return [...args, '--version'];
}
