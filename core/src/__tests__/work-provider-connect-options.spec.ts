import { describe, expect, it } from 'vitest';
import { workProviderConnectOptions, workProviderForRepositoryId } from '../work-providers';

describe('workProviderConnectOptions', () => {
  it('always asks GitLab for the MCP grant alongside the API grant', () => {
    expect(workProviderConnectOptions('gitlab')).toStrictEqual({ hostedMcp: true });
    expect(workProviderConnectOptions('gitlab', {})).toStrictEqual({ hostedMcp: true });
    expect(workProviderConnectOptions('gitlab', { hostedMcp: false })).toStrictEqual({ hostedMcp: true });
  });

  it('adds nothing for providers without an extra grant', () => {
    expect(workProviderConnectOptions('github')).toStrictEqual({});
    expect(workProviderConnectOptions('linear')).toStrictEqual({});
  });
});

describe('workProviderForRepositoryId', () => {
  it('maps a repository identity to the provider that hosts it', () => {
    expect(workProviderForRepositoryId('github.com/owner/repo')).toBe('github');
    expect(workProviderForRepositoryId('gitlab.com/group/sub/project')).toBe('gitlab');
    expect(workProviderForRepositoryId('example.com/team/repo')).toBeUndefined();
    expect(workProviderForRepositoryId(null)).toBeUndefined();
  });
});
