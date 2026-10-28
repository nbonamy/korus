import type { SourceBranch, AgentGitPullRequest, GlobalWorkItemQuery, WorkItem, WorkItemLabel, WorkItemPage, WorkItemQuery, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { runtimeGitHubOAuthClientId } from '../runtime-config';
import { requireWorkProviderToken, type WorkProviderCredential, type WorkProviderDeviceAuthorization, type WorkProviderDeviceTokenResult, type WorkProviderDriver } from './types';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_OAUTH_BASE_URL = 'https://github.com/login';
const GITHUB_API_VERSION = '2022-11-28';
const DEFAULT_SCOPE = 'repo read:user read:org';

export class GitHubWorkProviderDriver implements WorkProviderDriver {
  readonly provider = 'github' as const;

  constructor(private readonly clientIdProvider: string | (() => string | null | undefined) = runtimeGitHubOAuthClientId) {}

  configured(): boolean {
    return Boolean(this.clientId().trim());
  }

  async startAuthorization(): Promise<WorkProviderDeviceAuthorization> {
    if (!this.configured()) {
      throw new Error('GitHub OAuth is not configured. Add a GitHub OAuth app client ID in Settings or set APP_GITHUB_CLIENT_ID.');
    }

    const response = await githubOAuthRequest(`${GITHUB_OAUTH_BASE_URL}/device/code`, {
      client_id: this.clientId(),
      scope: DEFAULT_SCOPE,
    });

    if (isRecord(response) && typeof response.error === 'string') {
      throw new Error(githubOAuthErrorMessage(response));
    }

    if (!isRecord(response) ||
      typeof response.device_code !== 'string' ||
      typeof response.user_code !== 'string' ||
      typeof response.verification_uri !== 'string' ||
      typeof response.expires_in !== 'number'
    ) {
      throw new Error('GitHub returned an invalid device authorization response.');
    }

    return {
      provider: 'github',
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      expiresAt: new Date(Date.now() + response.expires_in * 1000).toISOString(),
      intervalSeconds: typeof response.interval === 'number' ? response.interval : 5,
    };
  }

  async pollAuthorization(deviceCode: string): Promise<WorkProviderDeviceTokenResult> {
    if (!this.configured()) {
      return {
        status: 'error',
        code: 'not_configured',
        message: 'GitHub OAuth is not configured.',
      };
    }

    const response = await githubOAuthRequest(`${GITHUB_OAUTH_BASE_URL}/oauth/access_token`, {
      client_id: this.clientId(),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (isRecord(response) && typeof response.error === 'string') {
      if (response.error === 'authorization_pending') {
        return {
          status: 'pending',
          ...(typeof response.interval === 'number' ? { intervalSeconds: response.interval } : {}),
        };
      }

      if (response.error === 'slow_down') {
        return {
          status: 'pending',
          intervalSeconds: typeof response.interval === 'number' ? response.interval : undefined,
        };
      }

      if (response.error === 'expired_token') {
        return {
          status: 'error',
          code: 'expired',
          message: 'The GitHub verification code expired. Start the connection again.',
        };
      }

      if (response.error === 'access_denied') {
        return {
          status: 'error',
          code: 'access_denied',
          message: 'GitHub authorization was cancelled.',
        };
      }

      return {
        status: 'error',
        code: 'unavailable',
        message: githubOAuthErrorMessage(response),
      };
    }

    if (!isRecord(response) || typeof response.access_token !== 'string') {
      return {
        status: 'error',
        code: 'unavailable',
        message: 'GitHub returned an invalid access token response.',
      };
    }

    return {
      status: 'success',
      token: {
        accessToken: response.access_token,
        tokenType: typeof response.token_type === 'string' ? response.token_type : 'bearer',
        ...(typeof response.scope === 'string' ? { scope: response.scope } : {}),
        ...(typeof response.expires_in === 'number' ? { expiresAt: expiresAt(response.expires_in) } : {}),
        ...(typeof response.refresh_token === 'string' ? { refreshToken: response.refresh_token } : {}),
        ...(typeof response.refresh_token_expires_in === 'number'
          ? { refreshTokenExpiresAt: expiresAt(response.refresh_token_expires_in) }
          : {}),
      },
    };
  }

  async refreshToken(token: WorkProviderToken): Promise<WorkProviderToken> {
    if (!this.configured() || !token.refreshToken) {
      throw new Error('GitHub needs to be reconnected.');
    }

    const response = await githubOAuthRequest(`${GITHUB_OAUTH_BASE_URL}/oauth/access_token`, {
      client_id: this.clientId(),
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });
    if (isRecord(response) && typeof response.error === 'string') {
      throw new Error(githubOAuthErrorMessage(response));
    }
    if (!isRecord(response) || typeof response.access_token !== 'string') {
      throw new Error('GitHub returned an invalid refreshed access token response.');
    }

    const refreshedToken: WorkProviderToken = {
      ...token,
      accessToken: response.access_token,
      tokenType: typeof response.token_type === 'string' ? response.token_type : token.tokenType,
      ...(typeof response.scope === 'string' ? { scope: response.scope } : {}),
      refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : token.refreshToken,
    };
    if (typeof response.expires_in === 'number') refreshedToken.expiresAt = expiresAt(response.expires_in);
    else delete refreshedToken.expiresAt;
    if (typeof response.refresh_token_expires_in === 'number') {
      refreshedToken.refreshTokenExpiresAt = expiresAt(response.refresh_token_expires_in);
    } else {
      delete refreshedToken.refreshTokenExpiresAt;
    }
    return refreshedToken;
  }

  async currentAccountLabel(token: WorkProviderCredential): Promise<string> {
    const user = await this.apiRequest(token, '/user');
    if (!isRecord(user) || typeof user.login !== 'string') {
      throw new Error('GitHub returned an invalid user response.');
    }

    return user.login;
  }

  async listSources(token: WorkProviderCredential): Promise<WorkSource[]> {
    const [repositoryResponse, activityResponse] = await Promise.all([
      this.apiRequest(token, '/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100'),
      this.apiRequest(token, '/issues?filter=all&state=open&sort=updated&direction=desc&per_page=100', {
        signal: AbortSignal.timeout(2_000),
      }).catch(() => null),
    ]);
    if (!Array.isArray(repositoryResponse)) {
      throw new Error('GitHub returned an invalid repositories response.');
    }

    const repositories = repositoryResponse.map(githubRepository).filter((repository): repository is WorkSource => Boolean(repository));
    const activityByRepository = Array.isArray(activityResponse)
      ? githubRepositoryWorkItemActivity(activityResponse)
      : new Map<string, string>();
    return repositories.map((repository) => {
      const workItemsUpdatedAt = activityByRepository.get(repository.id);
      return workItemsUpdatedAt ? { ...repository, workItemsUpdatedAt } : repository;
    });
  }

  async listBranches(token: WorkProviderCredential, repositoryId: string): Promise<SourceBranch[]> {
    const repository = parseRepositoryId(repositoryId);
    if (!repository) throw new Error('Invalid GitHub repository.');
    const [primary, names] = await Promise.all([this.defaultBranch(token, repositoryId), (async () => {
      const names = new Set<string>();
      for (let page = 1; page <= 20; page++) {
        const response = await this.apiPageRequest(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/branches?per_page=100&page=${page}`);
        if (!Array.isArray(response.value)) throw new Error('GitHub returned an invalid branches response.');
        for (const entry of response.value) {
          if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name) throw new Error('GitHub returned an invalid branch.');
          names.add(entry.name);
        }
        if (!linkedPageUrl(response.linkHeader, 'next')) return [...names];
      }
      throw new Error('This repository has too many branches to browse.');
    })()]);
    return names.map(name => ({ name, isDefault: name === primary }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }

  async listGlobalItems(token: WorkProviderCredential, query: GlobalWorkItemQuery = {}): Promise<WorkItemPage> {
    const viewer = query.repositoryScope ? token.accountLabel ?? await this.currentAccountLabel(token) : token.accountLabel;
    const owners = query.repositoryScope ? await this.managedRepositoryOwners(token, viewer!) : undefined;
    return this.listGlobalItemsPage(viewer ? { ...token, accountLabel: viewer } : token, query, owners);
  }

  private async managedRepositoryOwners(token: WorkProviderCredential, viewer: string): Promise<string[]> {
    const organizations = new Set<string>();
    const visited = new Set<string>();
    let after: string | null = null;
    do {
      // App user tokens can return an empty REST membership list despite an
      // organization-admin role. Organization-owned repository metadata exposes
      // that role without relying on the membership-list permission boundary.
      const response = await this.apiRequest(token, '/graphql', { method: 'POST', body: JSON.stringify({
        query: `query AdministeredRepositoryOwners($after: String) {
          viewer { login repositories(first: 100, after: $after, affiliations: [ORGANIZATION_MEMBER]) {
            nodes { owner { login ... on Organization { viewerCanAdminister } } }
            pageInfo { hasNextPage endCursor }
          } }
        }`, variables: { after },
      }) });
      const user = isRecord(response) && isRecord(response.data) ? response.data.viewer : null;
      const repositories = isRecord(user) ? user.repositories : null;
      if (!isRecord(response) || response.errors || !isRecord(user) || typeof user.login !== 'string'
        || user.login.toLowerCase() !== viewer.toLowerCase() || !isRecord(repositories)
        || !Array.isArray(repositories.nodes) || !isRecord(repositories.pageInfo)
        || typeof repositories.pageInfo.hasNextPage !== 'boolean') {
        throw new Error('GitHub could not determine administered organizations. Check the GitHub connection.');
      }
      for (const node of repositories.nodes) {
        const owner = isRecord(node) ? node.owner : null;
        if (!isRecord(owner) || typeof owner.login !== 'string' || !owner.login.trim()
          || typeof owner.viewerCanAdminister !== 'boolean') throw new Error('GitHub returned invalid organization ownership.');
        if (owner.viewerCanAdminister) organizations.add(owner.login.toLowerCase());
      }
      const info = repositories.pageInfo;
      after = info.hasNextPage ? typeof info.endCursor === 'string' && info.endCursor ? info.endCursor : '' : null;
      if (after === '' || after !== null && visited.has(after)) throw new Error('GitHub organization pagination could not complete.');
      if (after) visited.add(after);
    } while (after);
    organizations.delete(viewer.toLowerCase());
    return [viewer.toLowerCase(), ...[...organizations].sort()];
  }

  private async listGlobalItemsPage(token: WorkProviderCredential, query: GlobalWorkItemQuery, owners?: string[]): Promise<WorkItemPage> {
    if ((query.repositoryScope === 'owned' || query.involvement) && query.repositoryScope !== 'notOwned' && (!query.kind || query.kind === 'all')) {
      return this.listMixedSearchItems(token, query, owners);
    }
    let page = query.cursor === undefined ? 1 : Number(query.cursor);
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid work item page.');
    const pageSize = Math.max(1, Math.min(100, Math.trunc(query.pageSize ?? 50)));
    if (query.repositoryScope !== 'notOwned' && (query.repositoryScope || query.involvement || (query.kind && query.kind !== 'all'))) {
      const qualifiers: string[] = [];
      if (query.kind && query.kind !== 'all') qualifiers.push(query.kind === 'issue' ? 'is:issue' : 'is:pull-request');
      if ((query.state ?? 'open') !== 'all') qualifiers.push(`is:${query.state ?? 'open'}`);
      if (query.repositoryScope || query.involvement || query.assignment === 'viewer') {
        const viewer = token.accountLabel ?? await this.currentAccountLabel(token);
        if (query.repositoryScope === 'owned') qualifiers.push(`user:${viewer}`, ...(owners ?? []).slice(1).map(owner => `org:${owner}`));
        if (query.involvement || query.assignment === 'viewer') {
          const field = query.involvement === 'author' ? 'author' : query.involvement === 'reviewer' ? 'review-requested' : 'assignee';
          qualifiers.push(`${field}:${viewer}`);
        }
      }
      const params = new URLSearchParams({ q: qualifiers.join(' '), sort: 'updated', order: 'desc', per_page: String(pageSize), page: String(page) });
      const response = await this.apiPageRequest(token, `/search/issues?${params}`);
      if (!isRecord(response.value) || !Array.isArray(response.value.items)) throw new Error('GitHub returned an invalid work item search response.');
      return {
        items: response.value.items.map(githubAssignedIssue).filter((item): item is WorkItem => item !== null)
          .map(item => ({ ...item, assignedToViewer: Boolean(token.accountLabel && item.assignees?.includes(token.accountLabel)) })),
        ...(linkedPageUrl(response.linkHeader, 'next') ? { nextCursor: String(page + 1) } : {}),
        ...(typeof response.value.total_count === 'number' ? { totalItems: response.value.total_count } : {}),
      };
    }
    const assignment = query.assignment === 'viewer' ? 'assigned' : 'all';
    const state = query.state ?? 'open';
    const outsideOwners = query.repositoryScope === 'notOwned' ? new Set(owners) : null;
    // Keep the account's accessible work feed as the boundary. A negative owner
    // search would also include unrelated public repositories across GitHub.
    for (let scanned = 0; scanned < 10_000; scanned++, page++) {
      const path = `/issues?filter=${assignment}&state=${state}&sort=updated&direction=desc&per_page=${pageSize}&page=${page}`;
      const response = await this.apiPageRequest(token, path);
      if (!Array.isArray(response.value)) throw new Error('GitHub returned an invalid global issues response.');
      const items = response.value.map(githubAssignedIssue)
        .filter((item): item is WorkItem => item !== null)
        .filter(item => query.kind === undefined || query.kind === 'all' || item.kind === query.kind)
        .filter(item => !outsideOwners || !outsideOwners.has(item.sourceId.split('/')[0]!.toLowerCase()));
      const next = linkedPageUrl(response.linkHeader, 'next');
      if (outsideOwners && !items.length && next) continue;
      return {
        items: items.map(item => ({ ...item, assignedToViewer: Boolean(token.accountLabel && item.assignees?.includes(token.accountLabel)) })),
        ...(next ? { nextCursor: String(page + 1) } : {}),
      };
    }
    throw new Error('GitHub pagination could not complete. Narrow the backlog and retry.');
  }

  private async listMixedSearchItems(token: WorkProviderCredential, query: GlobalWorkItemQuery, owners?: string[]): Promise<WorkItemPage> {
    const viewer = token.accountLabel ?? await this.currentAccountLabel(token);
    const size = Math.max(1, Math.min(100, Math.trunc(query.pageSize ?? 50)));
    const signature = JSON.stringify([viewer, query.repositoryScope, query.involvement, query.assignment ?? 'all', query.state ?? 'open', size, owners]);
    if (!Number.isFinite(size)) throw new Error('Invalid work item page size.');
    type Position = { page: number; offset: number } | null;
    let cursor: { signature: string; issue: Position; pullRequest: Position } = {
      signature, issue: { page: 1, offset: 0 }, pullRequest: { page: 1, offset: 0 },
    };
    if (query.cursor !== undefined) {
      const validPosition = (value: unknown): boolean => value === null || (isRecord(value)
        && Number.isSafeInteger(value.page) && Number(value.page) >= 1
        && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) < size);
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!cursor || cursor.signature !== signature || !validPosition(cursor.issue) || !validPosition(cursor.pullRequest)) throw new Error();
      } catch { throw new Error('Invalid GitHub work item cursor. Refresh the feed.'); }
    }
    const feeds = (['issue', 'pullRequest'] as const).map(kind => ({
      kind, position: cursor[kind], items: [] as WorkItem[], nextPage: undefined as number | undefined, loaded: false,
    }));
    const load = async (feed: typeof feeds[number]) => {
      while (feed.position && !feed.loaded) {
        const result = await this.listGlobalItemsPage({ ...token, accountLabel: viewer }, {
          ...query, kind: feed.kind, cursor: String(feed.position.page), pageSize: size,
        }, owners);
        feed.items = result.items;
        feed.nextPage = result.nextCursor ? Number(result.nextCursor) : undefined;
        feed.loaded = true;
        if (feed.position.offset >= feed.items.length) {
          feed.position = feed.nextPage ? { page: feed.nextPage, offset: 0 } : null;
          feed.loaded = false;
        }
      }
    };
    const items: WorkItem[] = [];
    // Merge two sorted streams. Keep only page positions in the cursor; partially
    // consumed pages are re-read rather than embedding work items or holding state.
    while (items.length < size) {
      await Promise.all(feeds.map(load));
      const available = feeds.filter(feed => feed.position !== null);
      available.sort((a, b) => b.items[b.position!.offset]!.updatedAt.localeCompare(a.items[a.position!.offset]!.updatedAt));
      const feed = available[0];
      if (!feed?.position) break;
      items.push(feed.items[feed.position.offset]!);
      feed.position.offset += 1;
      if (feed.position.offset === feed.items.length) {
        feed.position = feed.nextPage ? { page: feed.nextPage, offset: 0 } : null;
        feed.loaded = false;
      }
    }
    const next = { signature, issue: feeds[0]!.position, pullRequest: feeds[1]!.position };
    return { items, ...(next.issue || next.pullRequest ? { nextCursor: Buffer.from(JSON.stringify(next)).toString('base64url') } : {}) };
  }

  async listItems(token: WorkProviderCredential, repositoryId: string, query: WorkItemQuery = {}): Promise<WorkItem[]> {
    const repository = parseRepositoryId(repositoryId);
    if (!repository) {
      return [];
    }

    const state = query.state ?? 'open';
    const items: WorkItem[] = [];
    if (query.kind !== 'pullRequest') {
      const issues = await this.apiRequest(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues?state=${state}&per_page=100`);
      if (!Array.isArray(issues)) throw new Error('GitHub returned an invalid issues response.');
      items.push(...issues
        .map((issue) => githubIssue(issue, repositoryId, repository.fullName))
        .filter((item): item is WorkItem => item !== null && item.kind !== 'pullRequest'));
    }
    if (query.kind !== 'issue') {
      const pulls = await this.apiRequest(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?state=${state}&per_page=100`);
      if (!Array.isArray(pulls)) throw new Error('GitHub returned an invalid pull request response.');
      items.push(...pulls
        .map((pullRequest) => githubPullRequestItem(pullRequest, repositoryId, repository.fullName))
        .filter((item): item is WorkItem => Boolean(item)));
    }
    return items.map(item => ({ ...item, assignedToViewer: Boolean(token.accountLabel && item.assignees?.includes(token.accountLabel)) }));
  }

  async listAssignedItems(token: WorkProviderCredential): Promise<WorkItem[]> {
    const issues = await this.apiRequest(token, '/issues?filter=assigned&state=open&per_page=100');
    if (!Array.isArray(issues)) throw new Error('GitHub returned an invalid assigned issues response.');
    return issues
      .map(githubAssignedIssue)
      .filter((item): item is WorkItem => item !== null);
  }

  async findPullRequest(token: WorkProviderCredential, repositoryId: string, branch: string): Promise<AgentGitPullRequest | null> {
    const repository = parseRepositoryId(repositoryId);
    if (!repository) return null;
    const pulls = await this.apiRequest(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls?state=open&head=${encodeURIComponent(`${repository.owner}:${branch}`)}&per_page=1`);
    if (!Array.isArray(pulls)) throw new Error('GitHub returned an invalid pull request response.');
    return githubPullRequest(pulls[0]) ?? null;
  }

  async getPullRequest(token: WorkProviderCredential, repositoryId: string, number: number): Promise<AgentGitPullRequest | null> {
    const repository = parseRepositoryId(repositoryId);
    if (!repository || !Number.isInteger(number) || number <= 0) return null;
    const pullRequest = await this.apiRequest(
      token,
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls/${number}`,
    );
    return githubPullRequest(pullRequest);
  }

  async createPullRequest(token: WorkProviderCredential, repositoryId: string, input: { branch: string; title: string; body: string }): Promise<AgentGitPullRequest> {
    const repository = parseRepositoryId(repositoryId);
    if (!repository) throw new Error('The Git remote is not a GitHub repository.');
    const response = await this.apiRequest(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, head: input.branch, base: await this.defaultBranch(token, repositoryId), draft: true }),
    });
    const pullRequest = githubPullRequest(response);
    if (!pullRequest) throw new Error('GitHub returned an invalid pull request response.');
    return pullRequest;
  }

  private async apiRequest(token: WorkProviderCredential, path: string, init: RequestInit = {}): Promise<unknown> {
    return (await this.apiResponse(token, path, init)).json();
  }

  private async apiPageRequest(token: WorkProviderCredential, path: string): Promise<{ linkHeader: string | null; value: unknown }> {
    const response = await this.apiResponse(token, path);
    return { value: await response.json(), linkHeader: response.headers.get('link') };
  }

  protected async apiResponse(token: WorkProviderCredential, path: string, init: RequestInit = {}): Promise<Response> {
    return githubApiResponse(requireWorkProviderToken(token), path, init);
  }

  private async defaultBranch(token: WorkProviderCredential, repositoryId: string): Promise<string> {
    const repository = parseRepositoryId(repositoryId);
    if (!repository) throw new Error('The Git remote is not a GitHub repository.');
    const response = await this.apiRequest(token, `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`);
    if (!isRecord(response) || typeof response.default_branch !== 'string') throw new Error('GitHub returned an invalid repository response.');
    return response.default_branch;
  }

  private clientId(): string {
    const value = typeof this.clientIdProvider === 'function' ? this.clientIdProvider() : this.clientIdProvider;
    return typeof value === 'string' ? value.trim() : '';
  }
}

function expiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1_000).toISOString();
}

async function githubOAuthRequest(url: string, input: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(input),
  });

  return response.json();
}

function githubOAuthErrorMessage(response: Record<string, unknown>): string {
  if (typeof response.error_description === 'string') {
    return response.error_description;
  }

  if (response.error === 'device_flow_disabled') {
    return 'Device flow is disabled for this GitHub App. Enable device flow in the GitHub App settings and try again.';
  }

  return typeof response.error === 'string'
    ? `GitHub authorization failed: ${response.error}`
    : 'GitHub authorization failed.';
}


function githubRepositoryWorkItemActivity(items: unknown[]): Map<string, string> {
  const activityByRepository = new Map<string, string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.repository_url !== 'string' || typeof item.updated_at !== 'string') continue;
    const repositoryId = repositoryIdFromUrl(item.repository_url);
    if (!repositoryId || item.updated_at <= (activityByRepository.get(repositoryId) ?? '')) continue;
    activityByRepository.set(repositoryId, item.updated_at);
  }
  return activityByRepository;
}

function repositoryIdFromUrl(url: string): string | null {
  const marker = '/repos/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;
  const repositoryId = url.slice(markerIndex + marker.length).replace(/^\/+|\/+$/g, '');
  return parseRepositoryId(repositoryId)?.fullName ?? null;
}


async function githubApiResponse(token: WorkProviderToken, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${token.tokenType || 'Bearer'} ${token.accessToken}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw await githubApiError(response);
  }
  return response;
}

function linkedPageUrl(linkHeader: string | null, relation: 'last' | 'next'): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    if (!new RegExp(`;\\s*rel="${relation}"\\s*$`).test(part.trim())) continue;
    const match = part.match(/<([^>]+)>/);
    return match?.[1] ?? null;
  }
  return null;
}

async function githubApiError(response: Response): Promise<Error> {
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const resetSeconds = Number(response.headers.get('x-ratelimit-reset'));
    const resetAt = Number.isFinite(resetSeconds) && resetSeconds > 0
      ? new Date(resetSeconds * 1_000).toISOString()
      : null;
    return new Error(resetAt
      ? `GitHub API rate limit exceeded. Try again after ${resetAt}.`
      : 'GitHub API rate limit exceeded. Try again later.');
  }

  let detail: string | null = null;
  try {
    const body = await response.json() as unknown;
    detail = isRecord(body) && typeof body.message === 'string' ? body.message.trim() : null;
  } catch {
    // GitHub can return an empty or non-JSON response for infrastructure errors.
  }

  return new Error(detail
    ? `GitHub request failed with ${response.status}: ${detail}`
    : `GitHub request failed with ${response.status}.`);
}


function githubPullRequest(value: unknown): AgentGitPullRequest | null {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.number) ||
    typeof value.title !== 'string' ||
    typeof value.html_url !== 'string' ||
    !isRecord(value.head) ||
    typeof value.head.sha !== 'string'
  ) return null;
  const mergedAt = typeof value.merged_at === 'string' ? value.merged_at : undefined;
  return {
    number: value.number as number,
    title: value.title,
    url: value.html_url,
    draft: value.draft === true,
    headSha: value.head.sha,
    state: mergedAt ? 'merged' : value.state === 'closed' ? 'closed' : 'open',
    ...(mergedAt ? { mergedAt } : {}),
  };
}

function githubRepository(value: unknown): WorkSource | null {
  if (!isRecord(value) || typeof value.full_name !== 'string' || typeof value.html_url !== 'string') {
    return null;
  }

  const [owner, name] = value.full_name.split('/');
  if (!owner || !name) {
    return null;
  }

  return {
    provider: 'github',
    id: value.full_name,
    owner,
    name,
    fullName: value.full_name,
    url: value.html_url,
    isPrivate: value.private === true,
    ...(typeof value.updated_at === 'string' ? { updatedAt: value.updated_at } : {}),
  };
}

function githubIssue(value: unknown, repositoryId: string, sourceName: string): WorkItem | null {
  const issueNumber = isRecord(value) && Number.isInteger(value.number) ? value.number : null;
  if (!isRecord(value) ||
    typeof issueNumber !== 'number' ||
    typeof value.title !== 'string' ||
    typeof value.html_url !== 'string' ||
    typeof value.created_at !== 'string' ||
    typeof value.updated_at !== 'string'
  ) {
    return null;
  }

  return {
    provider: 'github',
    id: `${repositoryId}#${issueNumber}`,
    kind: isRecord(value.pull_request) ? 'pullRequest' : 'issue',
    sourceId: repositoryId,
    sourceName,
    number: issueNumber,
    title: value.title,
    url: value.html_url,
    state: value.state === 'closed' ? 'closed' : 'open',
    ...(isRecord(value.user) && typeof value.user.login === 'string' ? { authorName: value.user.login } : {}),
    ...(Array.isArray(value.assignees) ? { assignees: value.assignees.map(githubIssueAssignee).filter((login): login is string => Boolean(login)) } : {}),
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
    labels: Array.isArray(value.labels) ? value.labels.map(githubIssueLabel).filter((label): label is WorkItemLabel => Boolean(label)) : [],
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function githubPullRequestItem(value: unknown, repositoryId: string, sourceName: string): WorkItem | null {
  const item = githubIssue(isRecord(value) ? { ...value, pull_request: {} } : value, repositoryId, sourceName);
  if (!item || !isRecord(value) || !isRecord(value.head) || typeof value.head.ref !== 'string' || !value.head.ref.trim()) {
    return null;
  }
  return { ...item, kind: 'pullRequest', branchName: value.head.ref.trim() };
}

function githubAssignedIssue(value: unknown): WorkItem | null {
  if (!isRecord(value) || typeof value.repository_url !== 'string') return null;
  const repositoryId = repositoryIdFromUrl(value.repository_url);
  return repositoryId ? githubIssue(value, repositoryId, repositoryId) : null;
}

function githubIssueAssignee(value: unknown): string | null {
  return isRecord(value) && typeof value.login === 'string' && value.login.trim() ? value.login : null;
}

function githubIssueLabel(value: unknown): WorkItemLabel | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null;
  }

  return {
    name: value.name,
    ...(typeof value.color === 'string' ? { color: value.color } : {}),
  };
}

function parseRepositoryId(repositoryId: string): { fullName: string; name: string; owner: string } | null {
  const [owner, name] = repositoryId.split('/');
  return owner && name ? { owner, name, fullName: `${owner}/${name}` } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
