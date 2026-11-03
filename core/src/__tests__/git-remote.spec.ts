import { fileRepositoryKey, gitRepositoryKey } from '../repository-key';
import { describe, expect, it } from 'vitest';
import { cloneUrlForRemote, matchingBranchUpstream, canonicalGitRemoteIdentity, repositoryIconKeyForRemote, sanitizeGitRemoteUrl } from '../git-remote';

describe('git remote identity', () => {
  it('builds unambiguous Git and file metadata keys including Windows and escaped paths', () => {
    expect(gitRepositoryKey('git@github.com:team/app.git')).toBe('git:github.com/team/app');
    expect(gitRepositoryKey('https://gitlab.com/team/app.git')).toBe('git:gitlab.com/team/app');
    expect(fileRepositoryKey('/src/a #%.txt')).toBe('file:///src/a%20%23%25.txt');
    expect(fileRepositoryKey('C:\\src\\app')).toBe('file:///C:/src/app');
    expect(canonicalGitRemoteIdentity('C:\\src\\app')).toBeUndefined();
    expect(fileRepositoryKey('C:\\')).toBe('file:///C:/');
    expect(fileRepositoryKey('\\\\server\\share\\app')).toBe('file://server/share/app');
  });
  it('accepts canonical git metadata keys without mistaking git for the remote host', () => {
    expect(canonicalGitRemoteIdentity('git:github.com/fixture/project')).toBe('github.com/fixture/project');
  });
  it('removes credentials and non-identity URL parts before persistence', () => {
    expect(sanitizeGitRemoteUrl('https://oauth2:secret@GitHub.com/openai/codex.git?token=secret#main')).toBe(
      'https://github.com/openai/codex.git',
    );
    expect(sanitizeGitRemoteUrl('git@github.com:openai/codex.git')).toBe('github.com:openai/codex.git');
  });

  it('canonicalizes equivalent HTTPS and SSH remotes to one identity', () => {
    expect(canonicalGitRemoteIdentity('https://token@github.com/openai/codex.git')).toBe('github.com/openai/codex');
    expect(canonicalGitRemoteIdentity('git@github.com:openai/codex.git')).toBe('github.com/openai/codex');
    expect(repositoryIconKeyForRemote('ssh://git@github.com/openai/codex.git')).toBe('remote:github.com/openai/codex');
  });

  it('rejects local paths and malformed remotes', () => {
    expect(sanitizeGitRemoteUrl('/src/codex')).toBeUndefined();
    expect(repositoryIconKeyForRemote('/src/codex')).toBeUndefined();
  });
});


describe('clone URL for a persisted remote', () => {
  it('restores the conventional git user that persistence strips from SSH addresses', () => {
    expect(cloneUrlForRemote(sanitizeGitRemoteUrl('git@github.com:openai/codex.git')!)).toBe('git@github.com:openai/codex.git');
    expect(cloneUrlForRemote(sanitizeGitRemoteUrl('ssh://git@gitea.example.com:2222/team/app.git')!)).toBe('ssh://git@gitea.example.com:2222/team/app.git');
  });

  it('leaves HTTPS remotes and addresses that already name a user alone', () => {
    expect(cloneUrlForRemote('https://github.com/openai/codex.git')).toBe('https://github.com/openai/codex.git');
    expect(cloneUrlForRemote('deploy@host.example.com:team/app.git')).toBe('deploy@host.example.com:team/app.git');
  });

  it('has nothing to clone for local paths', () => {
    expect(cloneUrlForRemote('/src/codex')).toBeUndefined();
  });
});

describe('worktree remote deletion choices', () => {
  it.each([
    ['feature/new', 'origin/feature/new', 'main', 'origin/feature/new'],
    ['feature/new', 'fork/feature/new', 'main', 'fork/feature/new'],
    ['feature/new', 'origin/main', 'main', undefined],
    ['feature/new', undefined, 'main', undefined],
    ['main', 'origin/main', 'main', undefined],
    ['feature', 'origin/other/feature', 'main', undefined],
    [undefined, 'origin/main', 'main', undefined],
  ])('offers only a matching tracked branch (%s, %s)', (branch, upstream, baseBranch, expected) => {
    expect(matchingBranchUpstream(branch, upstream, baseBranch)).toBe(expected);
  });
});
