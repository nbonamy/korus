import type { SourceBranch, WorkItem, WorkItemPage, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { runtimeGitLabOAuthClientId } from '../runtime-config';
import { requireWorkProviderToken, type WorkProviderCredential, type WorkProviderDeviceAuthorization, type WorkProviderDeviceTokenResult, type WorkProviderDriver } from './types';

const ORIGIN = 'https://gitlab.com';
const API = `${ORIGIN}/api/v4`;
const SCOPE = 'api';

/** GitLab.com public-client device authorization. Credentials never leave daemon. */
export class GitLabWorkProviderDriver implements WorkProviderDriver {
  readonly provider = 'gitlab' as const;
  private authorization: AbortController | undefined;
  private intervalSeconds = 5;

  constructor(private readonly clientIdProvider: string | (() => string | null | undefined) = runtimeGitLabOAuthClientId) {}

  configured(): boolean { return Boolean(this.clientId()); }

  cancelAuthorization(): void {
    this.authorization?.abort();
    this.authorization = undefined;
  }

  async startAuthorization(): Promise<WorkProviderDeviceAuthorization> {
    if (!this.configured()) throw new Error('Configure the GitLab OAuth application with APP_GITLAB_CLIENT_ID on the owning host.');
    this.cancelAuthorization();
    const controller = new AbortController();
    this.authorization = controller;
    const value = await this.oauth('/oauth/authorize_device', { scope: SCOPE }, controller.signal);
    if (!record(value) || !nonempty(value.device_code) || !nonempty(value.user_code)
      || value.verification_uri !== `${ORIGIN}/oauth/device` || !positive(value.expires_in)) {
      throw new Error('GitLab could not start device authorization. Check the application ID and its api scope.');
    }
    this.intervalSeconds = positive(value.interval) ? value.interval : 5;
    return {
      provider: 'gitlab', deviceCode: value.device_code, userCode: value.user_code,
      verificationUri: value.verification_uri,
      expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString(), intervalSeconds: this.intervalSeconds,
    };
  }

  async pollAuthorization(deviceCode: string): Promise<WorkProviderDeviceTokenResult> {
    if (!this.configured()) return { status: 'error', code: 'not_configured', message: 'GitLab OAuth is not configured.' };
    try {
      const value = await this.oauth('/oauth/token', { device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }, this.authorization?.signal);
      if (record(value) && (value.error === 'authorization_pending' || value.error === 'slow_down')) {
        if (value.error === 'slow_down') this.intervalSeconds += 5;
        return { status: 'pending', intervalSeconds: this.intervalSeconds };
      }
      if (record(value) && value.error === 'access_denied') return { status: 'error', code: 'access_denied', message: 'GitLab authorization was cancelled.' };
      if (record(value) && value.error === 'expired_token') return { status: 'error', code: 'expired', message: 'GitLab authorization expired. Connect again.' };
      return { status: 'success', token: tokenResponse(value) };
    } catch {
      return { status: 'error', code: 'unavailable', message: 'GitLab authorization is unavailable. Check the application configuration and try again.' };
    }
  }

  async refreshToken(token: WorkProviderToken): Promise<WorkProviderToken> {
    if (!this.configured() || !token.refreshToken) throw new Error('GitLab needs to be reconnected.');
    const value = await this.oauth('/oauth/token', { grant_type: 'refresh_token', refresh_token: token.refreshToken });
    const next = tokenResponse(value);
    if (!next.refreshToken) throw new Error('GitLab needs to be reconnected.');
    return { ...token, ...next };
  }

  async currentAccountLabel(credential: WorkProviderCredential): Promise<string> {
    const response = await this.api(credential, `${API}/user`);
    const value: unknown = await response.json();
    if (!record(value) || !nonempty(value.username)) throw new Error('GitLab returned an invalid account.');
    return value.username;
  }

  async listSources(credential: WorkProviderCredential): Promise<WorkSource[]> {
    // Role-based access includes inherited group and shared project permissions.
    const values = await this.pages(credential, `${API}/projects?min_access_level=10&order_by=id&sort=asc&per_page=100&page=1`);
    return values.map(value => {
      if (!record(value) || !nonempty(value.path_with_namespace) || !nonempty(value.path)
        || !validProjectPath(value.path_with_namespace) || value.path !== value.path_with_namespace.split('/').at(-1)
        || value.web_url !== `${ORIGIN}/${value.path_with_namespace}` || !nonempty(value.visibility)) {
        throw new Error('GitLab returned an invalid project. Refresh the repository catalog.');
      }
      const fullName = value.path_with_namespace;
      return {
        provider: 'gitlab', id: `gitlab.com/${fullName}`, owner: fullName.slice(0, fullName.lastIndexOf('/')),
        name: value.path, fullName, url: value.web_url, isPrivate: value.visibility !== 'public',
        ...(nonempty(value.last_activity_at) ? { updatedAt: value.last_activity_at } : {}),
      };
    });
  }

  async listBranches(credential: WorkProviderCredential, repositoryId: string): Promise<SourceBranch[]> {
    if (!repositoryId.startsWith('gitlab.com/') || !validProjectPath(repositoryId.slice(11))) throw new Error('Invalid GitLab repository identity.');
    const projectPath = encodeURIComponent(repositoryId.slice(11));
    const values = await this.pages(credential, `${API}/projects/${projectPath}/repository/branches?per_page=100&page=1`);
    return values.map(value => {
      if (!record(value) || !nonempty(value.name) || typeof value.default !== 'boolean') throw new Error('GitLab returned an invalid branch.');
      return { name: value.name, isDefault: value.default };
    }).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }

  // Backlog operations are a separate capability implemented by the work-item adapter.
  async listItems(): Promise<WorkItem[]> { throw new Error('GitLab work-item browsing is unavailable.'); }
  async listGlobalItems(): Promise<WorkItemPage> { throw new Error('GitLab work-item browsing is unavailable.'); }

  private clientId(): string { return (typeof this.clientIdProvider === 'function' ? this.clientIdProvider() : this.clientIdProvider)?.trim() ?? ''; }

  private async oauth(endpoint: string, parameters: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${ORIGIN}${endpoint}`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId(), ...parameters }).toString(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), redirect: 'error',
    });
    // OAuth errors use HTTP 400. Never forward raw provider bodies into snapshots/logs.
    if (!response.ok && response.status !== 400 && response.status !== 401) throw new Error('GitLab authorization is unavailable.');
    return response.json();
  }

  protected async apiResponse(credential: WorkProviderCredential, url: string, init: RequestInit = {}): Promise<Response> {
    const token = requireWorkProviderToken(credential);
    return fetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), Accept: 'application/json', Authorization: `${token.tokenType || 'Bearer'} ${token.accessToken}` },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), redirect: 'error',
    });
  }

  protected async api(credential: WorkProviderCredential, url: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.apiResponse(credential, url, init);
    if (!response.ok) {
      if (response.status === 401) throw new Error('GitLab authorization expired. Reconnect GitLab in Settings.');
      if (response.status === 403) throw new Error('GitLab denied access. Check project membership and the application api scope.');
      if (response.status === 404) throw new Error('GitLab project is unavailable. Refresh the catalog and check project access.');
      if (response.status === 429) throw new Error('GitLab rate limit reached. Wait and try again.');
      throw new Error('GitLab is unavailable. Try again.');
    }
    return response;
  }

  private async pages(credential: WorkProviderCredential, first: string): Promise<unknown[]> {
    const result: unknown[] = [], visited = new Set<string>();
    let next: string | null = first;
    while (next) {
      if (visited.has(next) || visited.size >= 10_000) throw new Error('GitLab pagination could not complete. Narrow the catalog and retry.');
      visited.add(next);
      const current: URL = new URL(next);
      const response = await this.api(credential, next);
      const values: unknown = await response.json();
      if (!Array.isArray(values)) throw new Error('GitLab returned an invalid catalog response.');
      result.push(...values);
      const link = response.headers.get('link');
      const linkedNext = link?.split(',').find(part => /rel="?next"?/.test(part))?.match(/<([^>]+)>/)?.[1];
      if (linkedNext) {
        const target: URL = new URL(linkedNext, current);
        if (target.origin !== ORIGIN || target.pathname !== current.pathname || target.username || target.password || target.hash) throw new Error('Invalid GitLab pagination link.');
        next = target.href;
      } else if (response.headers.has('x-next-page')) {
        const page = response.headers.get('x-next-page')!;
        if (!page) next = null;
        else {
          if (!/^\d+$/.test(page) || Number(page) <= Number(current.searchParams.get('page') ?? 1)) throw new Error('Invalid GitLab pagination page.');
          current.searchParams.set('page', page); next = current.href;
        }
      } else if (values.length === 100) {
        // Some GitLab deployments omit pagination headers: fetch until a short page.
        current.searchParams.set('page', String(Number(current.searchParams.get('page') ?? 1) + 1)); next = current.href;
      } else next = null;
    }
    return result;
  }
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function validProjectPath(value: string): boolean { return value.includes('/') && value.split('/').every(segment => /^[\w.-]+$/.test(segment) && segment !== '.' && segment !== '..'); }
function tokenResponse(value: unknown): Omit<WorkProviderToken, 'provider' | 'connectedAt'> {
  if (!record(value) || !nonempty(value.access_token) || !positive(value.expires_in)) throw new Error('GitLab returned an invalid token response. Reconnect GitLab.');
  return {
    accessToken: value.access_token, tokenType: nonempty(value.token_type) ? value.token_type : 'Bearer',
    expiresAt: new Date(Date.now() + value.expires_in * 1000).toISOString(),
    ...(nonempty(value.refresh_token) ? { refreshToken: value.refresh_token } : {}),
    ...(typeof value.scope === 'string' ? { scope: value.scope } : {}),
  };
}
