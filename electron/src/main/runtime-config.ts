import { product } from '@workspace/core/product';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { discoveredRuntimePath, type RuntimeDiscoveryDependencies } from '@workspace/core/runtime-discovery';

export type RuntimeDaemonBackendMode = 'auto' | 'bundled' | 'existing';

export type RuntimeDaemonCommand = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type RuntimeDaemonConfigDeps = RuntimeDiscoveryDependencies & {
  cwd?: string;
  defaultApp?: boolean;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
};

export function runtimeDaemonCommand(deps: RuntimeDaemonConfigDeps = {}): RuntimeDaemonCommand | null {
  const env = deps.env ?? process.env;
  const command = env.APP_BACKEND_COMMAND?.trim();
  if (!command) {
    return packagedDaemonCommand(deps);
  }

  const args = env.APP_BACKEND_ARGS
    ?.split(',')
    .map((arg) => arg.trim())
    .filter(Boolean) ?? ['--stdio'];

  return {
    command,
    args,
    env: runtimeDaemonEnv(deps),
  };
}

export function runtimeDaemonServeCommand(deps: RuntimeDaemonConfigDeps = {}): RuntimeDaemonCommand | null {
  const command = runtimeDaemonCommand(deps);
  if (!command) {
    return null;
  }

  return {
    ...command,
    args: serveArgsFromStdioArgs(command.args),
  };
}

export function runtimeDaemonBackendMode(deps: RuntimeDaemonConfigDeps = {}): RuntimeDaemonBackendMode {
  const env = deps.env ?? process.env;
  const mode = env.APP_BACKEND_MODE?.trim();
  return mode === 'bundled' || mode === 'existing' ? mode : 'auto';
}

export function runtimeDaemonSocketPath(deps: RuntimeDaemonConfigDeps = {}): string {
  const env = deps.env ?? process.env;
  const configured = env.APP_BACKEND_SOCKET?.trim();
  if (configured) {
    return configured;
  }
  return path.join(env.APP_HOME?.trim() || path.join((deps.homedir ?? homedir)(), `${product.homeDirectory}`), 'daemon.sock');
}

export function runtimeDaemonHome(deps: RuntimeDaemonConfigDeps = {}): string {
  const env = deps.env ?? process.env;
  return env.APP_HOME?.trim() || path.join((deps.homedir ?? homedir)(), `${product.homeDirectory}`);
}

export function runtimeDaemonWatchFile(deps: RuntimeDaemonConfigDeps = {}): string | null {
  const env = deps.env ?? process.env;
  return env.APP_BACKEND_WATCH_FILE?.trim() || null;
}

function runtimeDaemonAssetsPath(deps: RuntimeDaemonConfigDeps = {}): string {
  const env = deps.env ?? process.env;
  const configured = env.APP_ASSETS_PATH?.trim();
  if (configured) {
    return configured;
  }

  const electronProcess = process as NodeJS.Process & { defaultApp?: boolean; resourcesPath?: string };
  const resourcesPath = deps.resourcesPath ?? electronProcess.resourcesPath;
  const defaultApp = deps.defaultApp ?? electronProcess.defaultApp;
  if (resourcesPath && !defaultApp) {
    return resourcesPath;
  }

  return path.resolve(deps.cwd ?? process.cwd(), 'assets');
}

function packagedDaemonCommand(deps: RuntimeDaemonConfigDeps): RuntimeDaemonCommand | null {
  const electronProcess = process as NodeJS.Process & { defaultApp?: boolean; resourcesPath?: string };
  const resourcesPath = deps.resourcesPath ?? electronProcess.resourcesPath;
  const defaultApp = deps.defaultApp ?? electronProcess.defaultApp;
  if (!resourcesPath || defaultApp) {
    return null;
  }

  const runtimeDir = path.join(resourcesPath, 'daemon');
  const bundlePath = path.join(runtimeDir, product.daemonName);
  const fileExists = deps.existsSync ?? existsSync;
  if (!fileExists(bundlePath)) {
    return null;
  }
  const platform = deps.platform ?? process.platform;
  const nodeCommand = path.join(resourcesPath, 'runtime', platform === 'win32' ? 'node.exe' : 'node');
  if (!fileExists(nodeCommand)) {
    return null;
  }

  const runtimeEnv = runtimeDaemonEnv(deps);
  return {
    command: nodeCommand,
    args: [bundlePath, '--stdio'],
    env: {
      ...runtimeEnv,
      // The daemon uses an absolute private Node; provider tools prefer user Node.
      PATH: [runtimeEnv.PATH, path.dirname(nodeCommand)].filter(Boolean).join(platform === 'win32' ? ';' : ':'),
    },
  };
}

function runtimeDaemonEnv(deps: RuntimeDaemonConfigDeps): NodeJS.ProcessEnv {
  const env = deps.env ?? process.env;
  const githubClientId = env.APP_GITHUB_CLIENT_ID?.trim();
  const gitlabClientId = env.APP_GITLAB_CLIENT_ID?.trim();
  const linearClientId = env.APP_LINEAR_CLIENT_ID?.trim();
  const runtimePath = !deps.env || env.PATH ? discoveredRuntimePath(deps) : '';
  const home = env.HOME?.trim() || (deps.homedir ?? homedir)();

  return {
    APP_ASSETS_PATH: runtimeDaemonAssetsPath(deps),
    APP_HOME: runtimeDaemonHome(deps),
    HOME: home,
    ...(runtimePath ? { PATH: runtimePath } : {}),
    ...(githubClientId ? { APP_GITHUB_CLIENT_ID: githubClientId } : {}),
    ...(gitlabClientId ? { APP_GITLAB_CLIENT_ID: gitlabClientId } : {}),
    ...(linearClientId ? { APP_LINEAR_CLIENT_ID: linearClientId } : {}),
  };
}

function serveArgsFromStdioArgs(args: string[]): string[] {
  const stdioIndex = args.indexOf('--stdio');
  if (stdioIndex >= 0) {
    return [
      ...args.slice(0, stdioIndex),
      'serve',
      ...args.slice(stdioIndex + 1),
    ];
  }

  return args.includes('serve') ? args : [...args, 'serve'];
}
