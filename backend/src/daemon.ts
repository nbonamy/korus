import { product } from '@workspace/core/product';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { pathToFileURL } from 'node:url';
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

export async function main(argv = process.argv.slice(2)): Promise<void> {
  process.title = product.daemonName;
  if (argv.includes('--state-dir')) {
    process.stderr.write(`Unsupported option: --state-dir. Set APP_HOME to override ~/${product.homeDirectory}.
`);
    process.exitCode = 1;
    return;
  }

  if (argv.includes('--version')) {
    process.stdout.write(`${product.daemonName} ${DAEMON_VERSION}\n`);
    return;
  }

  if (argv.includes('--stdio')) {
    await runStdio();
    return;
  }

  if (argv.includes('serve')) {
    await serve();
    return;
  }

  if (argv.includes('companion-relay')) {
    await runCompanionRelay(argv[argv.indexOf('companion-relay') + 1] ?? '');
    return;
  }

  if (argv.includes('connect')) {
    process.exitCode = await connectToDaemon({ expectedVersion: DAEMON_VERSION });
    return;
  }

  process.stderr.write(`Usage: ${product.daemonName} --stdio | serve | connect | companion-relay <config-file> | --version
Set APP_HOME to override ~/${product.homeDirectory}.
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
};

export async function connectToDaemon(options: ConnectToDaemonOptions = {}): Promise<number> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const socketPath = options.socketPath ?? backendSocketPath();
  const socket = (options.connectSocket ?? net.createConnection)(socketPath);
  let connectErrorMessage = socketPath;

  const connected = await new Promise<boolean>((resolve) => {
    const onConnect = () => {
      socket.off('error', onError);
      resolve(true);
    };
    const onError = (error: Error) => {
      socket.off('connect', onConnect);
      connectErrorMessage = error.message;
      resolve(false);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });

  if (!connected) {
    socket.destroy();
    stderr.write(`${product.daemonName} socket unavailable: ${connectErrorMessage}\n`);
    return 1;
  }

  if (options.expectedVersion && !await verifySocketVersion(socket, options.expectedVersion)) {
    socket.destroy();
    stderr.write('Restart the running Korus service on this SSH host to finish the update. Its version differs from the installed version.\n');
    // Only a missing socket permits stdio fallback. An incompatible live owner must never fork state.
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

async function runStdio(): Promise<void> {
  let homeLock: HomeLock | null = null;
  if (process.env[exclusiveHomeEnvironment] === '1') {
    try {
      homeLock = await acquireHomeLock(backendHomeDir());
    } catch (error) {
      if (!(error instanceof HomeInUseError)) throw error;
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 4;
      return;
    }
  }
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

async function serve(): Promise<void> {
  let socketServer: LocalSocketRpcServer | null = null;
  const runtime = await createDaemonRuntime({
    version: DAEMON_VERSION,
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
    onMessage: (message) => runtime.server.handleMessage(message),
  });
  await socketServer.start();
  logMain('daemon', 'listening', { socketPath: backendSocketPath() });

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await socketServer?.stop();
    await runtime.stop();
    await flushBackendLogs();
  };
  process.once('SIGTERM', () => {
    void stop().finally(() => process.exit(0));
  });
  process.once('SIGINT', () => {
    void stop().finally(() => process.exit(0));
  });
}

function runtimeFeatures(): DaemonRuntimeOptions['features'] {
  return process.env.APP_HOST === 'web'
    ? { computerUse: false, embeddedBrowser: false, mobileSimulator: false }
    : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
