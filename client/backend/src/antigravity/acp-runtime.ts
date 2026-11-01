import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { product } from '@workspace/core/product';
import { AcpConnection, record } from './acp-connection';
import { acpEnvironment, acpVersion, antigravityHome, resolveAcpRuntime } from './runtime';

export class NativeLoginRequired extends Error {
  constructor() { super('Sign in to Antigravity with Google in Settings.'); }
}

/** Owns one qualified runtime and its private temporary files, never its credentials. */
export class AcpRuntime {
  readonly connection: AcpConnection;
  private loginRequired = false;
  private closing?: Promise<void>;

  private constructor(private readonly temp: string, options: ConstructorParameters<typeof AcpConnection>[0]) {
    this.connection = new AcpConnection({ ...options, onLoginRequired: () => {
      this.loginRequired = true;
      options.onLoginRequired?.();
    } });
  }

  static async open(options: {
    runtime?: NonNullable<ReturnType<typeof resolveAcpRuntime>>;
    cwd: string;
    home?: string;
    interactive?: boolean;
    signal?: AbortSignal;
    filesystem?: boolean;
    onRequest: ConstructorParameters<typeof AcpConnection>[0]['onRequest'];
    onNotification: ConstructorParameters<typeof AcpConnection>[0]['onNotification'];
    onClose: ConstructorParameters<typeof AcpConnection>[0]['onClose'];
  }): Promise<AcpRuntime> {
    const runtime = options.runtime ?? resolveAcpRuntime();
    if (!runtime) throw new Error('Install the Antigravity ACP runtime and matching harness in Settings.');
    const home = options.home ?? antigravityHome();
    await mkdir(home, { recursive: true, mode: 0o700 });
    const temporaryRoot = path.join(home, 'korus-tmp');
    await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
    const temp = await mkdtemp(path.join(temporaryRoot, 'acp-'));
    if (options.signal?.aborted) { await rm(temp, { recursive: true, force: true }); throw new Error('Antigravity authentication cancelled.'); }
    const env = acpEnvironment(home, runtime.harness, temp);
    // Python's native webbrowser honors this command. It receives the URL as an
    // ignored argument and succeeds, preventing fallback to the user's browser.
    if (!options.interactive) env.BROWSER = `${quoteBrowserArgument(process.execPath)} -e 'process.exit(0)' %s`;
    let instance: AcpRuntime;
    instance = new AcpRuntime(temp, { ...options, ...runtime, env,
      onLoginRequired: options.interactive ? undefined : () => { void instance.connection.close(); },
    });
    const abort = () => { void instance.close(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      instance.connection.start();
      const initialization = await instance.connection.request('initialize', {
        protocolVersion: 2,
        clientInfo: { name: product.mcpServerName, title: product.name, version: '1' },
        clientCapabilities: { fs: { readTextFile: options.filesystem !== false, writeTextFile: options.filesystem !== false }, terminal: false },
      });
      if (!record(initialization) || initialization.protocolVersion !== 2 || !record(initialization.agentInfo)
        || initialization.agentInfo.version !== acpVersion || initialization.agentInfo.name !== 'antigravity-acp') {
        throw new Error(`Antigravity requires the qualified ACP ${acpVersion} runtime (protocol 2).`);
      }
      return instance;
    } catch (error) { await instance.close(); throw error; }
    finally { options.signal?.removeEventListener('abort', abort); }
  }

  async authenticate(): Promise<void> {
    try { await this.connection.request('authenticate', { methodId: 'oauth-personal' }, 330_000); }
    catch (error) { if (this.loginRequired) throw new NativeLoginRequired(); throw error; }
  }

  close(): Promise<void> {
    return this.closing ??= this.connection.close().finally(() => rm(this.temp, { recursive: true, force: true }));
  }
}

function quoteBrowserArgument(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
