import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppStateStore } from '../../persistence/store';
import { describe, expect, it, vi } from 'vitest';
import { product } from '@workspace/core/product';
import type { Agent, AppSnapshot, BackendSession } from '@workspace/core/contracts';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { activeCodeReviewRound, codeReviewLedger } from '@workspace/core/code-review';
import { CodeReviewService, type CodeReviewToolPort } from '../code-review-service';
import type { ReviewToolHandlers } from '../review-tool-registry';
import { AgentCreationService } from '../../agents/agent-creation-service';

function agent(id: string): Agent {
  return {
    id, name: id, folder: '/repo', backend: 'codex', status: { type: 'idle' },
    createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
  };
}

type ReviewScript = (handlers: ReviewToolHandlers) => Promise<{ text: string; findingCount?: number }>;

function harness(scripts: ReviewScript[], deleteReviewer = async (_agent: Agent): Promise<void> => undefined, snapshot: AppSnapshot = createEmptySnapshot(), now?: () => Date) {
  snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
  const owner = snapshot.agents.find(candidate => candidate.id === 'owner') ?? agent('owner');
  if (!snapshot.agents.includes(owner)) snapshot.agents.push(owner);
  let context = 0;
  let activeHandlers: ReviewToolHandlers | null = null;
  const turns: Array<{ prompt: string; reviewerSession?: BackendSession }> = [];
  const reset: string[] = [];
  const deleted: string[] = [];
  const handoffs: Array<{ from: string; to: string; content: string }> = [];
  const changed = vi.fn();
  const saveReport = vi.fn(async (_agent: Agent, session: import('@workspace/core/code-review').CodeReviewSession) => `/reports/${session.id}.md`);
  const git = {
    prepare: vi.fn().mockResolvedValue({ baseRef: 'a'.repeat(40), head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' }),
    inspect: vi.fn().mockResolvedValue({ head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' }),
    hasChanges: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue({ head: 'c'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'committed', commit: 'c'.repeat(40) }),
  };
  const agentCreation = new AgentCreationService(snapshot);
  const resetReviewer = vi.fn(async (reviewer: Agent) => {
    reset.push(reviewer.id);
    delete reviewer.backendSession;
  });
  const tools: CodeReviewToolPort = {
    createReviewToolContext: (agentId, _sessionId, handlers) => {
      activeHandlers = handlers;
      return { id: `context-${++context}`, url: `http://review.test/mcp?agentId=${agentId}&reviewContextId=${context}` };
    },
    closeReviewToolContext: vi.fn(() => { activeHandlers = null; }),
  };
  let tick = 0;
  const service = new CodeReviewService({
    snapshot,
    git,
    createAgent: (input, options) => agentCreation.create(input, options),
    tools,
    now: now ?? (() => new Date(`2026-09-19T10:${String(tick++).padStart(2, '0')}:00.000Z`)),
    runReview: async (_agent, prompt, _url, reviewerSession) => {
      turns.push({ prompt, ...(reviewerSession ? { reviewerSession } : {}) });
      const script = scripts.shift();
      const result = script && activeHandlers ? await script(activeHandlers) : { text: '' };
      if (result.findingCount !== undefined) await activeHandlers!.finishReviewRound({ findingCount: result.findingCount });
      return { ...result, reviewerSession: reviewerSession ?? { kind: 'codex', threadId: `review-thread-${turns.length}` } };
    },
    resetReviewer,
    saveReport,
    deleteReviewer: async (reviewer, handoff) => {
      deleted.push(reviewer.id);
      await deleteReviewer(reviewer);
      if (handoff) handoffs.push({ from: reviewer.id, to: handoff.targetAgentId, content: handoff.content });
      snapshot.agents = snapshot.agents.filter((candidate) => candidate.id !== reviewer.id);
    },
    changed,
    reportProgress: (reviewer, to, content) => { handoffs.push({ from: reviewer.id, to, content }); },
  });
  return { owner, snapshot, service, turns, reset, deleted, handoffs, changed, git, tools, resetReviewer, saveReport };
}

function reviewer(test: ReturnType<typeof harness>, session: { reviewerAgentId: string }): Agent {
  const found = test.snapshot.agents.find((candidate) => candidate.id === session.reviewerAgentId);
  if (!found) throw new Error('Reviewer agent missing from test snapshot.');
  return found;
}

describe('CodeReviewService', () => {
  it('preserves the reviewer when switching while automatic finish saves its report in the same millisecond', async () => {
    let release!: (path: string) => void;
    const test = harness([async () => ({ text: 'Clean.', findingCount: 0 })], undefined, undefined, () => new Date('2026-09-19T10:00:00.000Z'));
    test.saveReport.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const session = test.service.startAutomatic(test.owner, { scope: { type: 'uncommitted' } });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const visible = reviewer(test, session);
    await test.service.switchToManual(visible, session.id);
    release('/reports/review.md');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(test.deleted).toEqual([]);
    expect(session.status).toBe('readyToFinish');
    expect(session.automation).toMatchObject({ enabled: false, state: 'manual' });
    expect(session.automation?.reason).toBeUndefined();
    expect(visible.codeReview).toBe(session);
  });

  it('keeps a clean review available when switching during automatic completion scheduling', async () => {
    const test = harness([async () => ({ text: 'Clean.', findingCount: 0 })]);
    let release!: () => void;
    test.changed.mockImplementation(async () => {
      if (test.snapshot.agents.some(a => a.codeReview?.automation?.state === 'completed')) {
        await new Promise<void>(resolve => { release = resolve; });
      }
    });
    const session = test.service.startAutomatic(test.owner, { scope: { type: 'uncommitted' } });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await test.service.switchToManual(reviewer(test, session), session.id);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(session.status).toBe('readyToFinish');
    expect(session.automation?.state).toBe('manual');
    expect(test.saveReport).not.toHaveBeenCalled();
    expect(test.deleted).toEqual([]);
  });

  it('persists manual mode and its ledger through a store reload, retry, and review again', async () => {
    let release!: () => void;
    const test = harness([async tools => {
      await tools.reportFinding({ priority: 'p1', title: 'Fix access', body: 'Access is unchecked.' });
      await new Promise<void>(resolve => { release = resolve; });
      return { text: 'Ready.', findingCount: 1 };
    }]);
    const session = test.service.startAutomatic(test.owner, { scope: { type: 'uncommitted' }, instructions: 'Check access.', autoCommit: true });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await test.service.switchToManual(reviewer(test, session), session.id);
    release();
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const home = await mkdtemp(path.join(os.tmpdir(), 'manual-review-store-'));
    try {
      await new AppStateStore(home).save(test.snapshot);
      const restored = harness([
        async () => { throw new Error('Provider unavailable.'); },
        async () => ({ text: 'Manual retry.', findingCount: 0 }),
        async () => ({ text: 'Manual review again.', findingCount: 0 }),
      ], undefined, await new AppStateStore(home).load());
      const visible = reviewer(restored, session);
      expect(visible.codeReview).toStrictEqual(session);
      restored.service.submit(visible, session.id);
      await vi.waitFor(() => expect(visible.codeReview?.status).toBe('failed'));
      const retry = restored.service.start(visible, {
        scope: session.scope, threadMode: 'independent', instructions: session.instructions,
        automation: { enabled: true, maxPriority: 'p2', maxRounds: 3, autoCommit: true },
      });
      await vi.waitFor(() => expect(retry.status).toBe('ready'));
      expect(retry.automation).toStrictEqual(session.automation);
      expect(retry.instructions).toBe('Check access.');
      restored.service.submit(visible, retry.id);
      await restored.service.reviewAgain(visible, retry.id);
      await vi.waitFor(() => expect(retry.status).toBe('ready'));
      expect(retry.automation?.state).toBe('manual');
      expect(restored.git.commit).not.toHaveBeenCalled();
      expect(restored.deleted).toEqual([]);
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  it.each([0, 1])('switches an active inspection with %s findings to manual and waits for its turn', async count => {
    let release!: () => void;
    const test = harness([async tools => {
      if (count) await tools.reportFinding({ priority: 'p1', title: 'Fix access', body: 'Access is unchecked.' });
      await new Promise<void>(resolve => { release = resolve; });
      return { text: 'Inspection complete.', findingCount: count };
    }]);
    const session = test.service.startAutomatic(test.owner, { scope: { type: 'uncommitted' }, autoCommit: true });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const visible = reviewer(test, session);
    const before = structuredClone(session.rounds);
    await test.service.switchToManual(visible, session.id);
    await test.service.switchToManual(visible, session.id);
    expect(session.status).toBe('reviewing');
    expect(session.rounds).toStrictEqual(before);
    expect(session.automation).toMatchObject({ enabled: false, state: 'manual' });
    release();
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(session.rounds[0]?.summary).toBe('Inspection complete.');
    expect(test.turns).toHaveLength(1);
    expect(test.deleted).toEqual([]);
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.tools.closeReviewToolContext).not.toHaveBeenCalled();
    expect(visible.codeReview).toBe(session);
  });

  it('lets active remediation finish in manual mode without committing or reviewing again', async () => {
    let release!: () => void;
    let findingId = '';
    const test = harness([
      async tools => { findingId = (await tools.reportFinding({ priority: 'p1', title: 'Fix access', body: 'Access is unchecked.' })).id; return { text: '', findingCount: 1 }; },
      async tools => { await new Promise<void>(resolve => { release = resolve; }); await tools.updateFinding({ findingId, status: 'fixed', evidence: 'Access regression passed.' }); return { text: 'Fixed.' }; },
      async () => ({ text: 'Manual reinspection.', findingCount: 0 }),
    ]);
    const session = test.service.startAutomatic(test.owner, { scope: { type: 'uncommitted' }, autoCommit: true });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const visible = reviewer(test, session);
    const before = structuredClone(session.rounds);
    await test.service.switchToManual(visible, session.id);
    expect(session.status).toBe('fixing');
    expect(session.rounds).toStrictEqual(before);
    release();
    await vi.waitFor(() => expect(session.status).toBe('readyToFinish'));
    expect(session.rounds[0]?.findings[0]?.remediation).toMatchObject({ state: 'fixed', evidence: 'Access regression passed.' });
    expect(session.rounds).toHaveLength(1);
    expect(test.git.commit).not.toHaveBeenCalled();
    await test.service.reviewAgain(visible, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(session.automation).toMatchObject({ enabled: false, state: 'manual' });
    expect(test.deleted).toEqual([]);
    test.service.submit(visible, session.id);
    await test.service.finish(visible, session.id);
    expect(test.handoffs.at(-1)?.content.split('</context>')[1]?.trim()).toBe('Manual review completed. 1 finding fixed. No findings remain.');
  });

  it.each(['queuedFix', 'beforeFixTurn', 'checkpoint', 'commit', 'nextRound'] as const)('handles a switch at the %s async boundary without starting more automation', async boundary => {
    let release!: () => void;
    let findingId = '';
    const test = harness([
      async tools => { findingId = (await tools.reportFinding({ priority: 'p1', title: 'Fix access', body: 'Access is unchecked.' })).id; return { text: '', findingCount: 1 }; },
      async tools => { await tools.updateFinding({ findingId, status: 'fixed', evidence: 'Tests passed.' }); return { text: 'Fixed.' }; },
    ]);
    const gate = () => new Promise<void>(resolve => { release = resolve; });
    if (boundary === 'queuedFix' || boundary === 'beforeFixTurn') test.changed.mockImplementation(async () => {
      const fixing = test.snapshot.agents.find(a => a.codeReview?.status === 'fixing')?.codeReview;
      if (fixing && test.turns.length === 1 && fixing.rounds[0]?.findings[0]?.remediation.state === (boundary === 'queuedFix' ? 'pending' : 'fixing')) await gate();
    });
    if (boundary === 'checkpoint') test.git.inspect.mockImplementation(async () => {
      if (test.turns.length === 2) await gate();
      return { head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' };
    });
    if (boundary === 'commit') test.git.commit.mockImplementation(async () => {
      await gate();
      return { head: 'c'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'committed', commit: 'c'.repeat(40) };
    });
    if (boundary === 'nextRound') test.saveReport.mockImplementation(async () => { await gate(); return '/reports/review.md'; });
    const session = test.service.startAutomatic(test.owner, { scope: { type: 'uncommitted' }, autoCommit: true });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    test.changed.mockImplementation(() => undefined);
    await test.service.switchToManual(reviewer(test, session), session.id);
    release();
    await vi.waitFor(() => expect(session.status).toBe(boundary === 'queuedFix' || boundary === 'beforeFixTurn' ? 'ready' : 'readyToFinish'));
    expect(test.turns).toHaveLength(boundary === 'queuedFix' || boundary === 'beforeFixTurn' ? 1 : 2);
    expect(session.rounds).toHaveLength(1);
    expect(session.automation).toMatchObject({ enabled: false, state: 'manual', commits: boundary === 'commit' || boundary === 'nextRound' ? ['c'.repeat(40)] : [] });
    expect(test.git.commit).toHaveBeenCalledTimes(boundary === 'commit' || boundary === 'nextRound' ? 1 : 0);
    expect(session.rounds[0]?.error).toBeUndefined();
    expect(test.deleted).toEqual([]);
    if (boundary === 'queuedFix' || boundary === 'beforeFixTurn') expect(session.rounds[0]?.findings[0]?.remediation.state).toBe('notStarted');
  });


  it.each(['current', 'independent'] as const)('keeps user instructions across %s review rounds and restoration without saving them as defaults', async threadMode => {
    const test = harness([async () => ({ text: 'Clean.', findingCount: 0 })]);
    test.owner.backendSession = { kind: 'codex', threadId: 'owner-thread' };
    const instructions = 'Focus on race conditions.\nCheck backward compatibility.';
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode, instructions: `  ${instructions}  `,
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(test.turns[0]!.prompt).toContain(instructions);
    expect(session.instructions).toBe(instructions);
    expect(test.snapshot.general.codeReviewDefaults ?? {}).not.toHaveProperty('instructions');

    const restored = harness([async () => ({ text: 'Still clean.', findingCount: 0 })]);
    const savedReviewer = JSON.parse(JSON.stringify(reviewer(test, session))) as Agent;
    if (threadMode === 'current') restored.snapshot.agents = [savedReviewer];
    else restored.snapshot.agents.push(savedReviewer);
    restored.service.submit(savedReviewer, session.id);
    await restored.service.reviewAgain(savedReviewer, session.id);
    await vi.waitFor(() => expect(savedReviewer.codeReview?.status).toBe('ready'));
    expect(restored.turns[0]!.prompt).toContain(instructions);
  });

  it('pauses an automatic review when the provider ends without explicitly finishing the inspection', async () => {
    const test = harness([async () => ({ text: 'I reported three findings using a different tool.' })]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
      automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 },
    });
    await vi.waitFor(() => expect(session.automation?.state).toBe('paused'));
    expect(test.turns[0]!.prompt).toContain(`mcp__${product.mcpServerName}__report_finding`);
    expect(test.turns[0]!.prompt).toContain(`mcp__${product.mcpServerName}__finish_review_round`);
    expect(test.turns[0]!.prompt).toContain('ToolSearch');
    expect(test.turns[0]!.prompt).toContain('ReportFindings');
    expect(session.status).toBe('failed');
    expect(session.automation?.reason).toContain('finish_review_round');
    expect(test.deleted).toEqual([]);
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(reviewer(test, session).backendSession).toBeDefined();
  });

  it('lets the reviewer correct a count mismatch but waits for the turn to end before closing', async () => {
    let endTurn!: () => void;
    let confirmed!: () => void;
    const confirmation = new Promise<void>(resolve => { confirmed = resolve; });
    const test = harness([async tools => {
      await expect(tools.finishReviewRound({ findingCount: 1 })).rejects.toThrow('report_finding');
      await tools.reportFinding({ priority: 'p3', title: 'Improve diagnostic', body: 'A minor diagnostic issue.' });
      await expect(tools.finishReviewRound({ findingCount: 1 })).resolves.toMatchObject({ findingCount: 1 });
      confirmed();
      await new Promise<void>(resolve => { endTurn = resolve; });
      return { text: 'One P3 finding.' };
    }]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
      automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 },
    });
    await confirmation;
    expect(session.status).toBe('reviewing');
    expect(test.deleted).toEqual([]);
    expect(test.git.commit).not.toHaveBeenCalled();
    endTurn();
    await vi.waitFor(() => expect(test.deleted).toHaveLength(1));
    expect(session.rounds[0]?.inspectionCompletion).toMatchObject({ findingCount: 1 });
  });

  it('invalidates a finish confirmation when the ledger changes even if its count stays the same', async () => {
    const test = harness([async tools => {
      const finding = await tools.reportFinding({ priority: 'p3', title: 'Improve diagnostic', body: 'A minor diagnostic issue.' });
      await tools.finishReviewRound({ findingCount: 1 });
      await tools.updateFinding({ findingId: finding.id, priority: 'p1' });
      return { text: 'Actually urgent.' };
    }]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
      automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 },
    });
    await vi.waitFor(() => expect(session.automation?.state).toBe('paused'));
    expect(session.automation?.reason).toContain('finish_review_round');
    expect(test.turns).toHaveLength(1);
    expect(test.deleted).toEqual([]);
  });

  it('does not reuse an accepted completion when resuming an interrupted inspection', async () => {
    const test = harness([async () => ({ text: 'Clean.', findingCount: 0 })]);
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const restored = harness([async () => ({ text: 'I forgot the completion tool.' })]);
    const savedReviewer = structuredClone(reviewer(test, session));
    savedReviewer.codeReview!.status = 'reviewing';
    savedReviewer.codeReview!.rounds[0]!.status = 'reviewing';
    restored.snapshot.agents.push(savedReviewer);
    expect(savedReviewer.codeReview!.rounds[0]!.inspectionCompletion).toBeDefined();
    await restored.service.resumeInterrupted(savedReviewer);
    await vi.waitFor(() => expect(savedReviewer.codeReview?.status).toBe('failed'));
    expect(savedReviewer.codeReview?.rounds[0]?.inspectionCompletion).toBeUndefined();
    expect(restored.deleted).toEqual([]);
  });

  it.each([undefined, false, true])('fixes and re-reviews with other agents active, committing only when opted in (%s)', async autoCommit => {
    let findingId = '';
    let fixed = false;
    const test = harness([
      async handlers => { findingId = (await handlers.reportFinding({ priority: 'p2', title: 'Fix authorization', body: 'An unauthorized write is possible.' })).id; return { text: 'Found a defect.', findingCount: 1 }; },
      async handlers => { fixed = true; await handlers.updateFinding({ findingId, status: 'fixed', evidence: 'npm test: authorization regression and literal </context> handling passed' }); return { text: 'Fixed and verified.' }; },
      async () => ({ text: 'No actionable findings.', findingCount: 0 }),
    ]);
    test.git.inspect.mockImplementation(async () => test.git.commit.mock.calls.length
      ? { head: 'c'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'committed' }
      : { head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: fixed ? 'fixed' : 'initial' });
    test.owner.status = { type: 'working' };
    test.snapshot.agents.push({ ...agent('another-worker'), status: { type: 'awaitingInput' } });
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent', backend: 'codex', model: 'review-model', reasoningEffort: 'high',
      automation: { enabled: true, maxPriority: 'p2', maxRounds: 3, ...(autoCommit !== undefined ? { autoCommit } : {}) },
    });
    expect(reviewer(test, session).backendDefaults).toMatchObject({ model: 'review-model', reasoningEffort: 'high' });
    await vi.waitFor(() => expect(test.deleted).toHaveLength(1));
    expect(test.git.commit).toHaveBeenCalledTimes(autoCommit ? 1 : 0);
    expect(session.automation).toMatchObject({ fingerprint: autoCommit ? 'committed' : 'fixed', head: (autoCommit ? 'c' : 'b').repeat(40), commits: autoCommit ? ['c'.repeat(40)] : [] });
    expect(session.rounds).toHaveLength(2);
    expect(test.turns[2]?.reviewerSession).toBeUndefined();
    expect(test.turns[2]?.prompt).toContain('a'.repeat(40));
    expect(test.handoffs[0]?.content).toContain(autoCommit ? 'c'.repeat(40) : 'Local commits: none');
    expect(test.turns[1]?.prompt).toContain('Do not commit, stage, push, merge');
    expect(test.turns[1]?.prompt).toContain(autoCommit ? 'workflow owns the local commit after validation' : 'Leave all fixes uncommitted');
    if (!autoCommit) expect(test.turns[1]?.prompt).not.toContain('workflow owns the local commit after validation');
    expect(test.handoffs[0]?.content).toContain('authorization regression');
    expect(test.handoffs[0]?.content).toContain(`/reports/${session.id}.md`);
    const [context, visible] = test.handoffs[0]!.content.split('</context>');
    expect(visible?.trim()).toBe(`Automatic review completed. 1 finding fixed. No findings remain.${autoCommit ? '' : ' Fixes left uncommitted.'}`);
    expect(context).toMatch(/^<context>\n/);
    expect(context).toContain('literal &lt;/context&gt; handling');
    expect(context).toContain(`/reports/${session.id}.md`);
    expect(session.rounds[0]?.reviewerSession).toEqual({ kind: 'codex', threadId: 'review-thread-1' });
    expect(session.rounds[0]?.summary).toBe('Found a defect.');
    expect(session.rounds[1]?.summary).toBe('No actionable findings.');
    expect(test.saveReport).toHaveBeenCalledTimes(2);
    expect(test.saveReport.mock.invocationCallOrder[0]).toBeLessThan(test.resetReviewer.mock.invocationCallOrder[0]!);
    expect(test.snapshot.general.codeReviewDefaults).toMatchObject({ backend: 'codex', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 }, providers: { codex: { model: 'review-model', reasoningEffort: 'high' } } });
    expect(test.snapshot.general.codeReviewDefaults?.automation.autoCommit).toBe(autoCommit);
  });

  it('keeps the reviewer and pauses automatic completion when saving its report fails', async () => {
    const test = harness([async () => ({ text: 'No actionable findings.', findingCount: 0 })]);
    test.saveReport.mockRejectedValue(new Error('Report disk is full.'));
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 } });
    await vi.waitFor(() => expect(session.automation?.state).toBe('paused'));
    expect(test.deleted).toEqual([]);
    expect(reviewer(test, session).backendSession).toEqual({ kind: 'codex', threadId: 'review-thread-1' });
    expect(session.automation?.reason).toContain('Report disk is full');
    expect(test.handoffs[0]?.content.split('</context>')[1]).not.toContain('No review findings to report');
  });

  it('keeps a review open if new findings arrive while its report is being saved', async () => {
    let handlers!: ReviewToolHandlers;
    const test = harness([async tools => { handlers = tools; return { text: 'No findings.', findingCount: 0 }; }]);
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);
    test.service.submit(visibleReviewer, session.id);
    let release!: (path: string) => void;
    test.saveReport.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const finishing = test.service.finish(visibleReviewer, session.id);
    await expect(test.service.finish(visibleReviewer, session.id)).rejects.toThrow('already responding');
    await handlers.reportFinding({ priority: 'p1', title: 'Check access', body: 'A late finding must not be lost.' });
    release('/reports/review.md');
    await expect(finishing).rejects.toThrow('review changed');
    expect(test.deleted).toEqual([]);
    expect(visibleReviewer.codeReview?.status).toBe('ready');
  });

  it('pauses at the round limit and reports unfinished work without deleting the reviewer', async () => {
    const test = harness([async handlers => { await handlers.reportFinding({ priority: 'p1', title: 'Fix access', body: 'Access is unchecked.' }); return { text: '', findingCount: 1 }; }]);
    const session = test.service.start(test.owner, { scope: { type: 'branch', baseRef: 'main' }, threadMode: 'independent', automation: { enabled: true, maxPriority: 'p2', maxRounds: 1 } });
    await vi.waitFor(() => expect(session.automation?.state).toBe('paused'));
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.deleted).toEqual([]);
    expect(session.automation?.reason).toContain('round limit');
    expect(session.status).toBe('ready');
  });

  it.each([
    { priorities: [], maxPriority: 'p2', outcome: 'No review findings to report.' },
    { priorities: ['p3'], maxPriority: 'p2', outcome: 'No P0–P2 findings. 1 P3 finding remains.' },
    { priorities: ['p2', 'p3'], maxPriority: 'p1', outcome: 'No P0–P1 findings. 1 P2 finding, 1 P3 finding remain.' },
  ] as const)('reports $outcome without remediating outside the selected threshold', async ({ priorities, maxPriority, outcome }) => {
    const test = harness([async handlers => {
      for (const priority of priorities) await handlers.reportFinding({ priority, title: 'Polish diagnostics', body: 'A minor problem.' });
      return { text: '', findingCount: priorities.length };
    }]);
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: true, maxPriority, maxRounds: 3 } });
    await vi.waitFor(() => expect(test.deleted).toHaveLength(1));
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.handoffs[0]?.content.split('</context>')[1]?.trim()).toBe(`Automatic review completed. ${outcome}`);
    expect(test.handoffs[0]?.content).not.toContain('Fixes left uncommitted');
    expect(session.rounds[0]?.findings[0]?.decision.state).not.toBe('rejected');
  });

  it.each(['validation', 'commit', 'repeated'] as const)('pauses and reports %s failures without declaring success', async failure => {
    let findingId = '';
    const test = harness([
      async handlers => { findingId = (await handlers.reportFinding({ priority: 'p1', title: 'Fix access', body: 'Access is unchecked.' })).id; return { text: '', findingCount: 1 }; },
      async handlers => { await handlers.updateFinding({ findingId, status: 'fixed', ...(failure !== 'validation' ? { evidence: 'npm test passed' } : {}) }); return { text: '' }; },
      async handlers => { await handlers.reportFinding({ priority: 'p1', title: 'Fix access', body: 'Still unchecked.', priorFindingId: findingId }); return { text: '', findingCount: 1 }; },
    ]);
    if (failure === 'commit') test.git.commit.mockRejectedValue(new Error('Commit hook failed.'));
    else test.git.commit.mockResolvedValue({ head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial', commit: 'c'.repeat(40) });
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3, autoCommit: true } });
    await vi.waitFor(() => expect(session.automation?.state).toBe('paused'));
    expect(test.deleted).toEqual([]);
    expect(test.handoffs).toHaveLength(1);
    expect(test.handoffs[0]?.content).toContain('not an approval to ship');
    expect(test.handoffs[0]?.content.split('</context>')[1]?.trim()).toMatch(/^Automatic review paused; it is not an approval to ship\./);
    expect(session.automation?.reason).toMatch(failure === 'validation' ? /Validation evidence/ : failure === 'commit' ? /Commit hook/ : /remains unresolved/);
    if (failure === 'validation') expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.turns).toHaveLength(failure === 'repeated' ? 3 : 2);
  });

  it('stops during remediation without committing or starting another round when the provider eventually returns', async () => {
    let finishFix!: () => void;
    let findingId = '';
    const test = harness([
      async handlers => { findingId = (await handlers.reportFinding({ priority: 'p2', title: 'Fix access', body: 'Access is unchecked.' })).id; return { text: '', findingCount: 1 }; },
      async handlers => {
        await new Promise<void>(resolve => { finishFix = resolve; });
        await handlers.updateFinding({ findingId, status: 'fixed', evidence: 'Tests passed' });
        return { text: '' };
      },
    ]);
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 } });
    await vi.waitFor(() => expect(finishFix).toBeTypeOf('function'));
    await test.service.discard(reviewer(test, session), session.id);
    finishFix();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(session.automation?.state).toBe('paused');
    expect(session.rounds).toHaveLength(1);
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.deleted).toEqual([]);
  });

  it('detects unexpected workspace edits during inspection and refuses to remediate them', async () => {
    const test = harness([async () => ({ text: 'No findings', findingCount: 0 })]);
    test.git.inspect.mockResolvedValue({ head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'external-edit' });
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 } });
    await vi.waitFor(() => expect(session.automation?.state).toBe('paused'));
    expect(session.automation?.reason).toContain('outside remediation');
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.deleted).toEqual([]);
  });

  it('restores an interrupted automatic review as paused without replaying provider turns or Git writes', async () => {
    const test = harness([async () => ({ text: '', findingCount: 0 })]);
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    session.automation = { enabled: true, maxPriority: 'p2', maxRounds: 3, state: 'running', commits: ['c'.repeat(40)], baseRef: 'a'.repeat(40), head: 'c'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'committed' };
    session.status = 'fixing';
    const restored = structuredClone(test.snapshot);
    const runReview = vi.fn();
    const restoredService = new CodeReviewService({ snapshot: restored, createAgent: vi.fn(), tools: test.tools, runReview, resetReviewer: vi.fn(), deleteReviewer: vi.fn(), saveReport: test.saveReport, git: test.git, changed: vi.fn() });
    const restoredReviewer = restored.agents.find(agent => agent.id === session.reviewerAgentId)!;
    await restoredService.resumeInterrupted(restoredReviewer);
    expect(restoredReviewer.codeReview).toMatchObject({ status: 'failed', automation: { state: 'paused', commits: ['c'.repeat(40)] } });
    expect(runReview).not.toHaveBeenCalled();
    expect(test.git.commit).not.toHaveBeenCalled();
  });

  it('allows a paused review to be remediated and reviewed again manually', async () => {
    let findingId = '';
    const test = harness([
      async handlers => { findingId = (await handlers.reportFinding({ priority: 'p2', title: 'Fix access', body: 'Access is unchecked.' })).id; return { text: '', findingCount: 1 }; },
      async handlers => { await handlers.updateFinding({ findingId, status: 'fixed' }); return { text: 'Fixed manually.' }; },
      async () => ({ text: 'No findings', findingCount: 0 }),
    ]);
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: true, maxPriority: 'p2', maxRounds: 1 } });
    await vi.waitFor(() => expect(session.automation?.state).toBe('paused'));
    const agent = reviewer(test, session);
    test.service.submit(agent, session.id);
    await vi.waitFor(() => expect(session.status).toBe('readyToFinish'));
    await test.service.reviewAgain(agent, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(session.rounds).toHaveLength(2);
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.deleted).toEqual([]);
  });

  it.each(['failure', 'stop'] as const)('does not resume an automatic retry after reset %s', async outcome => {
    const test = harness([async () => { throw new Error('Provider unavailable'); }]);
    const input = { scope: { type: 'uncommitted' as const }, threadMode: 'independent' as const, automation: { enabled: true, maxPriority: 'p2' as const, maxRounds: 3 } };
    const first = test.service.start(test.owner, input);
    await vi.waitFor(() => expect(first.automation?.state).toBe('paused'));
    const agent = reviewer(test, first);
    let release!: () => void;
    test.resetReviewer.mockImplementation(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      if (outcome === 'failure') throw new Error('Reset unavailable');
    });
    const retry = test.service.start(agent, input);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (outcome === 'stop') await test.service.discard(agent, retry.id);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(retry.automation?.state).toBe('paused');
    expect(test.turns).toHaveLength(1);
    expect(test.git.commit).not.toHaveBeenCalled();
    expect(test.handoffs).toHaveLength(2);
  });
  it('uses the selected reviewer provider defaults without copying the source provider settings', async () => {
    const test = harness([]);
    test.snapshot.general.claudeCodeEnabled = true;
    test.snapshot.general.providerApprovalDefaults = { claude: 'auto' };
    test.snapshot.general.providerModelDefaults = { claude: { model: 'sonnet', reasoningEffort: 'high', serviceTier: null } };
    test.owner.backendDefaults = { kind: 'codex', model: 'codex-model', reasoningEffort: 'high' };
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent', backend: 'claude',
    });
    expect(reviewer(test, session)).toMatchObject({ backend: 'claude' });
    expect(reviewer(test, session).backendDefaults).toStrictEqual({ kind: 'claude', model: 'sonnet', userSelectedModel: true, reasoningEffort: 'high', serviceTier: null, permissionMode: 'auto' });
    await vi.waitFor(() => expect(test.turns).toHaveLength(1));
    expect(test.turns[0]!.prompt).toContain(`mcp__${product.mcpServerName}__report_finding`);
    expect(test.turns[0]!.prompt).toContain(`mcp__${product.mcpServerName}__finish_review_round`);
    expect(test.turns[0]!.prompt).not.toContain('mcp__workspace__');
  });
  it.each([undefined, 'default'] as const)('inherits saved Claude permissions unless the source has an explicit mode (%s)', async permissionMode => {
    const test = harness([async () => ({ text: '', findingCount: 0 })]);
    test.snapshot.general.providerApprovalDefaults = { claude: 'auto' };
    test.owner.backend = 'claude';
    test.owner.backendDefaults = { kind: 'claude', model: 'opus', ...(permissionMode ? { permissionMode } : {}) };
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    expect(reviewer(test, session).backendDefaults).toMatchObject({ kind: 'claude', model: 'opus', permissionMode: permissionMode ?? 'auto' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
  });
  it('creates an independent reviewer as a normal adjacent agent for the same workspace', async () => {
    const test = harness([async () => ({ text: '', findingCount: 0 })]);
    test.owner.name = null;
    const neighbor = agent('neighbor');
    test.owner.avatar = 'owl';
    test.owner.openInApplication = 'vscode';
    test.owner.backendDefaults = {
      kind: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high',
    };
    test.owner.workspace = {
      kind: 'git', folder: '/repo', repositoryName: 'app', repositoryRoot: '/repo',
      branch: 'feat/review', isLinkedWorktree: false, primaryWorktreeRoot: '/repo',
      updatedAt: '2026-09-19T10:00:00.000Z',
    };
    test.snapshot.agents.push(neighbor);
    test.snapshot.agentGitStatuses[test.owner.id] = {
      folder: '/repo', branch: 'feat/review', ahead: 1, behind: 0,
      changedFiles: 2, addedLines: 12, removedLines: 3, hasUntracked: false,
      state: 'dirty', updatedAt: '2026-09-19T10:00:00.000Z',
    };

    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    const visibleReviewer = reviewer(test, session);

    expect(test.snapshot.agents.map((candidate) => candidate.id)).toEqual([
      test.owner.id, visibleReviewer.id, neighbor.id,
    ]);
    expect(visibleReviewer).toMatchObject({
      name: '👀 feat/review', avatar: 'owl', folder: '/repo', workspace: test.owner.workspace,
      backend: test.owner.backend,
      backendDefaults: { kind: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'high' },
      openInApplication: 'vscode', status: { type: 'idle' },
    });
    expect(visibleReviewer.backendSession).toBeUndefined();
    expect(test.snapshot.agentGitStatuses[visibleReviewer.id]).toStrictEqual(
      test.snapshot.agentGitStatuses[test.owner.id],
    );
    expect(test.snapshot.agentGitStatuses[visibleReviewer.id]).not.toBe(
      test.snapshot.agentGitStatuses[test.owner.id],
    );
  });

  it('discards an independent review by deleting its visible reviewer agent', async () => {
    const test = harness([async () => ({ text: '', findingCount: 0 })]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);

    await test.service.discard(visibleReviewer, session.id);

    expect(test.snapshot.agents).toStrictEqual([test.owner]);
    expect(test.deleted).toStrictEqual([visibleReviewer.id]);
    expect(test.handoffs).toStrictEqual([]);
  });

  it('retains an independent review ledger when its visible reviewer cannot be deleted', async () => {
    const test = harness([async () => ({ text: '', findingCount: 0 })], async () => {
      throw new Error('Reviewer agent could not be deleted.');
    });
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);
    test.service.submit(visibleReviewer, session.id);

    await expect(test.service.finish(visibleReviewer, session.id)).rejects.toThrow('could not be deleted');

    expect(visibleReviewer.codeReview).toBe(session);
    expect(session.status).toBe('readyToFinish');
    expect(test.handoffs).toStrictEqual([]);
  });

  describe('committing before completion', () => {
    const advancedHead = { head: 'd'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'committed' };
    async function readyToFinish(scripts: ReviewScript[] = []) {
      const test = harness([async () => ({ text: '', findingCount: 0 }), ...scripts]);
      const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
      await vi.waitFor(() => expect(session.status).toBe('ready'));
      const visibleReviewer = reviewer(test, session);
      test.service.submit(visibleReviewer, session.id);
      return { test, session, visibleReviewer };
    }

    it('asks the review agent to commit locally, keeps the review open, and then lets it finish', async () => {
      const { test, session, visibleReviewer } = await readyToFinish([async () => ({ text: 'Committed.' })]);
      test.git.inspect.mockResolvedValueOnce({ head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' }).mockResolvedValueOnce(advancedHead);

      await test.service.commit(visibleReviewer, session.id);

      expect(test.turns).toHaveLength(2);
      expect(test.turns[1]!.prompt).toContain('Commit the changes from this review');
      expect(test.turns[1]!.prompt).toContain('Do not push');
      expect(test.turns[1]!.reviewerSession).toStrictEqual(session.rounds[0]!.reviewerSession);
      expect(test.git.commit).not.toHaveBeenCalled();
      expect(session.status).toBe('readyToFinish');
      expect(test.deleted).toStrictEqual([]);

      await test.service.finish(visibleReviewer, session.id);
      expect(test.deleted).toStrictEqual([visibleReviewer.id]);
    });

    it('does not start a turn when the workspace has nothing to commit', async () => {
      const { test, session, visibleReviewer } = await readyToFinish();
      test.git.hasChanges.mockResolvedValue(false);

      await test.service.commit(visibleReviewer, session.id);

      expect(test.turns).toHaveLength(1);
      expect(session.status).toBe('readyToFinish');
      await test.service.finish(visibleReviewer, session.id);
      expect(test.deleted).toStrictEqual([visibleReviewer.id]);
    });

    it.each(['current', 'independent'] as const)('preserves committed changes across restored %s review rounds', async threadMode => {
      const test = harness([async () => ({ text: '', findingCount: 0 }), async () => ({ text: 'Committed.' })]);
      test.owner.backendSession = { kind: 'codex', threadId: 'owner-thread' };
      const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode });
      await vi.waitFor(() => expect(session.status).toBe('ready'));
      const visibleReviewer = reviewer(test, session);
      test.service.submit(visibleReviewer, session.id);
      test.git.inspect.mockResolvedValueOnce({ head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' }).mockResolvedValueOnce(advancedHead);

      await test.service.commit(visibleReviewer, session.id);

      const restored = harness([async () => ({ text: '', findingCount: 0 }), async () => ({ text: 'Committed again.' }), async () => ({ text: '', findingCount: 0 })]);
      const savedReviewer = JSON.parse(JSON.stringify(visibleReviewer)) as Agent;
      if (threadMode === 'current') restored.snapshot.agents = [savedReviewer];
      else restored.snapshot.agents.push(savedReviewer);
      await restored.service.reviewAgain(savedReviewer, session.id);
      await vi.waitFor(() => expect(savedReviewer.codeReview?.status).toBe('ready'));
      expect(restored.turns[0]!.prompt).toContain(`against ${'b'.repeat(40)}, including uncommitted changes`);

      restored.service.submit(savedReviewer, session.id);
      restored.git.inspect.mockResolvedValueOnce(advancedHead).mockResolvedValueOnce({ ...advancedHead, head: 'e'.repeat(40) });
      await restored.service.commit(savedReviewer, session.id);
      await restored.service.reviewAgain(savedReviewer, session.id);
      await vi.waitFor(() => expect(savedReviewer.codeReview?.status).toBe('ready'));
      expect(restored.turns[2]!.prompt).toContain(`against ${'b'.repeat(40)}, including uncommitted changes`);
    });

    it('fails and leaves the review untouched when the agent does not create a commit', async () => {
      const { test, session, visibleReviewer } = await readyToFinish([async () => ({ text: 'I could not commit.' })]);

      await expect(test.service.commit(visibleReviewer, session.id)).rejects.toThrow('did not create a commit');

      expect(session.status).toBe('readyToFinish');
      expect(session.rounds[0]!.status).toBe('completed');
      expect(session.scope).toStrictEqual({ type: 'uncommitted' });
      await test.service.finish(visibleReviewer, session.id);
      expect(test.deleted).toStrictEqual([visibleReviewer.id]);
    });

    it('rejects a second commit while the first is running and any commit before the review is ready', async () => {
      let release!: () => void;
      const { test, session, visibleReviewer } = await readyToFinish([() => new Promise(resolve => { release = () => resolve({ text: 'Committed.' }); })]);
      test.git.inspect.mockResolvedValueOnce({ head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' }).mockResolvedValueOnce(advancedHead);

      const first = test.service.commit(visibleReviewer, session.id);
      await vi.waitFor(() => expect(test.turns).toHaveLength(2));
      await expect(test.service.commit(visibleReviewer, session.id)).rejects.toThrow('already responding');
      release();
      await first;
      expect(test.turns).toHaveLength(2);

      session.status = 'ready';
      await expect(test.service.commit(visibleReviewer, session.id)).rejects.toThrow('not ready to commit');
    });

    it.each(['inspect', 'hasChanges'] as const)('blocks completion actions while %s preflight is pending', async check => {
      const { test, session, visibleReviewer } = await readyToFinish([async () => ({ text: 'Committed.' })]);
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      test.git.inspect.mockResolvedValueOnce({ head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' }).mockResolvedValueOnce(advancedHead);
      if (check === 'inspect') {
        test.git.inspect.mockReset().mockImplementationOnce(async () => {
          await pending;
          return { head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' };
        }).mockResolvedValue(advancedHead);
      } else test.git.hasChanges.mockImplementationOnce(async () => { await pending; return true; });

      const first = test.service.commit(visibleReviewer, session.id);
      try {
        await vi.waitFor(() => expect(test.git[check]).toHaveBeenCalled());
        await expect(test.service.commit(visibleReviewer, session.id)).rejects.toThrow('already responding');
        await expect(test.service.finish(visibleReviewer, session.id)).rejects.toThrow('already responding');
        await expect(test.service.reviewAgain(visibleReviewer, session.id)).rejects.toThrow('already responding');
        expect(test.turns).toHaveLength(1);
        expect(test.deleted).toStrictEqual([]);
      } finally {
        release();
        await first;
      }
      await test.service.finish(visibleReviewer, session.id);
      expect(test.deleted).toStrictEqual([visibleReviewer.id]);
    });

    it('releases the round after a Git preflight error', async () => {
      const { test, session, visibleReviewer } = await readyToFinish();
      test.git.inspect.mockRejectedValueOnce(new Error('Git unavailable'));

      await expect(test.service.commit(visibleReviewer, session.id)).rejects.toThrow('Git unavailable');

      await test.service.finish(visibleReviewer, session.id);
      expect(test.deleted).toStrictEqual([visibleReviewer.id]);
    });

    it('does not start a commit turn if the review is discarded during preflight', async () => {
      const { test, session, visibleReviewer } = await readyToFinish();
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      test.git.inspect.mockImplementationOnce(async () => {
        await pending;
        return { head: 'b'.repeat(40), branch: 'refs/heads/feature', fingerprint: 'initial' };
      });
      const commit = test.service.commit(visibleReviewer, session.id);
      await test.service.discard(visibleReviewer, session.id);
      release();

      await expect(commit).rejects.toThrow('no longer open');
      expect(test.turns).toHaveLength(1);
    });
  });

  it('notifies the original thread when an independent review finishes without fixes', async () => {
    const test = harness([async () => ({ text: '', findingCount: 0 })]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);

    test.service.submit(visibleReviewer, session.id);
    await test.service.finish(visibleReviewer, session.id);

    expect(test.handoffs).toStrictEqual([{
      from: visibleReviewer.id,
      to: test.owner.id,
      content: `<context>\nIndependent review completed. No review findings to report.\nReview report: /reports/${session.id}.md\n</context>\n\nIndependent review completed. No review findings to report.`,
    }]);
  });

  it('retries a failed independent review against the original target in the same visible reviewer', async () => {
    const test = harness([
      async () => { throw new Error('Reviewer stopped.'); },
      async () => ({ text: '', findingCount: 0 }),
    ]);
    const failed = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(failed.status).toBe('failed'));
    const visibleReviewer = reviewer(test, failed);

    const retried = test.service.start(visibleReviewer, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(retried.status).toBe('ready'));

    expect(retried.targetAgentId).toBe(test.owner.id);
    expect(retried.reviewerAgentId).toBe(visibleReviewer.id);
    expect(test.snapshot.agents).toHaveLength(2);
    expect(test.reset).toStrictEqual([visibleReviewer.id]);
    expect(test.turns[1]?.reviewerSession).toBeUndefined();
  });

  it('keeps automation and saved preferences when retrying a failed automatic review', async () => {
    const test = harness([
      async () => { throw new Error('Reviewer stopped.'); },
      async () => ({ text: '', findingCount: 0 }),
    ]);
    const automation = { enabled: true, maxPriority: 'p1' as const, maxRounds: 4 };
    const failed = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent', model: 'review-model', automation,
    });
    await vi.waitFor(() => expect(failed.status).toBe('failed'));
    const saved = structuredClone(test.snapshot.general.codeReviewDefaults);
    const visibleReviewer = reviewer(test, failed);

    const retried = test.service.start(visibleReviewer, { scope: { type: 'uncommitted' }, threadMode: 'independent', automation });

    expect(retried.automation).toMatchObject({ enabled: true, maxPriority: 'p1', maxRounds: 4, state: 'running' });
    expect(visibleReviewer.backendDefaults).toMatchObject({ model: 'review-model' });
    expect(test.snapshot.general.codeReviewDefaults).toEqual(saved);
    await vi.waitFor(() => expect(retried.status).not.toBe('reviewing'));
  });

  it('rejects review model overrides on the current thread and leaves the agent and saved preferences alone', () => {
    const test = harness([]);
    test.owner.backendSession = { kind: 'codex', threadId: 'current-thread' };
    test.owner.backendDefaults = { kind: 'codex', model: 'owner-model', reasoningEffort: 'low' };
    const saved = structuredClone(test.snapshot.general.codeReviewDefaults);

    expect(() => test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'current', model: 'review-model', reasoningEffort: 'high',
    })).toThrow('Invalid code review settings');

    expect(test.owner.backendDefaults).toEqual({ kind: 'codex', model: 'owner-model', reasoningEffort: 'low' });
    expect(test.owner.codeReview).toBeUndefined();
    expect(test.snapshot.general.codeReviewDefaults).toEqual(saved);
  });

  it('keeps every round in the current thread and never disposes that user-owned conversation', async () => {
    const test = harness([
      async () => ({ text: '', findingCount: 0 }),
      async () => ({ text: '', findingCount: 0 }),
    ]);
    test.owner.backendSession = { kind: 'codex', threadId: 'current-thread' };

    const session = test.service.start(test.owner, {
      scope: { type: 'branch', baseRef: 'origin/main' },
      threadMode: 'current',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));

    expect(session.scope).toStrictEqual({ type: 'branch', baseRef: 'origin/main' });
    expect(session.threadMode).toBe('current');
    expect(test.turns[0]?.reviewerSession).toStrictEqual({ kind: 'codex', threadId: 'current-thread' });
    const initialPrompt = test.turns[0]!.prompt;
    const contextEnd = initialPrompt.indexOf('</context>');
    expect(initialPrompt.slice(0, contextEnd)).toContain('the current branch against origin/main');
    expect(initialPrompt.slice(0, contextEnd)).toContain('korus-reviewer');
    expect(initialPrompt.slice(contextEnd + '</context>'.length).trim()).toBe(
      'Review the current branch against origin/main.',
    );

    test.service.submit(test.owner, session.id);
    await test.service.reviewAgain(test.owner, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));

    expect(test.turns[1]?.reviewerSession).toStrictEqual({ kind: 'codex', threadId: 'current-thread' });
    expect(session.rounds[1]?.reviewerSession).toStrictEqual({ kind: 'codex', threadId: 'current-thread' });
    test.service.submit(test.owner, session.id);
    await test.service.finish(test.owner, session.id);
    expect(test.reset).toStrictEqual([]);
    expect(test.deleted).toStrictEqual([]);
    expect(test.handoffs).toStrictEqual([]);
  });

  it('removes a reobserved finding from every round and the cumulative ledger', async () => {
    let tools!: ReviewToolHandlers;
    let findingId = '';
    const test = harness([
      async (context) => {
        tools = context;
        findingId = (await context.reportFinding({
          priority: 'p2', title: 'Check the retry path', body: 'The retry may fail.',
        })).id;
        return { text: '', findingCount: 1 };
      },
      async (context) => {
        await context.reportFinding({
          priority: 'p2', title: 'Check the retry path again', body: 'The latest code still fails.',
          priorFindingId: findingId,
        });
        return { text: '', findingCount: 1 };
      },
    ]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);
    test.service.decide(visibleReviewer, {
      sessionId: session.id, roundId: activeCodeReviewRound(session).id, findingId,
      decision: 'reject', reason: 'The retry already handles this.',
    });
    test.service.submit(visibleReviewer, session.id);
    await test.service.reviewAgain(visibleReviewer, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));

    await tools.deleteFinding({ findingId });

    expect(session.rounds.map((round) => round.findings)).toStrictEqual([[], []]);
    expect(codeReviewLedger(session)).toStrictEqual({ exclusions: [], regressionChecks: [], behaviorDecisions: [] });
  });

  it('carries skipped findings from every prior round inside the reviewer context', async () => {
    let firstSkippedId = '';
    let secondSkippedId = '';
    const test = harness([
      async (tools) => {
        firstSkippedId = (await tools.reportFinding({
          priority: 'p2', title: 'Invalidate the round one cache',
          body: 'The cache could be stale.',
        })).id;
        return { text: '', findingCount: 1 };
      },
      async (tools) => {
        secondSkippedId = (await tools.reportFinding({
          priority: 'p3', title: 'Reduce round two logging',
          body: 'The log could be noisy.',
        })).id;
        return { text: '', findingCount: 1 };
      },
      async () => ({ text: '', findingCount: 0 }),
    ]);

    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);
    let round = activeCodeReviewRound(session);
    test.service.decide(visibleReviewer, {
      sessionId: session.id, roundId: round.id, findingId: firstSkippedId,
      decision: 'reject', reason: 'The event stream already invalidates this cache.',
    });
    test.service.submit(visibleReviewer, session.id);

    await test.service.reviewAgain(visibleReviewer, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    round = activeCodeReviewRound(session);
    test.service.decide(visibleReviewer, {
      sessionId: session.id, roundId: round.id, findingId: secondSkippedId,
      decision: 'reject', reason: 'This verbosity is intentional during migration.',
    });
    test.service.submit(visibleReviewer, session.id);

    await test.service.reviewAgain(visibleReviewer, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));

    const thirdRoundPrompt = test.turns[2]!.prompt;
    const contextEnd = thirdRoundPrompt.indexOf('</context>');
    expect(thirdRoundPrompt.startsWith('<context>')).toBe(true);
    expect(contextEnd).toBeGreaterThan(0);
    expect(thirdRoundPrompt.slice(0, contextEnd)).toContain('Invalidate the round one cache');
    expect(thirdRoundPrompt.slice(0, contextEnd)).toContain('Reduce round two logging');
    expect(thirdRoundPrompt.slice(contextEnd + '</context>'.length).trim()).toBe(
      'Review the current uncommitted changes.',
    );
  });

  it('uses one reviewer thread for clarification and batched fixes, then starts review again fresh', async () => {
    let selectedId = '';
    let rejectedId = '';
    const test = harness([
      async (tools) => {
        selectedId = (await tools.reportFinding({
          priority: 'p1', title: 'Authorize before writing',
          body: 'The public mutation writes before checking ownership.',
          location: { file: 'src/auth.ts', line: 42 },
        })).id;
        rejectedId = (await tools.reportFinding({
          priority: 'p3', title: 'Reduce the cache lifetime',
          body: 'The value may be stale.',
        })).id;
        await tools.updateFinding({ findingId: selectedId, priority: 'p0' });
        await expect(tools.updateFinding({
          findingId: selectedId,
          title: 'This mutation must not stick',
          status: 'fixed',
        })).rejects.toThrow('Only a finding currently being fixed can be marked fixed.');
        return { text: '', findingCount: 2 };
      },
      async () => ({ text: 'The public route reaches the mutation directly.' }),
      async (tools) => {
        await tools.updateFinding({
          findingId: selectedId,
          status: 'fixed',
          evidence: 'Focused regression test passes.',
        });
        return { text: '' };
      },
      async () => ({ text: '', findingCount: 0 }),
    ]);

    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);
    const firstRound = activeCodeReviewRound(session);
    expect(firstRound.findings[0]?.priority).toBe('p0');
    expect(firstRound.findings[0]?.title).toBe('Authorize before writing');
    expect(firstRound.findings.map((finding) => finding.decision.state)).toEqual(['selected', 'selected']);
    expect(firstRound.reviewerSession).toEqual({ kind: 'codex', threadId: 'review-thread-1' });

    test.service.discuss(visibleReviewer, {
      sessionId: session.id, roundId: firstRound.id, findingId: selectedId,
      question: 'Is this reachable outside admin routes?',
    });
    await vi.waitFor(() => expect(firstRound.findings[0]?.discussion).toHaveLength(2));
    expect(firstRound.findings[0]?.discussion[0]?.body).toBe('Is this reachable outside admin routes?');
    expect(test.turns[1]?.prompt).toContain(`Review: ${session.id}`);
    expect(test.turns[1]?.prompt).toContain(`Round: ${firstRound.id}`);
    expect(test.turns[1]?.prompt).toContain(`"id": "${selectedId}"`);
    expect(test.turns[1]?.prompt).toContain('"priority": "p0"');
    expect(test.turns[1]?.prompt).toContain('"title": "Authorize before writing"');
    expect(test.turns[1]?.prompt).toContain('Is this reachable outside admin routes?');

    test.service.decide(visibleReviewer, {
      sessionId: session.id, roundId: firstRound.id, findingId: rejectedId,
      decision: 'reject',
    });
    test.service.submit(visibleReviewer, session.id);
    await vi.waitFor(() => expect(session.status).toBe('readyToFinish'));

    expect(firstRound.findings.find((finding) => finding.id === selectedId)?.remediation).toMatchObject({
      state: 'fixed', evidence: 'Focused regression test passes.',
    });
    expect(firstRound.findings.find((finding) => finding.id === rejectedId)?.remediation.state).toBe('skipped');
    expect(test.turns.slice(1, 3).map((turn) => turn.reviewerSession)).toEqual([
      { kind: 'codex', threadId: 'review-thread-1' },
      { kind: 'codex', threadId: 'review-thread-1' },
    ]);

    const secondRound = await test.service.reviewAgain(visibleReviewer, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(secondRound.reviewerSession).toEqual({ kind: 'codex', threadId: 'review-thread-4' });
    expect(test.turns[3]?.reviewerSession).toBeUndefined();
    expect(test.turns[3]?.prompt).toContain('Not selected for remediation.');
    expect(test.turns[3]?.prompt).toContain(selectedId);
    expect(test.reset).toStrictEqual([visibleReviewer.id]);

    test.service.submit(visibleReviewer, session.id);
    expect(session.status).toBe('readyToFinish');
    await test.service.finish(visibleReviewer, session.id);
    expect(test.deleted).toStrictEqual([visibleReviewer.id]);
    expect(test.snapshot.agents).toStrictEqual([test.owner]);
    expect(test.handoffs).toStrictEqual([{
      from: visibleReviewer.id,
      to: test.owner.id,
      content: `<context>\nIndependent review completed. 1 finding fixed. 1 P3 finding remains.\n- P0 — Authorize before writing\nNo reply to the reviewer is needed.\nReview report: /reports/${session.id}.md\n</context>\n\nIndependent review completed. 1 finding fixed. 1 P3 finding remains.`,
    }]);
  });

  it('keeps one review tool URL alive when the provider caches it for the reviewer thread', async () => {
    const snapshot = createEmptySnapshot();
    snapshot.providerConnections = (['codex', 'claude'] as const).map(backend => ({ backend, installed: true, connected: true, checking: false }));
    const owner = agent('owner');
    owner.backendSession = { kind: 'codex', threadId: 'current-thread' };
    snapshot.agents = [owner];
    const contexts = new Map<string, ReviewToolHandlers>();
    const reviewUrls: string[] = [];
    let cachedReviewUrl = '';
    let findingId = '';
    let contextSequence = 0;
    const closeReviewToolContext = vi.fn((contextId: string) => {
      contexts.delete(contextId);
    });
    const service = new CodeReviewService({
      snapshot,
      createAgent: (input, options) => new AgentCreationService(snapshot).create(input, options),
      tools: {
        createReviewToolContext: (agentId, _sessionId, handlers) => {
          const id = `context-${++contextSequence}`;
          contexts.set(id, handlers);
          return { id, url: `http://review.test/mcp?agentId=${agentId}&reviewContextId=${id}` };
        },
        closeReviewToolContext,
      },
      runReview: async (_agent, _prompt, reviewMcpServerUrl, reviewerSession) => {
        reviewUrls.push(reviewMcpServerUrl);
        cachedReviewUrl ||= reviewMcpServerUrl;
        const contextId = new URL(cachedReviewUrl).searchParams.get('reviewContextId') ?? '';
        const tools = contexts.get(contextId);
        if (!tools) throw new Error('Tool not found: update_finding');
        if (!findingId) {
          findingId = (await tools.reportFinding({
            priority: 'p1', title: 'Keep the review tool context alive',
            body: 'The reviewer thread retains its initial MCP server configuration.',
          })).id;
          await tools.finishReviewRound({ findingCount: 1 });
        } else {
          await tools.updateFinding({ findingId, status: 'fixed' });
        }
        return { text: '', reviewerSession: reviewerSession ?? { kind: 'codex', threadId: 'current-thread' } };
      },
      resetReviewer: async () => undefined,
      deleteReviewer: async () => undefined,
      saveReport: async () => '/reports/current.md',
      changed: vi.fn(),
    });

    const session = service.start(owner, { scope: { type: 'uncommitted' }, threadMode: 'current' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    service.submit(owner, session.id);
    await vi.waitFor(() => expect(session.status).not.toBe('fixing'));

    expect(session.status).toBe('readyToFinish');
    expect(reviewUrls[1]).toBe(reviewUrls[0]);
    expect(closeReviewToolContext).not.toHaveBeenCalled();
    await service.finish(owner, session.id);
    expect(closeReviewToolContext).toHaveBeenCalledOnce();
  });

  it('restores the review tool URL for an open reviewer after backend restart', async () => {
    const test = harness([async () => ({ text: '', findingCount: 0 })]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const snapshot = structuredClone(test.snapshot);
    let restoredTools!: ReviewToolHandlers;
    const createReviewToolContext = vi.fn((agentId: string, sessionId: string, handlers: ReviewToolHandlers) => {
      restoredTools = handlers;
      return { id: sessionId, url: `http://review.test/mcp?agentId=${agentId}&reviewContextId=${sessionId}` };
    });
    new CodeReviewService({
      snapshot,
      createAgent: (input, options) => new AgentCreationService(snapshot).create(input, options),
      tools: { createReviewToolContext, closeReviewToolContext: vi.fn() },
      runReview: vi.fn(),
      resetReviewer: vi.fn(),
      deleteReviewer: vi.fn(),
      saveReport: test.saveReport,
      changed: vi.fn(),
    });

    expect(createReviewToolContext).toHaveBeenCalledWith(session.reviewerAgentId, session.id, expect.any(Object));
    const finding = await restoredTools.reportFinding({
      priority: 'p1', title: 'Keep the restored review alive', body: 'The follow-up found a defect.',
    });
    const restoredReviewer = snapshot.agents.find((agent) => agent.id === session.reviewerAgentId)!;
    expect(activeCodeReviewRound(restoredReviewer.codeReview!).findings[0]?.id).toBe(finding.id);
  });

  it('sends every selected finding in one fix turn and records each fixed update', async () => {
    const ids: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstFixCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const test = harness([
      async (tools) => {
        for (const title of ['First', 'Second']) {
          ids.push((await tools.reportFinding({
            priority: 'p2', title, body: `${title} finding body. Literal <context> and </CONTEXT> tags.`,
          })).id);
        }
        return { text: '', findingCount: 2 };
      },
      async (tools) => {
        await firstFixCanFinish;
        await tools.updateFinding({ findingId: ids[0]!, status: 'fixed' });
        await tools.updateFinding({ findingId: ids[1]!, status: 'fixed' });
        return { text: '' };
      },
    ]);
    const session = test.service.start(test.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);
    const round = activeCodeReviewRound(session);
    expect(round.findings.map((finding) => finding.decision.state)).toEqual(['selected', 'selected']);
    round.findings[0]!.decision = { state: 'undecided' };

    test.service.submit(visibleReviewer, session.id);
    expect(round.findings[0]!.decision.state).toBe('selected');
    await vi.waitFor(() => expect(round.findings.map((finding) => finding.remediation.state)).toEqual(['fixing', 'fixing']));
    expect(test.turns).toHaveLength(2);
    const prompt = test.turns[1]!.prompt;
    const [, context, visible] = /^<context>\n([\s\S]*)\n<\/context>\n\n(.+)$/.exec(prompt) ?? [];
    expect(visible).toBe('Fix the 2 findings I selected.');
    expect(context).toContain(`${ids[0]}: First`);
    expect(context).toContain(`${ids[1]}: Second`);
    expect(context).toContain('korus-reviewer');
    expect(context).toContain(`Review: ${session.id}\nRound: ${round.number}`);
    expect(context).toContain('Literal &lt;context> and &lt;/CONTEXT> tags.');
    expect(prompt.match(/<\/?context>/giu)).toStrictEqual(['<context>', '</context>']);
    releaseFirst?.();
    await vi.waitFor(() => expect(round.findings.map((finding) => finding.remediation.state)).toEqual(['fixed', 'fixed']));
    expect(session.status).toBe('readyToFinish');
    expect(test.turns).toHaveLength(2);
    await test.service.finish(visibleReviewer, session.id);
    expect(test.turns).toHaveLength(2);
    expect(test.handoffs).toStrictEqual([{
      from: visibleReviewer.id,
      to: test.owner.id,
      content: `<context>\nIndependent review completed. 2 findings fixed. No findings remain.\n- P2 — First\n- P2 — Second\nNo reply to the reviewer is needed.\nReview report: /reports/${session.id}.md\n</context>\n\nIndependent review completed. 2 findings fixed. No findings remain.`,
    }]);
  });

  it('keeps finding tools available after the review turn and reopens a completed round', async () => {
    let tools!: ReviewToolHandlers;
    const test = harness([async (context) => { tools = context; return { text: '', findingCount: 0 }; }]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const round = activeCodeReviewRound(session);
    const finding = await tools.reportFinding({
      priority: 'p1', title: 'Fix the late finding', body: 'The failure is actionable.',
    });
    await tools.updateFinding({ findingId: finding.id, priority: 'p2' });
    expect(round.findings[0]).toMatchObject({ id: finding.id, priority: 'p2' });
    test.service.decide(reviewer(test, session), {
      sessionId: session.id, roundId: round.id, findingId: finding.id, decision: 'reject',
    });
    test.service.submit(reviewer(test, session), session.id);
    expect(session.status).toBe('readyToFinish');

    const late = await tools.reportFinding({
      priority: 'p1', title: 'Handle the missed path', body: 'A missed path still fails.',
    });
    expect(session.status).toBe('ready');
    expect(round.status).toBe('ready');
    expect(round.findings.map((item) => item.id)).toContain(late.id);
    await expect(tools.deleteFinding({ findingId: finding.id })).resolves.toStrictEqual({ findingId: finding.id, deleted: true });
    expect(round.findings.map((item) => item.id)).toStrictEqual([late.id]);
    expect(test.changed).toHaveBeenCalled();
  });

  it('accepts new findings during remediation and returns them for arbitration', async () => {
    let findingId = '';
    let lateFindingId = '';
    const test = harness([
      async (tools) => {
        findingId = (await tools.reportFinding({
          priority: 'p1', title: 'Fix the original finding',
          body: 'The review identified one concrete defect.',
        })).id;
        return { text: '', findingCount: 1 };
      },
      async (tools) => {
        lateFindingId = (await tools.reportFinding({
          priority: 'p2', title: 'Late finding',
          body: 'The follow-up exposed another issue.',
        })).id;
        await tools.updateFinding({ findingId, status: 'fixed' });
        return { text: '' };
      },
    ]);

    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);

    test.service.submit(visibleReviewer, session.id);
    await vi.waitFor(() => expect(session.status).toBe('ready'));

    expect(activeCodeReviewRound(session).findings).toHaveLength(2);
    expect(test.turns[1]!.prompt.split('</context>')[1]?.trim()).toBe('Fix the 1 finding I selected.');
    expect(activeCodeReviewRound(session).findings.find((finding) => finding.id === lateFindingId)?.remediation.state).toBe('notStarted');
    expect(activeCodeReviewRound(session).findings.find((finding) => finding.id === findingId)?.remediation.state).toBe('fixed');
  });

  it('lets the reviewer retract a finding during remediation', async () => {
    let findingId = '';
    const test = harness([
      async (tools) => {
        findingId = (await tools.reportFinding({
          priority: 'p2', title: 'Check this suspected failure', body: 'This might fail.',
        })).id;
        return { text: '', findingCount: 1 };
      },
      async (tools) => {
        await tools.deleteFinding({ findingId });
        return { text: '' };
      },
    ]);
    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    test.service.submit(reviewer(test, session), session.id);
    await vi.waitFor(() => expect(session.status).toBe('readyToFinish'));
    expect(activeCodeReviewRound(session).findings).toStrictEqual([]);
  });

  it('preserves completed fixes when remediation is interrupted and only retries unfinished findings', async () => {
    const ids: string[] = [];
    let signalFirstFixed: (() => void) | undefined;
    let releaseInterruptedTurn: (() => void) | undefined;
    let signalInterruptedTurnFinished: (() => void) | undefined;
    const firstFixed = new Promise<void>((resolve) => { signalFirstFixed = resolve; });
    const interruptedTurnCanFinish = new Promise<void>((resolve) => { releaseInterruptedTurn = resolve; });
    const interruptedTurnFinished = new Promise<void>((resolve) => { signalInterruptedTurnFinished = resolve; });
    const test = harness([
      async (tools) => {
        for (const title of ['Already fixed', 'Still pending']) {
          ids.push((await tools.reportFinding({
            priority: 'p1', title, body: `${title} body.`,
          })).id);
        }
        return { text: '', findingCount: 2 };
      },
      async (tools) => {
        await tools.updateFinding({
          findingId: ids[0]!, status: 'fixed', evidence: 'The first regression passes.',
        });
        signalFirstFixed?.();
        await interruptedTurnCanFinish;
        signalInterruptedTurnFinished?.();
        return { text: '' };
      },
      async (tools) => {
        await tools.updateFinding({ findingId: ids[1]!, status: 'fixed' });
        return { text: '' };
      },
    ]);

    const session = test.service.start(test.owner, {
      scope: { type: 'uncommitted' }, threadMode: 'independent',
    });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const visibleReviewer = reviewer(test, session);
    const round = activeCodeReviewRound(session);

    test.service.submit(visibleReviewer, session.id);
    await firstFixed;
    await test.service.handleTurnInterrupted(visibleReviewer);

    expect(round.findings[0]?.remediation).toMatchObject({
      state: 'fixed', evidence: 'The first regression passes.',
    });
    expect(round.findings[1]?.remediation).toStrictEqual({ state: 'notStarted' });

    releaseInterruptedTurn?.();
    await interruptedTurnFinished;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    test.service.submit(visibleReviewer, session.id);
    await vi.waitFor(() => expect(session.status).toBe('readyToFinish'));

    expect(test.turns[2]?.prompt).not.toContain(`${ids[0]}: Already fixed`);
    expect(test.turns[2]?.prompt).toContain(`${ids[1]}: Still pending`);
    expect(round.findings.map((finding) => finding.remediation.state)).toEqual(['fixed', 'fixed']);
  });

  it('restores an interrupted fixing round and resumes it in the persisted reviewer thread', async () => {
    let findingId = '';
    const original = harness([async (tools) => {
      findingId = (await tools.reportFinding({
        priority: 'p1', title: 'Restore this fix',
        body: 'The process stopped mid-fix; resume the same review thread.',
      })).id;
      return { text: '', findingCount: 1 };
    }]);
    const session = original.service.start(original.owner, { scope: { type: 'uncommitted' }, threadMode: 'independent' });
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    const round = activeCodeReviewRound(session);
    round.status = 'submitted';
    round.findings[0]!.decision = { state: 'selected', decidedAt: 'now' };
    round.findings[0]!.remediation = { state: 'fixing', startedAt: 'now' };
    session.status = 'fixing';

    const restored = harness([async (tools) => {
      await tools.updateFinding({ findingId, status: 'fixed' });
      return { text: '' };
    }]);
    const restoredReviewer: Agent = {
      ...structuredClone(reviewer(original, session)),
      codeReview: structuredClone(session),
    };
    restored.snapshot.agents.push(restoredReviewer);
    await restored.service.resumeInterrupted(restoredReviewer);

    await vi.waitFor(() => expect(restoredReviewer.codeReview?.status).toBe('readyToFinish'));
    expect(restoredReviewer.codeReview?.rounds[0]?.findings[0]?.remediation.state).toBe('fixed');
    expect(restored.turns[0]?.reviewerSession).toEqual({ kind: 'codex', threadId: 'review-thread-1' });
  });
});
