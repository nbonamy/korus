import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentGitPullRequest, GlobalWorkItemQuery, SourceBranch, WorkItem, WorkItemKind, WorkItemPage, WorkItemQuery, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { product } from '@workspace/core/product';
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

  async startAuthorization(options: { hostedMcp?: boolean } = {}): Promise<WorkProviderDeviceAuthorization> {
    if (!this.configured()) throw new Error('Configure the GitLab OAuth application with APP_GITLAB_CLIENT_ID on the owning host.');
    this.cancelAuthorization();
    const controller = new AbortController();
    this.authorization = controller;
    const value = await this.oauth('/oauth/authorize_device', { scope: options.hostedMcp ? `${SCOPE} mcp` : SCOPE }, controller.signal);
    if (!record(value) || !nonempty(value.device_code) || !nonempty(value.user_code)
      || value.verification_uri !== `${ORIGIN}/oauth/device` || !positive(value.expires_in)) {
      throw new Error(`GitLab could not start device authorization. Check the application ID and its ${options.hostedMcp ? 'api and mcp scopes' : 'api scope'}.`);
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

  async checkHostedMcp(token: WorkProviderToken): Promise<'available' | 'restricted' | 'unavailable'> {
    let forbidden = false;
    const client = new Client({ name: product.mcpServerName, version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(`${API}/mcp`), {
      requestInit: { headers: { Authorization: `${token.tokenType || 'Bearer'} ${token.accessToken}` } },
      fetch: async (url, init) => {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
        if (response.status === 403) forbidden = true;
        return response;
      },
    });
    try {
      await client.connect(transport, { timeout: 10_000 });
      await client.listTools({}, { timeout: 10_000 });
      return 'available';
    } catch {
      return forbidden ? 'restricted' : 'unavailable';
    } finally { await client.close().catch(() => {}); }
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

  async listItems(credential: WorkProviderCredential, repositoryId: string, query: WorkItemQuery = {}): Promise<WorkItem[]> {
    const path = projectPath(repositoryId);
    const items: WorkItem[] = [];
    for (const kind of itemKinds(query)) {
      const url = itemUrl(`/projects/${encodeURIComponent(path)}`, kind, query, 100, 1);
      const values = await this.pages(credential, url);
      items.push(...values.map(value => gitlabItem(value, kind, credential.accountLabel, repositoryId))
        .filter(item => matchesState(item, query)));
    }
    return items;
  }

  async listGlobalItems(credential: WorkProviderCredential, query: GlobalWorkItemQuery = {}): Promise<WorkItemPage> {
    const size = Math.max(1, Math.min(100, Math.trunc(query.pageSize ?? 50)));
    if (!Number.isFinite(size)) throw new Error('Invalid GitLab work item page size.');
    const kinds = itemKinds(query);
    const signature = JSON.stringify([query.assignment ?? 'all', query.kind ?? 'all', query.state ?? 'open', size, credential.accountLabel]);
    let cursor: { signature: string; source: string; kind: WorkItemKind; page: number };
    // GitLab.com restricts /issues?scope=all. Enumerate accessible projects for
    // the all-work feed instead; assigned-to-me uses the bounded global API.
    if (query.cursor) {
      try { if (JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))?.signature !== signature) throw new Error(); }
      catch { throw new Error('Invalid GitLab work item cursor. Refresh the feed.'); }
    }
    const sources = query.assignment === 'viewer' ? [''] : (await this.listSources(credential)).map(source => source.id);
    if (query.cursor) {
      try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); }
      catch { throw new Error('Invalid GitLab work item cursor. Refresh the feed.'); }
      if (!cursor || cursor.signature !== signature || !sources.includes(cursor.source) || !kinds.includes(cursor.kind)
        || !Number.isSafeInteger(cursor.page) || cursor.page < 1) throw new Error('Invalid GitLab work item cursor. Refresh the feed.');
    } else {
      if (!sources.length) return { items: [] };
      cursor = { signature, source: sources[0]!, kind: kinds[0]!, page: 1 };
    }
    for (let scanned = 0; scanned < 10_000; scanned++) {
      const prefix = cursor.source ? `/projects/${encodeURIComponent(projectPath(cursor.source))}` : '';
      const url = itemUrl(prefix, cursor.kind, query, size, cursor.page);
      const page = await this.page(credential, url, size);
      const items = page.values.map(value => gitlabItem(value, cursor.kind, credential.accountLabel, cursor.source || undefined))
        .filter(item => matchesState(item, query));
      let next = page.next ? { ...cursor, page: Number(new URL(page.next).searchParams.get('page')) } : undefined;
      if (!next) {
        const kindIndex = kinds.indexOf(cursor.kind), sourceIndex = sources.indexOf(cursor.source);
        if (kindIndex + 1 < kinds.length) next = { ...cursor, kind: kinds[kindIndex + 1]!, page: 1 };
        else if (sourceIndex + 1 < sources.length) next = { ...cursor, source: sources[sourceIndex + 1]!, kind: kinds[0]!, page: 1 };
      }
      if (items.length || !next) return { items, ...(next ? { nextCursor: Buffer.from(JSON.stringify(next)).toString('base64url') } : {}) };
      cursor = next;
    }
    throw new Error('GitLab pagination could not complete. Narrow the backlog and retry.');
  }

  async listAssignedItems(credential: WorkProviderCredential): Promise<WorkItem[]> {
    const items: WorkItem[] = [], visited = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.listGlobalItems(credential, { assignment: 'viewer', pageSize: 100, ...(cursor ? { cursor } : {}) });
      items.push(...page.items);
      cursor = page.nextCursor;
      if (cursor && (visited.has(cursor) || visited.size >= 10_000)) throw new Error('GitLab pagination could not complete. Retry.');
      if (cursor) visited.add(cursor);
    } while (cursor);
    return items;
  }

  async findPullRequest(credential: WorkProviderCredential, repositoryId: string, branch: string): Promise<AgentGitPullRequest | null> {
    const path = projectPath(repositoryId);
    const url = new URL(`${API}/projects/${encodeURIComponent(path)}/merge_requests`);
    url.search = new URLSearchParams({ state: 'opened', scope: 'all', source_branch: branch, per_page: '100', page: '1' }).toString();
    const values = await this.pages(credential, url.href);
    for (const value of values) {
      const request = gitlabRequest(value, path);
      if (!record(value) || value.source_branch !== branch) throw new Error('GitLab returned an unexpected merge request branch.');
      // A fork can use the same branch name. It is not this checkout's branch.
      if (value.source_project_id === value.target_project_id) return request;
    }
    return null;
  }

  async getPullRequest(credential: WorkProviderCredential, repositoryId: string, number: number): Promise<AgentGitPullRequest | null> {
    const path = projectPath(repositoryId);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid GitLab merge request number.');
    const response = await this.api(credential, `${API}/projects/${encodeURIComponent(path)}/merge_requests/${number}`);
    const result = gitlabRequest(await this.requestJson(response), path);
    if (result.number !== number) throw new Error('GitLab returned an unexpected merge request.');
    return result;
  }

  async createPullRequest(credential: WorkProviderCredential, repositoryId: string, input: { branch: string; title: string; body: string }): Promise<AgentGitPullRequest> {
    const path = projectPath(repositoryId);
    const endpoint = `${API}/projects/${encodeURIComponent(path)}`;
    const project = await this.requestJson(await this.api(credential, endpoint));
    if (!record(project) || !nonempty(project.default_branch)) throw new Error('GitLab project has no default branch.');
    const title = input.title.trim();
    if (!title || !input.branch.trim() || input.branch === project.default_branch) throw new Error('Choose a feature branch and title for the merge request.');
    const response = await this.api(credential, `${endpoint}/merge_requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_branch: input.branch, target_branch: project.default_branch,
        title: /^(draft|wip):/i.test(title) ? title : `Draft: ${title}`, description: input.body }),
    });
    return gitlabRequest(await this.requestJson(response), path);
  }

  private async requestJson(response: Response): Promise<unknown> {
    try { return await response.json(); } catch { throw new Error('GitLab returned an invalid merge request response.'); }
  }

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
    try { return await fetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), Accept: 'application/json', Authorization: `${token.tokenType || 'Bearer'} ${token.accessToken}` },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), redirect: 'error',
    }); } catch { throw new Error('GitLab is unavailable. Check the connection and try again.'); }
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
      const page = await this.page(credential, next, 100);
      result.push(...page.values);
      next = page.next;
    }
    return result;
  }

  private async page(credential: WorkProviderCredential, url: string, size: number): Promise<{ values: unknown[]; next: string | null }> {
    const current = new URL(url);
    const response = await this.api(credential, url);
    let values: unknown;
    try { values = await response.json(); } catch { throw new Error('GitLab returned an invalid catalog response.'); }
    if (!Array.isArray(values)) throw new Error('GitLab returned an invalid catalog response.');
    const linkedNext = response.headers.get('link')?.split(',').find(part => /rel="?next"?/.test(part))?.match(/<([^>]+)>/)?.[1];
    let next: string | null = null;
    if (linkedNext) {
      const target = new URL(linkedNext, current);
      if (target.origin !== ORIGIN || target.pathname !== current.pathname || target.username || target.password || target.hash) throw new Error('Invalid GitLab pagination link.');
      // Preserve our query, taking only the page from the link. GitLab adds
      // default parameters to links; they must not replace our original scope.
      const page = target.searchParams.get('page');
      target.searchParams.delete('page');
      const expected = new URL(current); expected.searchParams.delete('page');
      if ([...target.searchParams].some(([key, value]) => expected.searchParams.has(key) && expected.searchParams.get(key) !== value) || !page || !/^\d+$/.test(page) || Number(page) <= Number(current.searchParams.get('page') ?? 1)) throw new Error('Invalid GitLab pagination page.');
      current.searchParams.set('page', page); next = current.href;
    } else if (response.headers.has('x-next-page')) {
      const page = response.headers.get('x-next-page')!;
      if (page) {
        if (!/^\d+$/.test(page) || Number(page) <= Number(current.searchParams.get('page') ?? 1)) throw new Error('Invalid GitLab pagination page.');
        current.searchParams.set('page', page); next = current.href;
      }
    } else if (values.length === size) {
      current.searchParams.set('page', String(Number(current.searchParams.get('page') ?? 1) + 1)); next = current.href;
    }
    return { values, next };
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

function projectPath(id: string): string {
  if (!id.startsWith('gitlab.com/') || !validProjectPath(id.slice(11))) throw new Error('Invalid GitLab repository identity.');
  return id.slice(11);
}
function itemKinds(query: WorkItemQuery): WorkItemKind[] {
  return query.kind && query.kind !== 'all' ? [query.kind] : ['issue', 'pullRequest'];
}
function itemUrl(prefix: string, kind: WorkItemKind, query: GlobalWorkItemQuery, size: number, page: number): string {
  const url = new URL(`${API}${prefix}/${kind === 'issue' ? 'issues' : 'merge_requests'}`);
  url.search = new URLSearchParams({ scope: query.assignment === 'viewer' ? 'assigned_to_me' : 'all',
    state: query.state === 'closed' && kind === 'pullRequest' ? 'all' : query.state === 'open' || !query.state ? 'opened' : query.state,
    order_by: 'updated_at', sort: 'desc', per_page: String(size), page: String(page) }).toString();
  return url.href;
}
function matchesState(item: WorkItem, query: WorkItemQuery): boolean {
  return query.state === 'all' || item.state === (query.state ?? 'open');
}
function gitlabItem(value: unknown, kind: WorkItemKind, viewer?: string, expectedSource?: string): WorkItem {
  if (!record(value) || !Number.isSafeInteger(value.iid) || Number(value.iid) <= 0 || !nonempty(value.web_url)
    || !nonempty(value.title) || !nonempty(value.created_at) || !nonempty(value.updated_at)
    || !['opened', 'closed', 'merged', 'locked'].includes(String(value.state)) || !Array.isArray(value.labels) || !Array.isArray(value.assignees)) throw new Error('GitLab returned an invalid work item. Refresh the backlog.');
  const url = new URL(value.web_url);
  const suffix = `/-/${kind === 'issue' ? 'issues' : 'merge_requests'}/${value.iid}`;
  const path = url.pathname.slice(1, -suffix.length);
  if (url.origin !== ORIGIN || !url.pathname.endsWith(suffix) || url.search || url.hash || url.username || url.password || !validProjectPath(path)
    || expectedSource && expectedSource !== `gitlab.com/${path}`) throw new Error('GitLab returned an invalid work item identity.');
  const assignees = value.assignees.map(assignee => {
    if (!record(assignee) || !nonempty(assignee.username)) throw new Error('GitLab returned an invalid assignee.');
    return assignee.username;
  });
  const identifier = `${kind === 'issue' ? '#' : '!'}${value.iid}`;
  return { provider: 'gitlab', id: `gitlab.com/${path}${identifier}`, kind,
    sourceId: `gitlab.com/${path}`, sourceName: path, number: Number(value.iid), identifier,
    nativeState: String(value.state), state: value.state === 'opened' || value.state === 'locked' ? 'open' : 'closed',
    assignedToViewer: Boolean(viewer && assignees.includes(viewer)), title: value.title, url: value.web_url,
    ...(typeof value.description === 'string' ? { body: value.description } : {}),
    ...(record(value.author) && nonempty(value.author.username) ? { authorName: value.author.username } : {}),
    ...(kind === 'pullRequest' && nonempty(value.source_branch) ? { branchName: value.source_branch } : {}), assignees,
    labels: value.labels.map(label => {
      if (typeof label === 'string') return { name: label };
      if (record(label) && nonempty(label.name)) return { name: label.name, ...(nonempty(label.color) ? { color: label.color } : {}) };
      throw new Error('GitLab returned an invalid label.');
    }), createdAt: value.created_at, updatedAt: value.updated_at };
}

function gitlabRequest(value: unknown, path: string): AgentGitPullRequest {
  if (!record(value) || !Number.isSafeInteger(value.iid) || Number(value.iid) <= 0 || !nonempty(value.title)
    || value.web_url !== `${ORIGIN}/${path}/-/merge_requests/${value.iid}` || !nonempty(value.sha)
    || !['opened', 'closed', 'merged'].includes(String(value.state)) || typeof value.draft !== 'boolean'
    || !positive(value.source_project_id) || !positive(value.target_project_id)) throw new Error('GitLab returned an invalid merge request response.');
  return { number: Number(value.iid), title: value.title, url: String(value.web_url), draft: value.draft,
    headSha: value.sha, state: value.state === 'opened' ? 'open' : value.state as 'merged' | 'closed',
    ...(nonempty(value.merged_at) ? { mergedAt: value.merged_at } : {}) };
}
