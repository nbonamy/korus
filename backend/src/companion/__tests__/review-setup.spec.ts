import { describe, expect, it, vi } from 'vitest';
import { readReviewSetup } from '../review-setup';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { CompanionBackendPort } from '../manager';

function fixture() {
  const snapshot = createTestSnapshot();
  snapshot.agents = [{ id: 'a', teamId: 'team-test', name: 'Agent', backend: 'codex', folder: '/private/workspace', status: { type: 'idle' }, createdAt: '', updatedAt: '' }];
  snapshot.general.codeReviewDefaults = { backend: 'claude', automation: { enabled: true, maxPriority: 'p1', maxRounds: 2, autoCommit: true }, providers: { claude: { model: 'reviewer', reasoningEffort: 'high' } } };
  const request = vi.fn(async (method: string) => {
    if (method === backendMethods.snapshotGet) return { snapshot };
    if (method === backendMethods.agentModelsList) return [{ id: 'id', model: 'reviewer', displayName: 'Reviewer', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }, { id: 'hidden', model: 'hidden', hidden: true }];
    throw new Error('Unexpected method');
  });
  return { snapshot, request, port: { request } as CompanionBackendPort };
}

describe('companion review initialization', () => {
  it('uses desktop scope availability and reviewer preferences without exposing filesystem paths', async () => {
    const f = fixture();
    const empty = { changedFiles: 0, addedLines: 0, removedLines: 0 };
    f.snapshot.agentGitStatuses.a = { folder: '/private/workspace', branch: 'feature', state: 'clean', ahead: 1, behind: 0, changedFiles: 0, addedLines: 0, removedLines: 0, hasUntracked: false, updatedAt: '',
      diffCatalog: { defaultTarget: { type: 'branch' }, uncommitted: empty, unstaged: empty, staged: empty,
        branch: { baseRef: 'main', changedFiles: 1, addedLines: 2, removedLines: 0 }, commits: [{ ...empty, sha: 'abc', shortSha: 'abc', subject: 'Change' }] } };
    expect(await readReviewSetup(f.port, 'host', 'a')).toStrictEqual({
      target: { hostId: 'host', locationId: 'local', teamId: 'team-test', agentId: 'a', sessionId: null },
      branch: 'feature', baseRef: 'main', uncommitted: false, branchChanges: true, currentThread: false, activeReview: false, reviewerAgentId: null,
      agentBackend: 'codex', backend: 'claude', backends: ['codex', 'claude'], models: [{ id: 'reviewer', name: 'Reviewer', efforts: ['high'] }], preferences: f.snapshot.general.codeReviewDefaults,
    });
    expect(f.request).toHaveBeenLastCalledWith(backendMethods.agentModelsList, { agentId: 'a', backend: 'claude', _clientId: 'companion-read' });
    f.snapshot.agentGitStatuses.a.diffCatalog!.commits = [];
    expect((await readReviewSetup(f.port, 'host', 'a', 'codex')).branchChanges).toBe(false);
    expect(f.request).toHaveBeenLastCalledWith(backendMethods.agentModelsList, { agentId: 'a', backend: 'codex', _clientId: 'companion-read' });
  });
  it('rejects unavailable engines and missing workspaces; unknown git status does not masquerade as clean', async () => {
    const f = fixture();
    expect((await readReviewSetup(f.port, 'host', 'a')).uncommitted).toBe(true);
    await expect(readReviewSetup(f.port, 'host', 'a', 'antigravity')).rejects.toThrow('unavailable');
    f.snapshot.general.codeReviewDefaults = undefined;
    f.snapshot.providerConnections![0]!.connected = false;
    expect((await readReviewSetup(f.port, 'host', 'a')).backend).toBe('claude');
    f.snapshot.agents[0]!.folder = null;
    await expect(readReviewSetup(f.port, 'host', 'a')).rejects.toThrow('workspace');
  });
  it('finds an independent review on its reviewer agent so reopening setup cannot start a duplicate', async () => {
    const f = fixture();
    f.snapshot.agents.push({ ...f.snapshot.agents[0]!, id: 'reviewer', codeReview: { id: 'review', targetAgentId: 'a', reviewerAgentId: 'reviewer',
      scope: { type: 'uncommitted' }, threadMode: 'independent', status: 'reviewing', activeRoundId: 'round', rounds: [], createdAt: '', updatedAt: '' } });
    const setup = await readReviewSetup(f.port, 'host', 'a');
    expect({ active: setup.activeReview, reviewer: setup.reviewerAgentId }).toStrictEqual({ active: true, reviewer: 'reviewer' });
    f.snapshot.agents.at(-1)!.codeReview!.status = 'failed';
    const failed = await readReviewSetup(f.port, 'host', 'a');
    expect({ active: failed.activeReview, reviewer: failed.reviewerAgentId }).toStrictEqual({ active: false, reviewer: null });
  });
});
