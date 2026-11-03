import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import type { ProviderAuthentication, ProviderAuthenticationAction } from '@workspace/core/contracts/provider-setup';
import { cursorEnvironment, cursorHome, cursorMinimumVersion, cursorVersion, resolveCursorExecutable } from './runtime';

type Authentication = Extract<ProviderAuthentication, { kind: 'cursor' }>;
type Entry = { action: ProviderAuthenticationAction['action']; abort: AbortController; done: Promise<Authentication> };

/** Native CLI owns credentials and browser login; only a safe observation leaves this owner. */
export class CursorAuthentication {
  private pending?: Entry;
  private closed = false;
  private version?: string;
  constructor(private readonly changed: (value: Authentication) => void) {}

  async authenticate(request: ProviderAuthenticationAction): Promise<Authentication> {
    if (request.action === 'cancel') {
      const active = this.pending;
      active?.abort.abort();
      await active?.done.catch(() => {});
      return this.publish(this.state(false));
    }
    if (this.closed) throw new Error('Cursor connection is closed.');
    const previous = this.pending;
    if (previous && !(previous.action === 'check' && request.action === 'login')) throw new Error('Cursor authentication is already in progress.');
    const entry: Entry = { action: request.action, abort: new AbortController(), done: Promise.resolve(null as never) };
    this.pending = entry;
    entry.done = (async () => {
      if (previous) { previous.abort.abort(); await previous.done.catch(() => {}); }
      try {
        if (this.closed || entry.abort.signal.aborted) throw new Error('Cursor authentication cancelled.');
        const command = resolveCursorExecutable();
        if (!command) return this.publish(this.state(false, { supported: false, error: 'Install the Cursor CLI, then check again.' }));
        const version = (await this.run(command, ['--version'], entry)).trim();
        this.version = cursorVersion(version) !== null ? version : undefined;
        const supported = (cursorVersion(this.version) ?? 0) >= cursorVersion(cursorMinimumVersion)!;
        if (!supported) return this.publish(this.state(false, { supported: false, error: `Update Cursor CLI to ${cursorMinimumVersion} or newer.` }));
        if (request.action === 'login' || request.action === 'logout') await this.run(command, [request.action], entry, request.action === 'login');
        const raw: unknown = JSON.parse(await this.run(command, ['status', '--format', 'json'], entry));
        if (!record(raw) || typeof raw.isAuthenticated !== 'boolean') throw new Error('Invalid native status.');
        const info = record(raw.userInfo) ? raw.userInfo : {};
        const email = safeDisplay(info.email);
        const team = safeDisplay(info.teamName);
        return this.publish(this.state(raw.isAuthenticated, {
          supported: true,
          ...(raw.isAuthenticated && email ? { account: { type: 'subscription', email } } : {}),
          ...(raw.isAuthenticated && team ? { team } : {}),
        }));
      } catch {
        if (entry.abort.signal.aborted || this.closed) throw new Error('Cursor authentication cancelled.');
        throw new Error('Could not check Cursor authentication. Retry in Settings.');
      } finally { if (this.pending === entry) this.pending = undefined; }
    })();
    return entry.done;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pending?.abort.abort();
    await this.pending?.done.catch(() => {});
  }

  private state(loggedIn: boolean, extra: Partial<Authentication['state']> = {}): Authentication {
    return { kind: 'cursor', connected: loggedIn, state: {
      loggedIn, homePath: cursorHome(), ...(this.version ? { version: this.version } : {}), ...extra,
    } };
  }
  private publish(value: Authentication): Authentication { if (!this.closed) this.changed(value); return value; }

  private run(command: string, args: string[], entry: Entry, interactive = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: homedir(), env: cursorEnvironment(interactive), shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', failed = false;
      const signal = (value: NodeJS.Signals) => { try { if (process.platform === 'win32') child.kill(value); else if (child.pid) process.kill(-child.pid, value); } catch { /* Already exited. */ } };
      const stop = () => { failed = true; signal('SIGTERM'); };
      const deadline = setTimeout(stop, interactive ? 300_000 : 15_000);
      const killer = setTimeout(() => signal('SIGKILL'), interactive ? 301_000 : 16_000);
      let abortKill: ReturnType<typeof setTimeout> | undefined;
      const abort = () => { stop(); abortKill = setTimeout(() => signal('SIGKILL'), 1_000); };
      entry.abort.signal.addEventListener('abort', abort, { once: true });
      if (entry.abort.signal.aborted) abort();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (interactive) return;
        output += chunk;
        if (Buffer.byteLength(output) > 64 * 1024) { output = ''; stop(); }
      });
      // Drain diagnostics without forwarding or retaining URLs, identities or tokens.
      child.stderr.on('data', () => {});
      child.on('error', () => { failed = true; });
      child.once('close', code => {
        clearTimeout(deadline); clearTimeout(killer); clearTimeout(abortKill);
        entry.abort.signal.removeEventListener('abort', abort);
        signal('SIGKILL');
        if (failed || code !== 0 || entry.abort.signal.aborted) reject(new Error('Cursor command failed.'));
        else resolve(output);
      });
    });
  }
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function safeDisplay(value: unknown): string | undefined { return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 200) || undefined : undefined; }
