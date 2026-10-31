import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionReviewSetup } from '@workspace/core/companion-review';

async function fixture() {
  const connector = createDemoConnector(); const connect = connector.connect;
  const sendPrompt = vi.fn(async () => {}); const startReview = vi.fn<() => Promise<string | void>>(async () => {});
  const getWorkspace = vi.fn();
  const reviewSetup = vi.fn<(...args: unknown[]) => Promise<CompanionReviewSetup>>();
  connector.connect = async id => { const session = await connect(id); getWorkspace.mockImplementation(() => session.getWorkspace()); return { ...session, getWorkspace, sendPrompt, startReview, reviewSetup }; };
  const engine = createEngine({ connector, post() {} });
  await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
  const setup: CompanionReviewSetup = { target: engine.snapshot().composerTarget!, branch: 'feature', baseRef: 'main', uncommitted: true, branchChanges: true,
    currentThread: false, activeReview: false, reviewerAgentId: null, agentBackend: 'codex', backend: 'claude', backends: ['codex', 'claude'], models: [{ id: 'review-model', name: 'Reviewer', efforts: ['high'] }] };
  reviewSetup.mockResolvedValue(setup);
  return { engine, sendPrompt, startReview, reviewSetup, getWorkspace, setup };
}
const input = { scope: { type: 'branch' as const, baseRef: 'main' }, threadMode: 'independent' as const, automation: { enabled: true, maxPriority: 'p2' as const, maxRounds: 3, autoCommit: false }, selection: { backend: 'claude' as const, model: 'review-model', reasoningEffort: 'high', serviceTier: null } };

describe('native composer actions', () => {
  it('sends Delegate as a command and keeps the unfinished draft', async () => {
    const f = await fixture();
    try {
      await f.engine.dispatch({ type: 'draft', text: 'Keep this thought' });
      await f.engine.dispatch({ type: 'delegate', startingContext: 'handoff' });
      expect(f.sendPrompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'demo-agent' }), '/delegate', expect.any(String), { delegation: { startingContext: 'handoff' } });
      expect(f.engine.snapshot().draft).toBe('Keep this thought');
      await f.engine.dispatch({ type: 'disconnect' });
      await f.engine.dispatch({ type: 'delegate', startingContext: 'handoff' });
      expect(f.sendPrompt).toHaveBeenCalledTimes(1);
    } finally { f.engine.dispose(); }
  });
  it('loads setup without starting a review, then submits the chosen settings once', async () => {
    const f = await fixture();
    let accept!: () => void;
    f.startReview.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    try {
      await f.engine.dispatch({ type: 'loadReview' });
      expect(f.engine.snapshot().review).toStrictEqual({ status: 'ready', setup: f.setup });
      expect(f.startReview).not.toHaveBeenCalled();
      await f.engine.dispatch({ type: 'review', target: f.setup.target, input: { ...input, scope: { type: 'branch', baseRef: 'wrong' } } });
      expect(f.startReview).not.toHaveBeenCalled();
      const starting = f.engine.dispatch({ type: 'review', target: f.setup.target, input });
      expect(f.engine.snapshot().review.status).toBe('starting');
      await f.engine.dispatch({ type: 'review', target: f.setup.target, input });
      expect(f.startReview).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'demo-agent' }), input);
      accept(); await starting;
      expect(f.engine.snapshot().review.status).toBe('started');
    } finally { f.engine.dispose(); }
  });
  it('drops late setup after navigation and makes uncertain starts refresh before retrying', async () => {
    const f = await fixture();
    let finish!: (setup: CompanionReviewSetup) => void;
    f.reviewSetup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    try {
      const loading = f.engine.dispatch({ type: 'loadReview' });
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      finish(f.setup); await loading;
      expect(f.engine.snapshot().review).toStrictEqual({ status: 'idle', setup: null });
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await f.engine.dispatch({ type: 'loadReview' });
      f.startReview.mockRejectedValueOnce(new Error('Link dropped'));
      await f.engine.dispatch({ type: 'review', target: f.setup.target, input });
      expect(f.engine.snapshot().review.status).toBe('unknown');
      await f.engine.dispatch({ type: 'review', target: f.setup.target, input });
      expect(f.startReview).toHaveBeenCalledTimes(1);
      f.reviewSetup.mockResolvedValueOnce({ ...f.setup, activeReview: true });
      await f.engine.dispatch({ type: 'loadReview' });
      await f.engine.dispatch({ type: 'review', target: f.setup.target, input });
      expect(f.startReview).toHaveBeenCalledTimes(1);
    } finally { f.engine.dispose(); }
  });
  it('opens the desktop-created reviewer conversation after an acknowledged start', async () => {
    const f = await fixture();
    try {
      await f.engine.dispatch({ type: 'loadReview' });
      await f.engine.dispatch({ type: 'review', target: { ...f.setup.target, sessionId: 'stale' }, input });
      expect(f.startReview).not.toHaveBeenCalled();
      f.startReview.mockResolvedValueOnce('demo-reviewer');
      const workspace = await f.getWorkspace();
      let refresh!: (workspace: unknown) => void;
      f.getWorkspace.mockImplementationOnce(() => new Promise(resolve => { refresh = resolve; }));
      const starting = f.engine.dispatch({ type: 'review', target: f.setup.target, input });
      await vi.waitFor(() => expect(refresh).toBeTypeOf('function'));
      expect(f.engine.snapshot().review.status).toBe('starting');
      refresh(workspace); await starting;
      expect(f.engine.snapshot().agentId).toBe('demo-reviewer');
      expect(f.engine.snapshot().review).toStrictEqual({ status: 'idle', setup: null });
    } finally { f.engine.dispose(); }
  });
});

