import { product } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { appRpcErrorCodes, createAppRpcError, createAppRpcResult, isAppRpcRequest } from '@workspace/core/backend-protocol/rpc';
import { spawn } from 'node:child_process';
import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { createDaemonRuntime, type DaemonRuntime, type DaemonRuntimeOptions } from './runtime';
import { backendHomeDir, backendSocketPath } from './state';
import { acquireHomeLock, exclusiveHomeEnvironment, HomeInUseError, type HomeLock } from './home-lock';
import { LocalSocketRpcServer } from './socket-server';
import { StdioRpcPeer } from './stdio';
import { debugMain, flushBackendLogs, logMain, warnMain } from './log';
import backendPackage from '../package.json';
import { runCompanionRelay } from './companion/relay-cli';

export const DAEMON_VERSION = backendPackage.version;
export { loadPricingHistory } from './pricing/catalog';

const stopSshServiceMethod = 'ssh-service/stop';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  process.title = product.daemonName;
  if (argv.includes('--state-dir')) {
    process.stderr.write(`Unsupported option: --state-dir. Set APP_HOME (or KORUS_HOME) to override ~/${product.homeDirectory}.
`);
    process.exitCode = 1;
    return;
  }

  if (argv.includes('--version')) {
    process.stdout.write(`${product.daemonName} ${DAEMON_VERSION}\n`);
    return;
  }

  if (argv.includes('--stdio')) {
    await withHomeLock(runStdio, process.env[exclusiveHomeEnvironment] === '1');
    return;
  }

  if (argv.includes('serve')) {
    const sshService = argv.includes('--ssh-service');
    // Concurrent bridges wait for the same socket. A losing launcher must
    // exit instead of keeping a second service queued behind the live one.
    await withHomeLock(lock => serve(lock, sshService), sshService, 0);
    return;
  }

  if (argv.includes('companion-relay')) {
    await runCompanionRelay(argv[argv.indexOf('companion-relay') + 1] ?? '');
    return;
  }

  if (argv.includes('connect')) {
    process.exitCode = await connectToDaemon({
      expectedVersion: DAEMON_VERSION,
      startDaemon: argv.includes('--start') ? startSshService : undefined,
    });
    return;
  }

  if (argv[0] === 'install-ssh-service' && argv[1]) {
    try {
      await requestSshServiceStop();
      // The old service can close its socket before it finishes flushing state.
      const lock = await acquireHomeLock(backendHomeDir(), { waitMs: 25_000 });
      try {
        await rename(fileURLToPath(import.meta.url), argv[1]);
      } finally {
        await lock.release();
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  process.stderr.write(`Usage: ${product.daemonName} --stdio | serve | connect | companion-relay <config-file> | --version
Set APP_HOME (or KORUS_HOME) to override ~/${product.homeDirectory}.
`);
  process.exitCode = 1;
}

export type ConnectToDaemonOptions = {
  connectSocket?: typeof net.createConnection;
  input?: Readable;
  output?: Writable;
  socketPath?: string;
  stderr?: Writable;
  expectedVersion?: string;
  startDaemon?: () => Promise<void>;
};

function openDaemonSocket(socketPath: string, connect = net.createConnection): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const onConnect = () => {
      socket.off('error', onError);
      resolve(socket);
    };
    const onError = (error: Error) => {
      socket.off('connect', onConnect);
      socket.destroy();
      reject(error);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}

function isUnavailableSocket(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ECONNREFUSED';
}

async function openOrStartDaemonSocket(options: ConnectToDaemonOptions): Promise<net.Socket> {
  const open = () => openDaemonSocket(options.socketPath ?? backendSocketPath(), options.connectSocket);
  try {
    return await open();
  } catch (error) {
    if (!options.startDaemon || !isUnavailableSocket(error)) throw error;
  }
  await options.startDaemon();
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      return await open();
    } catch (error) {
      if (!isUnavailableSocket(error) || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}

async function startSshService(): Promise<void> {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', '--ssh-service'], {
    detached: true,
    stdio: 'ignore',
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
}

async function requestSshServiceStop(): Promise<void> {
  let socket: net.Socket;
  try {
    socket = await openDaemonSocket(backendSocketPath());
  } catch (error) {
    if (isUnavailableSocket(error)) return;
    throw error;
  }
  const peer = new StdioRpcPeer({
    input: socket,
    output: socket,
    requestTimeoutMs: 5_000,
    onMessage: () => undefined,
  });
  socket.once('close', () => peer.stop());
  socket.once('error', () => peer.stop());
  peer.start();
  try {
    const result = await peer.request<{ stopping: boolean }>(stopSshServiceMethod);
    if (result.stopping !== true) throw new Error('The SSH service did not acknowledge shutdown.');
  } finally {
    peer.stop();
    socket.destroy();
  }
}

export async function connectToDaemon(options: ConnectToDaemonOptions = {}): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let socket: net.Socket;
  try {
    socket = await openOrStartDaemonSocket(options);
  } catch (error) {
    stderr.write(`${product.daemonName} socket unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  if (options.expectedVersion && !await verifySocketVersion(socket, options.expectedVersion)) {
    socket.destroy();
    stderr.write('Restart the running Korus service on this SSH host to finish the update. Its version differs from the installed version.\n');
    return 2;
  }

  return new Promise<number>((resolve) => {
    let finished = false;
    const finish = (code: number) => {
      if (finished) {
        return;
      }
      finished = true;
      input.unpipe(socket);
      input.pause();
      socket.unpipe(output);
      socket.destroy();
      resolve(code);
    };

    socket.once('close', () => finish(0));
    socket.once('error', () => finish(3));
    input.once('error', () => finish(3));
    output.once('error', () => finish(3));
    input.pipe(socket);
    socket.pipe(output);
    input.resume();
  });
}

function verifySocketVersion(socket: net.Socket, version: string): Promise<boolean> {
  return new Promise(resolve => {
    let buffer = '';
    const finish = (valid: boolean) => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onError);
      resolve(valid);
    };
    const onError = () => finish(false);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > 65536) { finish(false); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const response = JSON.parse(line);
          if (response.id !== '__korus-verify-version') continue;
          socket.pause();
          finish(response.result?.version === version);
          if (buffer) socket.unshift(Buffer.from(buffer));
          return;
        } catch { finish(false); return; }
      }
    };
    const timer = setTimeout(onError, 5_000);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onError);
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: '__korus-verify-version', method: backendMethods.backendHealthGet })}\n`);
  });
}

async function withHomeLock(start: (lock: HomeLock | null) => Promise<void>, required: boolean, waitMs?: number): Promise<void> {
  let homeLock: HomeLock | null = null;
  if (required) {
    try {
      homeLock = await acquireHomeLock(backendHomeDir(), { waitMs });
    } catch (error) {
      if (!(error instanceof HomeInUseError)) throw error;
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 4;
      return;
    }
  }
  try {
    await start(homeLock);
  } catch (error) {
    await homeLock?.release();
    throw error;
  }
}

async function runStdio(homeLock: HomeLock | null): Promise<void> {
  let runtime: DaemonRuntime;
  const stdio = new StdioRpcPeer({
    input: process.stdin,
    output: process.stdout,
    onOutputBackpressure: (details) => debugMain('stdio', 'output buffered', details),
    onOutputDrain: (details) => debugMain('stdio', 'output drained', details),
    onOutputOverflow: (details) => warnMain('stdio', 'output buffer limit exceeded', details),
    onMessage: (message) => runtime.server.handleMessage(message),
  });
  runtime = await createDaemonRuntime({
    version: DAEMON_VERSION,
    features: runtimeFeatures(),
    requestClient: (method, params) => stdio.request(method, params),
    emitEvent: (event) => stdio.notify(backendMethods.backendEventNotify, event),
  });

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    stdio.stop();
    await runtime.stop();
    await flushBackendLogs();
    await homeLock?.release();
  };
  process.once('SIGTERM', () => {
    void stop().finally(() => process.exit(0));
  });
  process.once('SIGINT', () => {
    void stop().finally(() => process.exit(0));
  });
  process.stdin.once('end', () => {
    void stop().finally(() => process.exit(0));
  });
  process.stdout.once('error', (error) => {
    warnMain('stdio', 'output closed', { message: error.message });
    void stop().finally(() => process.exit(1));
  });
  stdio.start();
  process.stdin.resume();
}

