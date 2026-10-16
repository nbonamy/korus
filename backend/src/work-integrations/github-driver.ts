import type { SourceBranch, AgentGitPullRequest, GlobalWorkItemQuery, WorkItem, WorkItemLabel, WorkItemPage, WorkItemQuery, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { runtimeGitHubOAuthClientId } from '../runtime-config';
import { requireWorkProviderToken, type WorkProviderCredential, type WorkProviderDeviceAuthorization, type WorkProviderDeviceTokenResult, type WorkProviderDriver } from './types';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_OAUTH_BASE_URL = 'https://github.com/login';
const GITHUB_API_VERSION = '2022-11-28';
const DEFAULT_SCOPE = 'repo read:user';

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
    const page = query.cursor === undefined ? 1 : Number(query.cursor);
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid work item page.');
    const pageSize = Math.max(1, Math.min(100, Math.trunc(query.pageSize ?? 50)));
    const assignment = query.assignment === 'viewer' ? 'assigned' : 'all';
    const state = query.state ?? 'open';
    const path = `/issues?filter=${assignment}&state=${state}&sort=updated&direction=desc&per_page=${pageSize}&page=${page}`;
    const response = await this.apiPageRequest(
      token,
      path,
    );
    if (!Array.isArray(response.value)) {
      throw new Error('GitHub returned an invalid global issues response.');
    }
    const items = response.value
      .map(githubAssignedIssue)
      .filter((item): item is WorkItem => item !== null)
      .filter((item) => query.kind === undefined || query.kind === 'all' || item.kind === query.kind);
    return {
      items: items.map(item => ({ ...item, assignedToViewer: Boolean(token.accountLabel && item.assignees?.includes(token.accountLabel)) })),
      ...(linkedPageUrl(response.linkHeader, 'next') ? { nextCursor: String(page + 1) } : {}),
    };
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