it('refreshes review findings, serializes actions and never replays an uncertain remediation or late result after navigation', async () => {
  const connector = createDemoConnector(); const connect = connector.connect;
  let resolve!: () => void;
  const details: import('@workspace/core/companion-review').CompanionReviewDetails = { target: { hostId: 'demo-laptop', locationId: 'local', teamId: 'demo-team', agentId: 'demo-agent', sessionId: null }, session: {
    id: 'review', targetAgentId: 'demo-agent', reviewerAgentId: 'demo-reviewer', status: 'ready', activeRoundId: 'round', updatedAt: 'v1', busy: false,
    rounds: [{ id: 'round', number: 1, status: 'ready', findings: [], startedAt: '' }] } };
  const readReview = vi.fn(async () => structuredClone(details));
  const reviewAction = vi.fn(async () => new Promise<void>(r => { resolve = r; }));
  let update!: (workspace: import('@workspace/core/companion-protocol').CompanionWorkspace, frame: null) => void;
  let workspace!: import('@workspace/core/companion-protocol').CompanionWorkspace;
  connector.connect = async id => {
    const session = await connect(id); workspace = { ...await session.getWorkspace(), reviewFindings: { "demo-agent": 1 } };
    return { ...session, getWorkspace: async () => workspace, readReview, reviewAction, onUpdate(listener) { update = listener; return () => {}; } };
  };
  const engine = createEngine({ connector, post() {} });
  try {
    await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
    expect(engine.snapshot().reviewFindingsCount).toBe(1);
    expect(readReview).not.toHaveBeenCalled();
    details.target = engine.snapshot().composerTarget!;
    await engine.dispatch({ type: 'loadReviewDetails' });
    expect(engine.snapshot().review.details).toStrictEqual(details);
    const command = { type: 'reviewAction' as const, target: details.target, input: { sessionId: 'review', roundId: 'round', updatedAt: 'v1', action: 'submit' as const } };
    let finishPoll!: (value: typeof details) => void;
    readReview.mockImplementationOnce(() => new Promise(r => { finishPoll = r; }));
    const polling = engine.dispatch({ type: 'loadReviewDetails' });
    const pending = engine.dispatch(command);
    finishPoll(structuredClone(details)); await polling;
    expect(engine.snapshot().review.action).toBe('working');
    await engine.dispatch(command); expect(reviewAction).toHaveBeenCalledTimes(1);
    details.session!.status = 'readyToFinish'; resolve(); await pending;
    expect(engine.snapshot().review.details?.session?.status).toBe('readyToFinish');
    reviewAction.mockRejectedValueOnce(new Error('Connection lost'));
    await engine.dispatch({ ...command, input: { ...command.input, action: 'again' } });
    expect(engine.snapshot().review.action).toBe('unknown');
    await engine.dispatch(command); expect(reviewAction).toHaveBeenCalledTimes(2);
    await engine.dispatch({ type: 'loadReviewDetails' });
    expect(engine.snapshot().review.action).toBe('idle');
    details.session!.updatedAt = 'v2';
    await engine.dispatch({ type: 'loadReviewDetails' });
    await engine.dispatch(command);
    expect(reviewAction).toHaveBeenCalledTimes(2);
    expect(engine.snapshot().review.action).toBe('failed');
    details.target = { ...details.target, sessionId: 'next-round-session' };
    workspace = { ...workspace, reviewFindings: { "demo-agent": 3 }, agents: workspace.agents.map(agent => agent.id === 'demo-agent' ? { ...agent, backendSession: { kind: 'codex' as const, threadId: 'next-round-session' } } : agent) };
    update(workspace, null);
    expect(engine.snapshot().reviewFindingsCount).toBe(3);
    await vi.waitFor(() => expect(engine.snapshot().review.details?.target.sessionId).toBe('next-round-session'));
    expect(engine.snapshot().review.details?.session?.id).toBe('review');
    let finish!: (value: typeof details) => void;
    readReview.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const late = engine.dispatch({ type: 'loadReviewDetails' });
    await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' }); finish(details); await late;
    expect(engine.snapshot().review.details).toBeUndefined();
    expect(engine.snapshot().reviewFindingsCount).toBeNull();
  } finally { engine.dispose(); }
});
