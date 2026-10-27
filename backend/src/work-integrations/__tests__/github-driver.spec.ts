import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';
import { GitHubWorkProviderDriver } from '../github-driver';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHubWorkProviderDriver', () => {
  it('lists every branch page and marks the default branch without exposing provider metadata', async () => {
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };
    const fetch = vi.fn(async (url: string) => url.endsWith('/org/repo') ? jsonResponse({ default_branch: 'main' })
      : url.includes('page=2') ? jsonResponse([{ name: 'main', protected: true }])
      : jsonResponse([{ name: 'feature/mobile', commit: { sha: 'private' } }], { link: '<https://api.github.com/repos/org/repo/branches?per_page=100&page=2>; rel="next"' }));
    vi.stubGlobal('fetch', fetch);
    expect(await new GitHubWorkProviderDriver('id').listBranches(token, 'org/repo')).toStrictEqual([
      { name: 'main', isDefault: true }, { name: 'feature/mobile', isDefault: false },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('starts device authorization with GitHub OAuth', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      device_code: 'device-code',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }));
    vi.stubGlobal('fetch', fetch);

    const driver = new GitHubWorkProviderDriver('client-id');

    await expect(driver.startAuthorization()).resolves.toMatchObject({
      provider: 'github',
      deviceCode: 'device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
    });
    expect(fetch).toHaveBeenCalledWith('https://github.com/login/device/code', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('surfaces GitHub device authorization errors', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      error: 'device_flow_disabled',
      error_description: 'Device Flow must be explicitly enabled for this App',
    }));
    vi.stubGlobal('fetch', fetch);

    const driver = new GitHubWorkProviderDriver(() => 'client-id');

    await expect(driver.startAuthorization()).rejects.toThrow('Device Flow must be explicitly enabled for this App');
  });

  it('captures and rotates expiring GitHub App user tokens from device flow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      const fetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse({
          access_token: 'ghu_access_1',
          expires_in: 28_800,
          refresh_token: 'ghr_refresh_1',
          refresh_token_expires_in: 15_897_600,
          token_type: 'bearer',
          scope: '',
        }))
        .mockResolvedValueOnce(jsonResponse({
          access_token: 'ghu_access_2',
          expires_in: 28_800,
          refresh_token: 'ghr_refresh_2',
          refresh_token_expires_in: 15_897_600,
          token_type: 'bearer',
          scope: '',
        }));
      vi.stubGlobal('fetch', fetch);
      const driver = new GitHubWorkProviderDriver('client-id');

      const authorization = await driver.pollAuthorization('device-code');
      expect(authorization).toStrictEqual({
        status: 'success',
        token: {
          accessToken: 'ghu_access_1',
          expiresAt: '2026-08-01T08:00:00.000Z',
          refreshToken: 'ghr_refresh_1',
          refreshTokenExpiresAt: '2027-02-01T00:00:00.000Z',
          scope: '',
          tokenType: 'bearer',
        },
      });
      if (authorization.status !== 'success') throw new Error('Expected successful device authorization.');
      const token: WorkProviderToken = {
        provider: 'github',
        ...authorization.token,
        connectedAt: '2026-08-01T00:00:00.000Z',
      };

      await expect(driver.refreshToken(token)).resolves.toMatchObject({
        accessToken: 'ghu_access_2',
        refreshToken: 'ghr_refresh_2',
      });
      const refreshBody = fetch.mock.calls[1]?.[1]?.body;
      expect(refreshBody).toBeInstanceOf(URLSearchParams);
      expect((refreshBody as URLSearchParams).get('grant_type')).toBe('refresh_token');
      expect((refreshBody as URLSearchParams).get('refresh_token')).toBe('ghr_refresh_1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads client ID from a dynamic provider', async () => {
    let clientId = '';
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      device_code: 'device-code',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver(() => clientId);

    expect(driver.configured()).toBe(false);

    clientId = 'client-id';
    await driver.startAuthorization();

    const body = fetch.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get('client_id')).toBe('client-id');
  });

  it('normalizes repositories and issue items from GitHub responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        full_name: 'nbonamy/agent-workspace',
        html_url: 'https://github.com/nbonamy/agent-workspace',
        private: true,
        updated_at: '2026-06-09T12:00:00.000Z',
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        repository_url: 'https://api.github.com/repos/nbonamy/agent-workspace',
        updated_at: '2026-06-09T12:45:00.000Z',
      }, {
        repository_url: 'https://api.github.com/repos/nbonamy/agent-workspace',
        pull_request: {},
        updated_at: '2026-06-09T13:00:00.000Z',
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        number: 12,
        title: 'Fix cockpit drag target',
        html_url: 'https://github.com/nbonamy/agent-workspace/issues/12',
        state: 'open',
        body: 'Make issue assignment feel obvious.',
        user: { login: 'nbonamy' },
        assignees: [{ login: 'nbonamy' }, { login: 'dina' }],
        labels: [{ name: 'bug', color: 'ff0000' }],
        created_at: '2026-06-09T12:00:00.000Z',
        updated_at: '2026-06-09T12:30:00.000Z',
      }, {
        number: 13,
        title: 'This is a pull request',
        html_url: 'https://github.com/nbonamy/agent-workspace/pull/13',
        pull_request: {},
        created_at: '2026-06-09T12:00:00.000Z',
        updated_at: '2026-06-09T12:30:00.000Z',
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        number: 13,
        title: 'This is a pull request',
        html_url: 'https://github.com/nbonamy/agent-workspace/pull/13',
        state: 'open',
        head: { ref: 'feature/backlog-workspace' },
        created_at: '2026-06-09T12:00:00.000Z',
        updated_at: '2026-06-09T12:30:00.000Z',
      }]));
    vi.stubGlobal('fetch', fetch);

    const driver = new GitHubWorkProviderDriver('client-id');
    const token = {
      provider: 'github' as const,
      accessToken: 'gho_secret',
      tokenType: 'bearer',
      connectedAt: '2026-06-09T12:00:00.000Z',
    };

    await expect(driver.listSources(token)).resolves.toStrictEqual([{
      provider: 'github',
      id: 'nbonamy/agent-workspace',
      owner: 'nbonamy',
      name: 'agent-workspace',
      fullName: 'nbonamy/agent-workspace',
      url: 'https://github.com/nbonamy/agent-workspace',
      isPrivate: true,
      updatedAt: '2026-06-09T12:00:00.000Z',
      workItemsUpdatedAt: '2026-06-09T13:00:00.000Z',
    }]);
    expect(fetch).toHaveBeenNthCalledWith(2,
      'https://api.github.com/issues?filter=all&state=open&sort=updated&direction=desc&per_page=100',
      expect.any(Object));
    await expect(driver.listItems(token, 'nbonamy/agent-workspace')).resolves.toStrictEqual([{
      provider: 'github',
      id: 'nbonamy/agent-workspace#12',
      kind: 'issue',
      sourceId: 'nbonamy/agent-workspace',
      sourceName: 'nbonamy/agent-workspace',
      assignedToViewer: false,
      number: 12,
      title: 'Fix cockpit drag target',
      url: 'https://github.com/nbonamy/agent-workspace/issues/12',
      state: 'open',
      authorName: 'nbonamy',
      assignees: ['nbonamy', 'dina'],
      body: 'Make issue assignment feel obvious.',
      labels: [{ name: 'bug', color: 'ff0000' }],
      createdAt: '2026-06-09T12:00:00.000Z',
      updatedAt: '2026-06-09T12:30:00.000Z',
    }, {
      provider: 'github',
      id: 'nbonamy/agent-workspace#13',
      kind: 'pullRequest',
      branchName: 'feature/backlog-workspace',
      sourceId: 'nbonamy/agent-workspace',
      sourceName: 'nbonamy/agent-workspace',
      assignedToViewer: false,
      number: 13,
      title: 'This is a pull request',
      url: 'https://github.com/nbonamy/agent-workspace/pull/13',
      state: 'open',
      labels: [],
      createdAt: '2026-06-09T12:00:00.000Z',
      updatedAt: '2026-06-09T12:30:00.000Z',
    }]);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://api.github.com/repos/nbonamy/agent-workspace/pulls?state=open&per_page=100',
      expect.any(Object),
    );
  });

  it('filters issue and pull request results by item kind and state', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse([{
      number: 13,
      title: 'Review backlog workspace',
      html_url: 'https://github.com/nbonamy/agent-workspace/pull/13',
      state: 'closed',
      head: { ref: 'feature/review-backlog' },
      created_at: '2026-06-09T12:00:00.000Z',
      updated_at: '2026-06-09T12:30:00.000Z',
    }]));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.listItems(token, 'nbonamy/agent-workspace', { kind: 'pullRequest', state: 'closed' }))
      .resolves.toEqual([expect.objectContaining({ kind: 'pullRequest', state: 'closed' })]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/nbonamy/agent-workspace/pulls?state=closed&per_page=100',
      expect.any(Object),
    );
  });

  it('keeps repositories available when recent work-item enrichment fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        full_name: 'nbonamy/agent-workspace',
        html_url: 'https://github.com/nbonamy/agent-workspace',
        private: true,
        updated_at: '2026-06-09T12:00:00.000Z',
      }]))
      .mockResolvedValueOnce(errorResponse(500, { message: 'Temporary failure' }));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.listSources(token)).resolves.toStrictEqual([{
      provider: 'github',
      id: 'nbonamy/agent-workspace',
      owner: 'nbonamy',
      name: 'agent-workspace',
      fullName: 'nbonamy/agent-workspace',
      url: 'https://github.com/nbonamy/agent-workspace',
      isPrivate: true,
      updatedAt: '2026-06-09T12:00:00.000Z',
    }]);
  });

  it('lists work assigned to the authenticated user across repositories in one request', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse([{
      number: 24,
      title: 'Guide global backlog loading',
      html_url: 'https://github.com/nbonamy/agent-workspace/issues/24',
      repository_url: 'https://api.github.com/repos/nbonamy/agent-workspace',
      state: 'open',
      assignees: [{ login: 'nbonamy' }],
      labels: [],
      created_at: '2026-08-13T12:00:00.000Z',
      updated_at: '2026-08-13T13:00:00.000Z',
    }]));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.listAssignedItems(token)).resolves.toEqual([
      expect.objectContaining({ sourceId: 'nbonamy/agent-workspace', number: 24, assignees: ['nbonamy'] }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/issues?filter=assigned&state=open&per_page=100',
      expect.any(Object),
    );
  });

  it('queries personal issue, authored PR and review feeds before pagination', async () => {
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.pathname).toBe('/search/issues');
      expect(url.searchParams.get('page')).toBe('2');
      return jsonResponse({ total_count: 51, items: [{ number: 24, title: 'Review this change', user: { login: 'someone-else' },
        html_url: 'https://github.com/org/repo/pull/24', repository_url: 'https://api.github.com/repos/org/repo',
        ...(url.searchParams.get('q')?.includes('is:pr') ? { pull_request: {} } : {}), state: 'open', labels: [], created_at: '2026-01-01', updated_at: '2026-01-02' }] },
        { link: '<https://api.github.com/search/issues?page=3>; rel="next"' });
    });
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', accountLabel: 'alice', connectedAt: 'now' };
    for (const [query, search] of [
      [{ assignment: 'viewer', kind: 'issue' }, 'is:issue is:open assignee:alice'],
      [{ involvement: 'author', kind: 'pullRequest' }, 'is:pr is:open author:alice'],
      [{ involvement: 'reviewer', kind: 'pullRequest' }, 'is:pr is:open review-requested:alice'],
      [{ repositoryScope: 'owned', kind: 'all' }, 'is:open user:alice'],
    ] as const) {
      expect(await driver.listGlobalItems(token, { ...query, cursor: '2', pageSize: 25 })).toMatchObject({
        items: [{ kind: query.kind === 'all' ? 'issue' : query.kind, sourceId: 'org/repo', number: 24, authorName: 'someone-else' }], nextCursor: '3', totalItems: 51,
      });
      expect(new URL(fetch.mock.calls.at(-1)![0]).searchParams.get('q')).toBe(search);
    }
  });

  it('returns a continuation without fetching the final page to manufacture a total', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
      number: 24,
      title: 'Page the cockpit backlog',
      html_url: 'https://github.com/nbonamy/agent-workspace/issues/24',
      repository_url: 'https://api.github.com/repos/nbonamy/agent-workspace',
      state: 'open',
      labels: [],
      created_at: '2026-08-13T12:00:00.000Z',
      updated_at: '2026-08-13T13:00:00.000Z',
      }], {
      link: '<https://api.github.com/issues?filter=all&state=open&sort=updated&direction=desc&per_page=50&page=3>; rel="next", <https://api.github.com/issues?filter=all&state=open&sort=updated&direction=desc&per_page=50&page=8>; rel="last"',
      }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.listGlobalItems(token, {
      assignment: 'all',
      state: 'open',
      cursor: '2',
      pageSize: 50,
    })).resolves.toStrictEqual({
      items: [expect.objectContaining({ sourceId: 'nbonamy/agent-workspace', number: 24 })],
      nextCursor: '3',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenNthCalledWith(1,
      'https://api.github.com/issues?filter=all&state=open&sort=updated&direction=desc&per_page=50&page=2',
      expect.any(Object),
    );
    await expect(driver.listGlobalItems(token, { assignment: 'all', state: 'open', cursor: '3', pageSize: 50 }))
      .resolves.toEqual({ items: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed global backlog pages before calling GitHub', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.listGlobalItems(token, { cursor: 'invalid' })).rejects.toThrow('Invalid work item page');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('looks up and creates draft pull requests', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ number: 7, title: 'Existing', html_url: 'https://github.com/o/r/pull/7', draft: true, head: { sha: 'existing-sha' }, state: 'open' }]))
      .mockResolvedValueOnce(jsonResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(jsonResponse({ number: 8, title: 'New PR', html_url: 'https://github.com/o/r/pull/8', draft: true, head: { sha: 'new-sha' }, state: 'open' }));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.findPullRequest(token, 'o/r', 'feature')).resolves.toMatchObject({ number: 7, headSha: 'existing-sha', state: 'open' });
    await expect(driver.createPullRequest(token, 'o/r', { branch: 'feature', title: 'New PR', body: 'Body' })).resolves.toMatchObject({ number: 8, draft: true, headSha: 'new-sha', state: 'open' });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toStrictEqual({ title: 'New PR', body: 'Body', head: 'feature', base: 'main', draft: true });
  });

  it('loads a pull request by number and distinguishes merged from closed', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        number: 8,
        title: 'Merged PR',
        html_url: 'https://github.com/o/r/pull/8',
        draft: false,
        head: { sha: 'merged-sha' },
        state: 'closed',
        merged_at: '2026-09-03T12:00:00.000Z',
      }))
      .mockResolvedValueOnce(jsonResponse({
        number: 9,
        title: 'Closed PR',
        html_url: 'https://github.com/o/r/pull/9',
        draft: false,
        head: { sha: 'closed-sha' },
        state: 'closed',
        merged_at: null,
      }));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.getPullRequest(token, 'o/r', 8)).resolves.toStrictEqual({
      number: 8,
      title: 'Merged PR',
      url: 'https://github.com/o/r/pull/8',
      draft: false,
      headSha: 'merged-sha',
      state: 'merged',
      mergedAt: '2026-09-03T12:00:00.000Z',
    });
    await expect(driver.getPullRequest(token, 'o/r', 9)).resolves.toMatchObject({ state: 'closed' });
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://api.github.com/repos/o/r/pulls/8', expect.any(Object));
  });

  it('reports GitHub API rate-limit resets instead of a generic 403', async () => {
    const fetch = vi.fn().mockResolvedValue(errorResponse(403, {
      message: 'API rate limit exceeded for this user.',
    }, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1786490212',
    }));
    vi.stubGlobal('fetch', fetch);
    const driver = new GitHubWorkProviderDriver('client-id');
    const token = { provider: 'github' as const, accessToken: 'secret', tokenType: 'bearer', connectedAt: 'now' };

    await expect(driver.findPullRequest(token, 'o/r', 'feature')).rejects.toThrow(
      'GitHub API rate limit exceeded. Try again after 2026-08-11T23:16:52.000Z.',
    );
  });
});

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response;
}

function errorResponse(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response;
}
