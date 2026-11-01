import { execFile } from 'node:child_process';
import { resolveRuntimeLaunch } from '@workspace/core/runtime-discovery';
import { GitLabWorkProviderDriver } from './gitlab-driver';
import { WorkProviderCliAuthenticationError, type WorkProviderCliCredential, type WorkProviderCredential } from './types';

/** Uses the owning host's authenticated glab; never reads or copies its token. */
export class GitLabCliWorkProviderDriver extends GitLabWorkProviderDriver {
  constructor() { super(''); }

  async detectConnection(): Promise<WorkProviderCliCredential | null> {
    try {
      const response = await this.request('user', {}, 10_000);
      if (!response.ok) return null;
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('username' in value) || typeof value.username !== 'string' || !value.username.trim()) return null;
      return { kind: 'cli', provider: 'gitlab', accountLabel: value.username, connectedAt: new Date().toISOString() };
    } catch { return null; }
  }

  protected override async apiResponse(credential: WorkProviderCredential, url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url);
    if (target.origin !== 'https://gitlab.com' || !target.pathname.startsWith('/api/v4/') || target.username || target.password || target.hash) throw new Error('Invalid GitLab API endpoint.');
    if (!('kind' in credential) || credential.provider !== 'gitlab') throw new Error('GitLab CLI access requires its own connection.');
    const current = await this.detectConnection();
    if (!current || current.accountLabel !== credential.accountLabel) throw new WorkProviderCliAuthenticationError('GitLab CLI authentication changed or is unavailable. Check glab auth login --hostname gitlab.com, then reconnect GitLab in Settings.');
    return this.request(`${target.pathname.slice('/api/v4/'.length)}${target.search}`, init);
  }

  private async request(endpoint: string, init: RequestInit, timeout = 30_000): Promise<Response> {
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') throw new Error('Invalid GitLab request body.');
    const args = ['api', endpoint, '--hostname', 'gitlab.com', '--include', '--method', init.method ?? 'GET', '--header', 'Accept: application/json'];
    for (const [name, value] of new Headers(init.headers)) {
      if (['authorization', 'private-token', 'job-token', 'host'].includes(name.toLowerCase())) throw new Error('GitLab CLI manages its own authorization.');
      args.push('--header', `${name}: ${value}`);
    }
    if (init.body !== undefined && init.body !== null) args.push('--input', '-');
    const launch = resolveRuntimeLaunch('glab', {
      GITLAB_HOST: 'gitlab.com', GITLAB_API_HOST: 'gitlab.com', GLAB_API_PROTOCOL: 'https',
      GITLAB_SUBFOLDER: '', GLAB_ENABLE_CI_AUTOLOGIN: 'false', GLAB_PROMPT_DISABLED: '1',
      GLAB_DEBUG: 'false', GLAB_DEBUG_HTTP: 'false', DEBUG: undefined, GLAB_CHECK_UPDATE: 'false',
    });
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(launch.command, args, { env: launch.env, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', signal: init.signal ?? undefined }, (error, stdout) => {
        // glab exits nonzero on HTTP errors, but includes the response for shared
        // provider error normalization. Never propagate errors, stderr or partial output.
        if (error && (typeof error.code !== 'number' || error.killed || error.signal || !/^HTTP\/\S+ [45]\d{2}/.test(stdout))) {
          reject(new Error('GitLab CLI request failed. Check glab installation, authentication and project access, then retry.'));
        } else resolve(stdout);
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(init.body ?? undefined);
    });
    const split = /\r?\n\r?\n/.exec(output);
    const status = /^HTTP\/\S+ (\d{3})/.exec(output);
    if (!split || !status) throw new Error('GitLab CLI returned an invalid response. Update glab and retry.');
    const headers = new Headers();
    for (const line of output.slice(0, split.index).split(/\r?\n/).slice(1)) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    const code = Number(status[1]);
    return new Response([204, 205, 304].includes(code) ? null : output.slice(split.index + split[0].length), { status: code, headers });
  }
}
