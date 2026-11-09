import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveRuntimeExecutable, withDiscoveredRuntimePath } from '@workspace/core/runtime-discovery';
import type { AgentBackend } from '@workspace/core/contracts';
import type { ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
import type { ProviderInstallation } from './provider-updates';
import type { ProviderUpdateAdapter, ProviderUpdateIO } from './provider-update-adapter';
import { createCodexUpdateAdapter } from './codex/provider-update';
import { createClaudeUpdateAdapter } from './claude/provider-update';
import { createAntigravityUpdateAdapter } from './antigravity/provider-update';
import { CursorUpdateAdapter } from './cursor/provider-update';

const exec = promisify(execFile);

/** Detects the installation actually used by Korus; never switches package managers. */
export class ProviderUpdateRuntime {
  private readonly io: ProviderUpdateIO;
  private readonly adapters: ReadonlyMap<AgentBackend, ProviderUpdateAdapter>;
  constructor(options: { command(backend: AgentBackend): string; claudeHome(): string; cursorHome?(): ProviderHomeSettings | undefined; env?: NodeJS.ProcessEnv }, dependencies: Partial<ProviderUpdateIO> = {}) {
    this.io = {
      resolve: command => resolveRuntimeExecutable(command, { env: { ...process.env, ...options.env } }), realpath, read: file => readFile(file, 'utf8'),
      run: async (file, args, timeout, env) => (await exec(file, args, {
        timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        env: withDiscoveredRuntimePath({ ...options.env, ...env }),
      })).stdout,
      fetchText: async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
        if (!response.ok) throw new Error('Provider version lookup failed.');
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error('Provider version response is too large.');
        return text;
      },
      home: homedir(), platform: process.platform, ...dependencies,
    };
    this.adapters = new Map<AgentBackend, ProviderUpdateAdapter>([
      ['codex', createCodexUpdateAdapter(this.io, { command: () => options.command('codex') })],
      ['claude', createClaudeUpdateAdapter(this.io, { command: () => options.command('claude'), home: options.claudeHome, env: options.env })],
      ['antigravity', createAntigravityUpdateAdapter()],
      ['cursor', new CursorUpdateAdapter(this.io, options.cursorHome)],
    ]);
  }

  async inspect(backend: AgentBackend): Promise<ProviderInstallation> {
    return { ...await this.adapter(backend).inspect(), backend };
  }

  async upgrade(installation: ProviderInstallation): Promise<void> {
    if (!installation.backend) throw new Error('Manual provider upgrade required.');
    await this.adapter(installation.backend).upgrade(installation);
  }

  private adapter(backend: AgentBackend): ProviderUpdateAdapter {
    const adapter = this.adapters.get(backend);
    if (!adapter) throw new Error('Provider updates are unavailable.');
    return adapter;
  }
}