async function serve(homeLock: HomeLock | null, sshService: boolean): Promise<void> {
  let socketServer: LocalSocketRpcServer | null = null;
  let shutdownScheduled = false;
  let stopping = false;
  const runtime = await createDaemonRuntime({
    version: DAEMON_VERSION,
    sshService,
    features: runtimeFeatures(),
    requestClient: (method, params) => {
      if (!socketServer) {
        throw new Error(`No connected client can handle '${method}'.`);
      }
      if (method === backendMethods.clientCollaborationCall) return socketServer.requestCollaborationController(params);
      return socketServer.requestFirstClient(method, params);
    },
    emitEvent: (event) => {
      socketServer?.broadcastEvent(event);
    },
  });
  socketServer = new LocalSocketRpcServer({
    socketPath: backendSocketPath(),
    onMessage: (message) => {
      if (shutdownScheduled) throw new Error('The SSH service is shutting down for an update.');
      if (isAppRpcRequest(message) && message.method === stopSshServiceMethod) {
        if (!sshService) {
          return createAppRpcError(message.id, appRpcErrorCodes.methodNotFound, 'Stop the running Korus service on this SSH host before updating.');
        }
        runtime.prepareForRestart();
        shutdownScheduled = true;
        // Let this peer send its reply before closing the listening socket.
        setImmediate(shutdown);
        return createAppRpcResult(message.id, { stopping: true });
      }
      return runtime.server.handleMessage(message);
    },
  });
  await socketServer.start();
  logMain('daemon', 'listening', { socketPath: backendSocketPath() });

  async function stop() {
    if (stopping) {
      return;
    }
    stopping = true;
    await socketServer?.stop();
    await runtime.stop();
    await flushBackendLogs();
    await homeLock?.release();
  }
  function shutdown() {
    void stop().finally(() => process.exit(0));
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

function runtimeFeatures(): DaemonRuntimeOptions['features'] {
  return process.env.APP_HOST === 'web'
    ? { computerUse: false, embeddedBrowser: false, mobileSimulator: false }
    : { debugTools: process.env.APP_DEBUG_BACKEND_TOOLS === '1' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
