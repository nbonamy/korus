import { describe, expect, it, vi } from 'vitest';
import { readReviewSetup, readReviewSession, actOnReview } from '../review-setup';
import { createTestSnapshot } from '../../__tests__/server-test-fixtures';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { CompanionBackendPort } from '../manager';

function fixture() {
  const snapshot = createTestSnapshot();
  snapshot.agents = [{ id: 'a', teamId: 'team-test', name: 'Agent', backend: 'codex', folder: '/private/workspace', status: { type: 'idle' }, createdAt: '', updatedAt: '' }];
  snapshot.general.codeReviewDefaults = { backend: 'claude', automation: { enabled: true, maxPriority: 'p1', maxRounds: 2, autoCommit: true }, providers: { claude: {backend: 'claude', serviceTier: null,  model: 'reviewer', reasoningEffort: 'high' } } };
  const request = vi.fn(async (method: string) => {
    if (method === backendMethods.snapshotGet) return { snapshot };
    if (method === backendMethods.agentModelsList) return [{ id: 'id', model: 'reviewer', displayName: 'Reviewer', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], serviceTiers: [{ id: 'fast', name: 'Fast', description: 'Faster responses' }] }, { id: 'hidden', model: 'hidden', hidden: true }];
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
      agentBackend: 'codex', backend: 'claude', backends: ['codex', 'claude'], models: [{ id: 'reviewer', name: 'Reviewer', efforts: ['high'], tiers: [{ id: 'fast', name: 'Fast' }] }], preferences: f.snapshot.general.codeReviewDefaults,
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

// Regression: a phone must operate only the displayed review/round, through the
// desktop lifecycle, while exposing findings without provider session internals.
it('reads and arbitrates the bound review, rejects stale rounds and follows remediation through another round', async () => {
  const f = fixture();
  const session: import('@workspace/core/code-review').CodeReviewSession = { id: 'review', targetAgentId: 'a', reviewerAgentId: 'reviewer',
    scope: { type: 'uncommitted' }, threadMode: 'independent', status: 'reviewing', activeRoundId: 'round', createdAt: '', updatedAt: 'v1',
    rounds: [{ id: 'round', number: 1, status: 'reviewing', startedAt: '', reviewerSession: { kind: 'codex', threadId: 'secret' },
      findings: [{ id: 'finding', roundId: 'round', priority: 'p1', title: 'Keep the draft', body: 'Do not lose input on reconnect.',
        location: { file: '/private/workspace/src/composer.ts', line: 42 }, decision: { state: 'undecided' }, discussion: [], remediation: { state: 'notStarted' }, createdAt: '', updatedAt: '' }] }] };
  f.snapshot.agents.push({ ...f.snapshot.agents[0]!, id: 'reviewer', codeReview: session });
  f.snapshot.agents.unshift({ ...f.snapshot.agents[0]!, id: 'old-reviewer', codeReview: { ...structuredClone(session), id: 'failed-review', reviewerAgentId: 'old-reviewer', status: 'failed' } });
  const view = await readReviewSession(f.port, 'host', 'a');
  expect(view.session?.id).toBe('review');
  expect((await readReviewSession(f.port, 'host', 'old-reviewer')).session?.id).toBe('failed-review');
  f.snapshot.agents.shift();
  expect(view.session?.rounds[0]?.findings[0]?.location?.file).toBe('src/composer.ts');
  expect(JSON.stringify(view)).not.toMatch(/secret|private|reviewerSession/);
  const input = { sessionId: 'review', roundId: 'round', updatedAt: 'v1', action: 'submit' as const };
  await expect(actOnReview(f.port, 'a', input)).rejects.toThrow('ready');
  session.status = 'ready'; session.rounds[0]!.status = 'ready';
  await expect(actOnReview(f.port, 'a', { ...input, roundId: 'old' })).rejects.toThrow('changed');
  await expect(actOnReview(f.port, 'a', { ...input, updatedAt: 'old' })).rejects.toThrow('changed');
  await expect(actOnReview(f.port, 'a', { ...input, action: 'decide', findingId: 'other', selected: false })).rejects.toThrow('finding');
  f.request.mockImplementation(async (method: string, params?: any) => {
    if (method === backendMethods.snapshotGet) return { snapshot: f.snapshot };
    if (method === backendMethods.agentCodeReviewFindingDecide) {
      expect(params).toStrictEqual({ agentId: 'reviewer', input: { sessionId: 'review', roundId: 'round', findingId: 'finding', decision: 'reject' }, _clientId: 'companion-write' });
      session.rounds[0]!.findings[0]!.decision = { state: 'rejected', decidedAt: '' };
    } else if (method === backendMethods.agentCodeReviewRoundSubmit) {
      session.status = 'readyToFinish'; session.rounds[0]!.status = 'completed';
      session.rounds[0]!.findings[0]!.remediation = { state: 'skipped', startedAt: '' };
    } else if (method === backendMethods.agentCodeReviewAgain) {
      session.status = 'reviewing'; session.activeRoundId = 'round2';
      session.rounds.push({ id: 'round2', number: 2, status: 'reviewing', startedAt: '', findings: [] });
    } else if (method === backendMethods.agentCodeReviewFinish) { delete f.snapshot.agents[1]!.codeReview; }
    else throw new Error('Unexpected method');
    return { snapshot: f.snapshot };
  });
  await actOnReview(f.port, 'a', { ...input, action: 'decide', findingId: 'finding', selected: false });
  await actOnReview(f.port, 'a', input);
  expect((await readReviewSession(f.port, 'host', 'a')).session?.status).toBe('readyToFinish');
  await actOnReview(f.port, 'a', { ...input, action: 'again' });
  expect((await readReviewSession(f.port, 'host', 'reviewer')).session?.rounds).toHaveLength(2);
  await expect(actOnReview(f.port, 'a', input)).rejects.toThrow('changed');
  session.status = 'readyToFinish'; session.rounds[1]!.status = 'completed';
  await actOnReview(f.port, 'a', { ...input, roundId: 'round2', action: 'finish' });
  expect((await readReviewSession(f.port, 'host', 'a')).session).toBeNull();
});
