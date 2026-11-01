import { execFile } from 'node:child_process';
import { resolveRuntimeLaunch } from '@workspace/core/runtime-discovery';
import { GitHubWorkProviderDriver } from './github-driver';
import type { GitHubCliCredential, WorkProviderCredential } from './types';

/** GitHub API operations executed by the CLI on this daemon's host. */
export class GitHubCliWorkProviderDriver extends GitHubWorkProviderDriver {
  constructor() { super(''); }

  async detectConnection(): Promise<GitHubCliCredential | null> {
    try {
      const output = await this.run(['auth', 'status', '--active', '--hostname', 'github.com', '--json', 'hosts'], undefined, undefined, 10_000);
      const value: unknown = JSON.parse(output);
      if (!record(value) || !record(value.hosts) || !Array.isArray(value.hosts['github.com'])) return null;
      const account = value.hosts['github.com'].find((entry: unknown) => record(entry) && entry.active === true && entry.state === 'success' && entry.host === 'github.com');
      if (!record(account) || typeof account.login !== 'string' || !account.login.trim()) return null;
      return { kind: 'cli', provider: 'github', accountLabel: account.login, connectedAt: new Date().toISOString() };
    } catch { return null; }
  }

  protected override async apiResponse(credential: WorkProviderCredential, endpoint: string, init: RequestInit = {}): Promise<Response> {
    if (!('kind' in credential)) throw new Error('GitHub CLI access requires its own connection.');
    // gh follows its active account. Refuse stale identity rather than crossing accounts.
    const current = await this.detectConnection();
    if (!current || current.accountLabel !== credential.accountLabel) throw new Error('GitHub CLI authentication changed. Restart the app to use the new GitHub CLI account.');
    const args = ['api', endpoint, '--hostname', 'github.com', '--include', '--method', init.method ?? 'GET',
      '--header', 'Accept: application/vnd.github+json', '--header', 'X-GitHub-Api-Version: 2022-11-28'];
    if (init.body !== undefined && typeof init.body !== 'string') throw new Error('Invalid GitHub request body.');
    if (init.body) args.push('--input', '-');
    const output = await this.run(args, init.body || undefined, init.signal ?? undefined);
    const split = /\r?\n\r?\n/.exec(output);
    const status = /^HTTP\/\S+ (\d{3})/.exec(output);
    if (!split || !status) throw new Error('GitHub CLI returned an invalid response.');
    const headers = new Headers();
    for (const line of output.slice(0, split.index).split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    const statusCode = Number(status[1]);
    return new Response(statusCode === 204 ? null : output.slice(split.index + split[0].length), { status: statusCode, headers });
  }

  private run(args: string[], input?: string, signal?: AbortSignal, timeout = 30_000): Promise<string> {
    const launch = resolveRuntimeLaunch('gh', { GH_PROMPT_DISABLED: '1', GH_DEBUG: undefined, DEBUG: undefined });
    return new Promise((resolve, reject) => {
      const child = execFile(launch.command, args, { env: launch.env, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', signal }, (error, stdout) => {
        // Child errors can carry argv, stdout and stderr. Never propagate them.
        if (error) reject(new Error('GitHub CLI request failed. Check CLI authentication and repository access.'));
        else resolve(stdout);
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  }
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
