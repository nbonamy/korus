import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App.vue';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { installBackendFixture } from '../test/backend-fixture';
import { codexConversationSnapshot } from '../test/codex-conversation-fixtures';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { approvalAgentRequest } from '@workspace/core/agent-request';
import { clearFirstRunOnboardingStage } from '../onboarding-session';

beforeEach(clearFirstRunOnboardingStage);
afterEach(() => { delete window.app; });

function planAction(wrapper: VueWrapper, label: 'Approve' | 'Cancel') {
  const action = wrapper.get('.plan-review-footer').findAll('button').find(button => button.text() === label);
  if (!action) throw new Error(`Missing plan action: ${label}`);
  return action;
}

describe('Unified backend → mounted application', () => {
  it('shows and clears a finish-turn suggestion in the main composer through backend events', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    const { emit } = installBackendFixture(snapshot);
    const wrapper = mount(App);
    await flushPromises();
    const editor = () => wrapper.get('.chat-rich-text-editor');
    const defaultPlaceholder = editor().attributes('data-placeholder');

    emit({ type: 'agent.updated', agentId: agent.id, payload: {
      id: agent.id, suggestedPrompt: 'Verify that Korus is using my local SDK',
    } });
    await flushPromises();
    expect(editor().attributes('data-placeholder')).toBe('Verify that Korus is using my local SDK');
    expect(editor().text()).toBe('');

    emit({ type: 'agent.updated', agentId: agent.id, payload: { id: agent.id, suggestedPrompt: null } });
    await flushPromises();
    expect(editor().attributes('data-placeholder')).toBe(defaultPlaceholder);
    wrapper.unmount();
  });

  it.each(['backend gap', 'desktop recovery'])('settles a silent completed report after %s without another user prompt', async (recovery) => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'thread-1' };
    const { api, emit, emitSequenced } = installBackendFixture(snapshot);
    const wrapper = mount(App);
    await flushPromises();
    const report = { id: 'report', role: 'user' as const, status: 'complete' as const, turnId: 'report-turn', parts: [{ type: 'text' as const, text: 'Automatic review completed. No review findings to report.' }] };
    const messages = [report, { id: 'silent-report', role: 'assistant' as const, status: 'streaming' as const, turnId: 'report-turn', parts: [] }];
    emit({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: agent.id, threadId: 'thread-1', payload: {
      revision: 1, snapshot: codexConversationSnapshot(messages, { busy: true, activeTurnId: 'report-turn' }),
    } });
    await flushPromises();
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(true);

    // The app snapshot covers the missing completion's global sequence, but
    // intentionally carries no provider transcript. Recover it from its owner.
    api.getSnapshotState.mockResolvedValue({ snapshot, lastBackendEventSeq: 55, connection: { status: 'connected' } });
    api.loadConversationHistory.mockImplementation(async () => {
      emitSequenced({ seq: 56, occurredAt: '2026-10-05T19:05:26Z', type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: agent.id, threadId: 'thread-1', payload: {
        revision: 4, snapshot: codexConversationSnapshot([report], { turns: [{
          id: 'report-turn', status: 'completed', error: null, willRetry: false,
          startedAt: '2026-10-05T19:05:19Z', completedAt: '2026-10-05T19:05:26Z', durationMs: 6930,
        }] }),
      } });
      return snapshot;
    });
    if (recovery === 'backend gap') {
      emitSequenced({ seq: 55, occurredAt: '2026-10-05T19:05:26Z', type: 'agent.statusChanged', agentId: agent.id, payload: { type: 'idle' } });
    } else {
      emitSequenced({ seq: 1, source: 'client', occurredAt: '2026-10-05T19:05:26Z', type: 'snapshot.updated', payload: snapshot });
    }
    await flushPromises();
    expect(wrapper.find('.chat-message__thinking').exists()).toBe(false);
    expect(wrapper.get('.chat-message__empty-response').text()).toBe('Empty response');
    expect(wrapper.text()).toContain(report.parts[0]!.text);
    expect(wrapper.find('button[aria-label="Send prompt"]').exists()).toBe(true);
    expect(api.sendPrompt).not.toHaveBeenCalled();
  });

  it.each([
    [true, '/review', ''],
    [false, '  /review   Focus on race conditions.\nCheck backward compatibility.  ', 'Focus on race conditions.\nCheck backward compatibility.'],
  ] as const)('opens review setup and forwards instructions (flag present: %s)', async (ready, prompt, instructions) => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const agent = snapshot.agents[0]!;
    agent.threadFlags = { delegate_to_worktree: true, ...(ready ? { ready_for_review: true } : {}) };
    const { api } = installBackendFixture(snapshot);
    const cleared = structuredClone(snapshot);
    cleared.agents[0]!.threadFlags = { delegate_to_worktree: true };
    api.respondToThreadFlag.mockResolvedValue(cleared);
    const wrapper = mount(App);
    await flushPromises();

    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = prompt;
    await editor.trigger('input');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    if (ready) expect(api.respondToThreadFlag).toHaveBeenCalledExactlyOnceWith(agent.id, {
      id: 'ready_for_review', action: 'execute',
    });
    else expect(api.respondToThreadFlag).not.toHaveBeenCalled();
    expect(wrapper.get('[aria-label="Code review"]').isVisible()).toBe(true);
    expect(wrapper.find('[aria-label="Open code review"]').exists()).toBe(false);
    expect(wrapper.find('.thread-flag-affordance').exists()).toBe(true);
    expect(api.sendPrompt).not.toHaveBeenCalled();
    if (instructions) expect(wrapper.get('.code-review-panel__instructions').attributes('title')).toBe(instructions);
    else expect(wrapper.find('.code-review-panel__instructions').exists()).toBe(false);
    api.startCodeReview.mockResolvedValue(cleared);
    await wrapper.get('.code-review-panel__start').trigger('click');
    await flushPromises();
    expect(api.startCodeReview).toHaveBeenCalledExactlyOnceWith(agent.id, {
      automation: { enabled: false, maxPriority: 'p2', maxRounds: 3, autoCommit: false },
      backend: 'codex', scope: { type: 'uncommitted' }, threadMode: 'independent',
      ...(instructions ? { instructions } : {}),
    });
  });

  it('handles app-owned thread flag execution, dismissal, and review routing through the client seam', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.threadFlags = { delegate_to_worktree: true };
    const { api, emit } = installBackendFixture(snapshot);
    const wrapper = mount(App);
    await flushPromises();

    let rejectSend!: (error: Error) => void;
    api.sendPrompt.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
    await wrapper.get('.thread-flag-affordance__action').trigger('click');
    await flushPromises();
    await wrapper.get('.thread-flag-affordance__action').trigger('click');
    await flushPromises();
    expect(api.respondToThreadFlag).not.toHaveBeenCalled();
    expect(api.sendPrompt).toHaveBeenCalledExactlyOnceWith(agent.id, '/delegate');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    rejectSend(new Error('backend unavailable'));
    await flushPromises();
    expect(document.body.textContent).toContain('backend unavailable');
    expect(wrapper.find('.thread-flag-affordance').exists()).toBe(true);

    const cleared = structuredClone(snapshot);
    delete cleared.agents[0]!.threadFlags;
    api.sendPrompt.mockResolvedValueOnce(cleared);
    await wrapper.get('.thread-flag-affordance__action').trigger('click');
    await flushPromises();
    expect(api.sendPrompt).toHaveBeenLastCalledWith(agent.id, '/delegate');
    emit({ type: 'agent.updated', agentId: agent.id, payload: { id: agent.id, threadFlags: {} } });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find('.thread-flag-affordance').exists()).toBe(false);

    emit({ type: 'agent.updated', agentId: agent.id, payload: { id: agent.id, threadFlags: { delegate_to_worktree: true } } });
    await flushPromises();
    api.respondToThreadFlag.mockResolvedValueOnce(cleared);
    await wrapper.get('.thread-flag-affordance__dismiss').trigger('click');
    await flushPromises();
    expect(api.respondToThreadFlag).toHaveBeenNthCalledWith(1, agent.id, {
      id: 'delegate_to_worktree', action: 'dismiss',
    });
    expect(api.sendPrompt).toHaveBeenCalledTimes(2);

    emit({ type: 'agent.updated', agentId: agent.id, payload: { id: agent.id, threadFlags: { ready_for_review: true } } });
    await flushPromises();
    api.respondToThreadFlag.mockResolvedValueOnce(cleared);
    await wrapper.get('[aria-label="Open code review"]').trigger('click');
    await flushPromises();
    expect(api.respondToThreadFlag).toHaveBeenNthCalledWith(2, agent.id, {
      id: 'ready_for_review', action: 'execute',
    });
    expect(wrapper.get('[aria-label="Code review"]').isVisible()).toBe(true);
  });

  it('reflects execution progress and queued work from backend events without inventing review state', async () => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backendSession = { kind: 'codex', threadId: 'thread-1' };
    const { emit } = installBackendFixture(snapshot);
    const wrapper = mount(App);
    await flushPromises();
    const executionPlan = { turnId: 'turn', explanation: 'Implementing', steps: [{ step: 'Verify boundary behavior', status: 'inProgress' as const }], markdown: '- [ ] Verify boundary behavior', updatedAt: '2026-09-16T00:00:00Z' };
    emit({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: agent.id, threadId: 'thread-1', payload: { revision: 1, snapshot: codexConversationSnapshot([], { activeTurnId: 'turn', executionPlan, busy: true }) } });
    await flushPromises();
    expect(wrapper.get('.conversation-plan').text()).toContain('Verify boundary behavior');
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);
    emit({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: agent.id, threadId: 'thread-1', payload: { revision: 2, snapshot: codexConversationSnapshot([], { activeTurnId: 'turn', executionPlan: { ...executionPlan, steps: [{ step: 'Verify boundary behavior', status: 'completed' }] } }) } });
    await flushPromises();
    expect(wrapper.find('.conversation-plan__step--completed').exists()).toBe(true);
    emit({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: agent.id, threadId: 'thread-1', payload: { revision: 3, snapshot: codexConversationSnapshot([], { executionPlan: null }) } });
    await flushPromises();
    expect(wrapper.find('.conversation-plan').exists()).toBe(false);
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);

    emit({ type: 'codex.conversationSnapshotChanged', backend: 'codex', agentId: agent.id, threadId: 'thread-1', payload: { revision: 4, snapshot: codexConversationSnapshot() } });
    emit({ type: 'agent.promptQueued', agentId: agent.id, payload: { id: 'queued', text: 'Review the other agent change.' } });
    await flushPromises();
    expect(wrapper.text()).toContain('Review the other agent change.');
    emit({ type: 'agent.promptDequeued', agentId: agent.id, payload: { ids: ['queued'] } });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Review the other agent change.');
  });

  it('enforces advertised composer capabilities in the visible menu and submitted options', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const { api, emit } = installBackendFixture(snapshot);
    api.sendPrompt.mockResolvedValue(snapshot);
    const wrapper = mount(App);
    await flushPromises();
    const capabilities = { ...codexBackendCapabilities, attachments: false, planMode: 'unsupported' as const };
    emit({ type: 'backend.statusChanged', backend: 'codex', payload: { backend: 'codex', status: 'running', capabilities } });
    await flushPromises();
    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Add Files & Photos');
    expect(wrapper.get('[role="menu"]').text()).not.toContain('Plan mode');
    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    emit({ type: 'backend.statusChanged', backend: 'codex', payload: { backend: 'codex', status: 'running', capabilities: codexBackendCapabilities } });
    await flushPromises();
    await wrapper.get('button[aria-label="Composer actions"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="menu"]').text()).toContain('Add Files & Photos');
    const planMode = wrapper.findAll('[role="menuitemcheckbox"]').find((item) => item.text().includes('Plan mode'))!;
    await planMode.trigger('click');
    const editor = wrapper.get('[contenteditable="true"]');
    editor.element.textContent = 'Plan the fix';
    await editor.trigger('input');
    await wrapper.get('button[aria-label="Send prompt"]').trigger('click');
    await flushPromises();
    expect(api.sendPrompt).toHaveBeenCalledExactlyOnceWith(snapshot.activeAgentId, 'Plan the fix', expect.objectContaining({ planMode: true }));
  });

  it('shows a normalized approval and removes it when the backend cancels the request', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    const agent = snapshot.agents[0]!;
    agent.backend = 'claude';
    agent.backendSession = undefined;
    agent.backendDefaults = undefined;
    const { api, emit } = installBackendFixture(snapshot);
    const wrapper = mount(App);
    await flushPromises();
    const request = approvalAgentRequest({ id: 'permission', kind: 'permissions', conversationId: 'session', turnId: 'turn', itemId: 'item', title: 'Allow test workspace access', requestedPermissions: [{ kind: 'filesystem', access: 'write', path: '/tmp/project' }], allowedScopes: ['once'], canDeny: true });
    emit({ type: 'agentRequest.created', backend: 'claude', agentId: agent.id, payload: { request } });
    await flushPromises();
    expect(wrapper.findAll('[role="status"]').some(element => element.text().includes('Allow test workspace access'))).toBe(true);
    emit({ type: 'agentRequest.resolved', backend: 'claude', agentId: agent.id, payload: { id: request.id, outcome: { kind: 'cancelled' } } });
    emit({ type: 'agent.statusChanged', agentId: agent.id, payload: { type: 'working' } });
    await flushPromises();
    expect(wrapper.findAll('[role="status"]').some(element => element.text().includes('Allow test workspace access'))).toBe(false);
    expect(api.respondToClientRequest).not.toHaveBeenCalled();
  });

  it.each(['codex', 'claude'] as const)('reviews a %s agent plan using only the common contract', async (backend) => {
    const snapshot = createInitialSnapshot();
    const agent = snapshot.agents[0]!;
    agent.backend = backend;
    agent.backendSession = undefined;
    agent.backendDefaults = undefined;
    const { api, emit } = installBackendFixture(snapshot);
    const wrapper = mount(App);
    await flushPromises();
    emit({ type: 'plan.readyForReview', agentId: agent.id, turnId: 'turn', payload: { itemId: 'proposal', markdown: '# Review this\n\nKeep the backend independent.' } });
    await flushPromises();
    expect(wrapper.get('[aria-label="Right workspace"]').text()).toContain('Keep the backend independent.');
    const reviewId = JSON.stringify([agent.id, null, 'turn', 'proposal']);
    const accepted = structuredClone(snapshot);
    accepted.agents[0]!.planReview = { id: reviewId, conversationId: null, turnId: 'turn', itemId: 'proposal', markdown: '# Review this', status: 'accept' };
    api.respondToPlanReview.mockResolvedValue(accepted);
    await planAction(wrapper, 'Approve').trigger('click');
    await flushPromises();
    expect(api.respondToPlanReview).toHaveBeenCalledExactlyOnceWith(agent.id, { reviewId, resolution: 'accept', draftVersion: 0 });
    expect(api.sendPrompt).not.toHaveBeenCalled();
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);
    emit({ type: 'plan.readyForReview', agentId: agent.id, turnId: 'turn', payload: { itemId: 'proposal', markdown: '# Review this' } });
    await flushPromises();
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);
  });

  it('keeps failed plan decisions reviewable and handles local and remote resolution paths', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.planReview = { id: 'restored', conversationId: null, turnId: 'turn', markdown: '# Restored proposal', status: 'pending' };
    const agent = snapshot.agents[0]!;
    const { api, emit } = installBackendFixture(snapshot);
    api.respondToPlanReview.mockRejectedValueOnce(new Error('backend unavailable'));
    const wrapper = mount(App);
    await flushPromises();
    expect(wrapper.get('[aria-label="Right workspace"]').text()).toContain('Restored proposal');
    await planAction(wrapper, 'Approve').trigger('click');
    await flushPromises();
    expect(wrapper.find('.plan-review-footer').exists()).toBe(true);
    const accepted = structuredClone(snapshot);
    accepted.agents[0]!.planReview!.status = 'accept';
    api.respondToPlanReview.mockResolvedValueOnce(accepted);
    await planAction(wrapper, 'Approve').trigger('click');
    await flushPromises();
    expect(api.respondToPlanReview).toHaveBeenCalledTimes(2);
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);

    emit({ type: 'plan.readyForReview', agentId: agent.id, turnId: 'remote-turn', payload: { itemId: 'remote', markdown: '# Remote decision' } });
    await flushPromises();
    expect(wrapper.find('.plan-review-footer').exists()).toBe(true);
    const remoteReviewId = JSON.stringify([agent.id, null, 'remote-turn', 'remote']);
    emit({ type: 'plan.reviewResolved', agentId: agent.id, payload: { reviewId: remoteReviewId, resolution: 'cancel' } });
    await flushPromises();
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);

    emit({ type: 'plan.readyForReview', agentId: agent.id, turnId: 'cancel-turn', payload: { itemId: 'cancel', markdown: '# Cancel this proposal' } });
    await flushPromises();
    const cancelReviewId = JSON.stringify([agent.id, null, 'cancel-turn', 'cancel']);
    const cancelled = structuredClone(accepted);
    cancelled.agents[0]!.planReview = { id: cancelReviewId, conversationId: null, turnId: 'cancel-turn', itemId: 'cancel', markdown: '# Cancel this proposal', status: 'cancel' };
    api.respondToPlanReview.mockResolvedValueOnce(cancelled);
    await planAction(wrapper, 'Cancel').trigger('click');
    await flushPromises();
    expect(api.respondToPlanReview).toHaveBeenNthCalledWith(3, agent.id, { reviewId: cancelReviewId, resolution: 'cancel', draftVersion: 0 });
    expect(wrapper.find('.plan-review-footer').exists()).toBe(false);
    expect(api.sendPrompt).not.toHaveBeenCalled();
  });

  it('adopts durable review findings and decisions through the unified client seam', async () => {
    const snapshot = createInitialSnapshot();
    snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
    const agent = snapshot.agents[0]!;
    // Other mounted workspaces must not determine which agent receives the review.
    snapshot.agents.reverse();
    const { api } = installBackendFixture(snapshot);
    const wrapper = mount(App);
    await flushPromises();

    const targetWorkspace = wrapper.findAllComponents({ name: 'RightWorkspacePanel' })
      .find(panel => panel.props('agent').id === agent.id)!;
    await targetWorkspace.findAll('.right-workspace-panel__launcher button')
      .find((button) => button.text().includes('Review'))!
      .trigger('click');
    await flushPromises();
    expect(targetWorkspace.get('.code-review-panel').text()).toContain('Start a review');

    const ready = structuredClone(snapshot);
    const reviewer = {
      ...structuredClone(agent),
      id: 'agent-review',
      name: 'Review',
      backendSession: { kind: 'codex' as const, threadId: 'reviewer-1' },
    };
    reviewer.codeReview = {
      id: 'review-1', targetAgentId: agent.id, reviewerAgentId: reviewer.id,
      scope: { type: 'uncommitted' }, threadMode: 'independent', status: 'ready', activeRoundId: 'round-1',
      createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:01:00.000Z',
      rounds: [{
        id: 'round-1', number: 1, status: 'ready', reviewerSession: { kind: 'codex', threadId: 'reviewer-1' },
        startedAt: '2026-09-19T10:00:00.000Z', completedAt: '2026-09-19T10:01:00.000Z',
        findings: [{
          id: 'finding-1', roundId: 'round-1', priority: 'p1',
          title: 'Authorize before writing', body: 'The public mutation writes before checking ownership.',
          location: { file: 'src/auth.ts', line: 42 },
          decision: { state: 'selected', decidedAt: '2026-09-19T10:00:30.000Z' }, discussion: [], remediation: { state: 'notStarted' },
          createdAt: '2026-09-19T10:00:30.000Z', updatedAt: '2026-09-19T10:00:30.000Z',
        }],
      }],
    };
    ready.agents.push(reviewer);
    ready.teams[0]!.agentIds.push(reviewer.id);
    ready.teams[0]!.activeAgentId = reviewer.id;
    ready.activeAgentId = reviewer.id;
    api.startCodeReview.mockResolvedValueOnce(ready);
    await targetWorkspace.findAll('button').find((button) => button.text().includes('Start review'))!.trigger('click');
    await flushPromises();

    expect(api.startCodeReview).toHaveBeenCalledExactlyOnceWith(agent.id, {
      automation: { enabled: false, maxPriority: 'p2', maxRounds: 3, autoCommit: false },
      backend: 'codex',
      scope: { type: 'uncommitted' },
      threadMode: 'independent',
    });
    const reviewerPanel = wrapper.findAllComponents({ name: 'CodeReviewPanel' })
      .find((panel) => (panel.props('agent') as { id: string }).id === reviewer.id);
    expect(reviewerPanel?.props('agent')).toMatchObject({
      id: reviewer.id,
      name: 'Review',
    });
    expect(reviewerPanel!.get('.review-finding').text()).toContain('Authorize before writing');
    expect(reviewerPanel!.get('.review-finding__toggle').text()).not.toContain('src/auth.ts');
    await reviewerPanel!.get('.review-finding__toggle').trigger('click');
    expect(reviewerPanel!.get('.review-finding').text()).toContain('src/auth.ts:42');

    const excluded = structuredClone(ready);
    excluded.agents.find((candidate) => candidate.id === reviewer.id)!.codeReview!.rounds[0]!.findings[0]!.decision = {
      state: 'rejected', decidedAt: '2026-09-19T10:02:00.000Z',
    };
    api.decideCodeReviewFinding.mockResolvedValueOnce(excluded);
    await reviewerPanel!.get('.review-finding__selection').trigger('click');
    await flushPromises();

    expect(api.decideCodeReviewFinding).toHaveBeenCalledWith(reviewer.id, {
      sessionId: 'review-1', roundId: 'round-1', findingId: 'finding-1', decision: 'reject',
    });
    expect(reviewerPanel!.get('.review-finding').attributes('data-decision')).toBe('rejected');
    expect(reviewerPanel!.get('.review-finding__selection input').attributes('aria-checked')).toBe('false');
  });
});
