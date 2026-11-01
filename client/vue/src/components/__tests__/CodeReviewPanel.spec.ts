import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { ElInputNumber, ElSwitch, ElPopover, ElTabs, ElTabPane } from 'element-plus';
import { backendChoicesKey } from '../backend-selection';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, AgentGitStatus, AppSnapshot } from '@workspace/core/contracts';
import type { CodeReviewFinding, CodeReviewSession } from '@workspace/core/code-review';
import CodeReviewPanel from '../CodeReviewPanel.vue';
import { codeReviewSettingsKey } from '../code-review-settings';
import { codeReviewUncommittedPreviewKey } from '../code-review-preview';
import type { CodeReviewPreferences } from '@workspace/core/code-review';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import '../../styles/base.css';

function finding(overrides: Partial<CodeReviewFinding> = {}): CodeReviewFinding {
  return {
    id: 'finding-1',
    roundId: 'round-1',
    priority: 'p1',
    title: 'Authorize before writing',
    body: 'The public mutation writes before checking `ownership`. Authorize before writing.',
    location: { file: 'src/auth.ts', line: 42 },
    decision: { state: 'selected', decidedAt: '2026-09-19T10:00:00.000Z' },
    discussion: [],
    remediation: { state: 'notStarted' },
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
    ...overrides,
  };
}

function session(findings: CodeReviewFinding[], status: CodeReviewSession['status'] = 'ready'): CodeReviewSession {
  const roundStatus = status === 'reviewing' ? 'reviewing'
    : status === 'failed' ? 'failed'
      : status === 'fixing' ? 'submitted'
        : status === 'readyToFinish' || status === 'finished' ? 'completed'
          : 'ready';
  return {
    id: 'review-1', targetAgentId: 'owner', reviewerAgentId: 'reviewer', scope: { type: 'uncommitted' }, threadMode: 'independent', status, activeRoundId: 'round-1',
    createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:05:00.000Z',
    rounds: [{
      id: 'round-1', number: 1, status: roundStatus,
      reviewerSession: { kind: 'codex', threadId: 'review-thread-1' },
      findings, startedAt: '2026-09-19T10:00:00.000Z',
    }],
  };
}

function mountPanel(
  review?: CodeReviewSession,
  gitStatus?: AgentGitStatus,
  currentThreadAvailable = true,
  preferences?: CodeReviewPreferences,
  extraProps: Record<string, unknown> = {},
  extraProvide: Record<symbol, unknown> = {},
) {
  const actions = {
    startReview: vi.fn().mockResolvedValue({} as AppSnapshot),
    decideFinding: vi.fn().mockResolvedValue({} as AppSnapshot),
    submitReviewRound: vi.fn().mockResolvedValue({} as AppSnapshot),
    finishReview: vi.fn().mockResolvedValue({} as AppSnapshot),
    commitReview: vi.fn().mockResolvedValue({} as AppSnapshot),
    reviewAgain: vi.fn().mockResolvedValue({} as AppSnapshot),
    switchToManual: vi.fn().mockResolvedValue({}),
    stop: vi.fn().mockResolvedValue({}),
    listModels: vi.fn(async (_agentId: string, backend: string) => backend === 'codex'
      ? [{ id: 'codex-model', model: 'codex-model', displayName: 'Codex model', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }], serviceTiers: [{ id: 'fast', name: 'Fast' }] }]
      : [{ id: 'claude-model', model: 'claude-model', displayName: 'Claude model', supportedReasoningEfforts: [] }]),
  };
  const owner: Agent = {
    id: 'owner', name: 'Owner', folder: '/repo', backend: 'codex', status: { type: 'idle' },
    ...(currentThreadAvailable
      ? { backendSession: { kind: 'codex' as const, threadId: 'current-thread' } }
      : {}),
    createdAt: '2026-09-19T10:00:00.000Z', updatedAt: '2026-09-19T10:00:00.000Z',
    ...(review ? { codeReview: review } : {}),
  };
  return {
    actions,
    wrapper: mount(CodeReviewPanel, {
      props: { agent: owner, gitStatus, ...actions, ...extraProps },
      global: { components: { ElInputNumber, ElSwitch, ElPopover, ElTabs, ElTabPane }, provide: {
        ...extraProvide,
        [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']),
        [codeReviewSettingsKey as symbol]: { preferences: () => preferences, listModels: actions.listModels, switchToManual: actions.switchToManual, stop: actions.stop },
      } },
    }),
  };
}

describe('CodeReviewPanel', () => {
  it.each(['', '   '])('hides absent instructions and omits them when starting: %j', async instructions => {
    const { wrapper, actions } = mountPanel();
    await wrapper.setProps({ instructions });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Additional instructions');
    expect(wrapper.find('textarea').exists()).toBe(false);
    await wrapper.get('.code-review-panel__start').trigger('click');
    await flushPromises();
    const input = actions.startReview.mock.calls[0]![1] as Record<string, unknown>;
    expect(() => structuredClone(input)).not.toThrow();
    expect(input).not.toHaveProperty('instructions');
    wrapper.unmount();
  });

  it('shows supplied instructions read-only on one line and forwards the full text', async () => {
    const instructions = 'Focus on retries.\nCheck error handling and cancellation.';
    const { wrapper, actions } = mountPanel();
    await wrapper.setProps({ instructions });
    await flushPromises();
    const preview = wrapper.get('.code-review-panel__instructions');
    expect(preview.attributes('title')).toBe(instructions);
    expect(preview.text()).toBe('Focus on retries. Check error handling and cancellation.');
    expect(wrapper.find('textarea, [contenteditable="true"]').exists()).toBe(false);
    const style = getComputedStyle(preview.element);
    expect([style.whiteSpace, style.overflow, style.textOverflow]).toStrictEqual(['nowrap', 'hidden', 'ellipsis']);
    const headings = wrapper.findAll('.code-review-panel__setup legend, .app-section-label');
    const titleStyles = headings.map(heading => {
      const computed = getComputedStyle(heading.element);
      return [computed.fontSize, computed.fontWeight, computed.color, computed.textTransform];
    });
    expect(titleStyles.length).toBeGreaterThan(3);
    expect(titleStyles.every(style => JSON.stringify(style) === JSON.stringify(titleStyles[0]))).toBe(true);
    expect(headings.every(heading => getComputedStyle(heading.element).textTransform === 'uppercase')).toBe(true);
    expect(headings.every(heading => getComputedStyle(heading.element).color === 'var(--color-text-muted)')).toBe(true);
    expect(headings.every(heading => getComputedStyle(heading.element).fontWeight === 'var(--font-weight-bold)')).toBe(true);
    expect(headings.every(heading => getComputedStyle(heading.element).fontSize === 'var(--font-size-12)')).toBe(true);
    await wrapper.get('.code-review-panel__start').trigger('click');
    await flushPromises();
    expect(actions.startReview.mock.calls[0]![1]).toMatchObject({ instructions });
    wrapper.unmount();
  });

  it('configures automatic review in a dialog and uses those settings when starting', async () => {
    const { wrapper, actions } = mountPanel(undefined, undefined, true, {
      backend: 'codex', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 }, providers: {},
    });
    await flushPromises();
    const body = new DOMWrapper(document.body);
    expect(wrapper.find('[aria-label="Fix priorities"]').exists()).toBe(false);
    expect(body.find('[role="dialog"]').exists()).toBe(false);
    await wrapper.get('.code-review-panel__configure').trigger('click');
    await flushPromises();
    const dialog = body.get('[role="dialog"]');
    expect(dialog.text()).toContain('Never pushes or merges');
    expect(dialog.findAll('[aria-label="Fix priorities"] option').map(option => [option.attributes('value'), option.text()])).toEqual([
      ['p0', 'Only critical findings (P0)'],
      ['p1', 'Critical and high (P0 and P1)'],
      ['p2', 'Critical, high and medium (P0 to P2)'],
      ['p3', 'All findings (P0 to P3)'],
    ]);
    const commitToggle = dialog.get<HTMLInputElement>('[aria-label="Commit after each fix round"]');
    expect(commitToggle.element.checked).toBe(false);
    expect(dialog.text()).toContain('Leave changes uncommitted');
    await commitToggle.setValue(true);
    expect(dialog.text()).toContain('Includes existing uncommitted changes');
    await dialog.get('[aria-label="Fix priorities"] select').setValue('p1');
    await dialog.get('[aria-label="Maximum review rounds"]').setValue(5);
    await dialog.get('[aria-label="Maximum review rounds"]').trigger('change');
    await dialog.findAll('button').find(button => button.text() === 'Done')!.trigger('click');
    await flushPromises();
    expect(body.find('[role="dialog"]').exists()).toBe(false);
    await wrapper.get('.code-review-panel__configure').trigger('click');
    await flushPromises();
    expect(body.get<HTMLSelectElement>('[aria-label="Fix priorities"] select').element.value).toBe('p1');
    expect(body.get<HTMLInputElement>('[aria-label="Maximum review rounds"]').element.value).toBe('5');
    await body.get('[role="dialog"]').findAll('button').find(button => button.text() === 'Done')!.trigger('click');
    await wrapper.get('.code-review-panel__start').trigger('click');
    expect(actions.startReview).toHaveBeenCalledWith('owner', expect.objectContaining({
      automation: { enabled: true, maxPriority: 'p1', maxRounds: 5, autoCommit: true },
    }));
  });

  it('restores automatic settings and provider-specific model and effort, and clears unsupported effort on backend switch', async () => {
    const { wrapper, actions } = mountPanel(undefined, undefined, true, {
      backend: 'codex', automation: { enabled: true, maxPriority: 'p1', maxRounds: 4, autoCommit: true },
      providers: { codex: {backend: 'codex',  model: 'codex-model', reasoningEffort: 'high', serviceTier: 'fast' }, claude: {backend: 'claude', reasoningEffort: null, serviceTier: null,  model: 'claude-model' } },
    });
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[role="switch"]').element.checked).toBe(true);
    expect(wrapper.get('.backend-model-selector').text()).toContain('Codex model');
    expect(wrapper.get('.backend-model-selector').text()).toContain('high');
    expect(wrapper.get('.backend-model-selector').text()).toContain('fast');
    expect(wrapper.findAll('[role="radio"]').find(radio => radio.text().includes('Current thread'))!.attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('[role="radio"]').find(radio => radio.text().includes('Current thread'))!.text()).toContain('Not available for automatic reviews');
    await wrapper.get('.backend-model-selector').trigger('click');
    await flushPromises();
    const body = new DOMWrapper(document.body);
    await body.findAll('[role="tab"]').find(tab => tab.find('[aria-label="Claude Code"]').exists())!.trigger('click');
    await flushPromises();
    await body.findAll('[role="menuitemradio"]').find(item => item.text() === 'Claude model')!.trigger('click');
    await flushPromises();
    expect(wrapper.get('.backend-model-selector').text()).toContain('Claude model');
    expect(wrapper.get('.backend-model-selector').text()).not.toContain('high');
    await wrapper.get('.code-review-panel__start').trigger('click');
    expect(actions.startReview).toHaveBeenLastCalledWith('owner', { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: true, maxPriority: 'p1', maxRounds: 4, autoCommit: true }, selection: { backend: 'claude', model: 'claude-model', serviceTier: null, reasoningEffort: null } });
    await flushPromises();
    await wrapper.get('.backend-model-selector').trigger('click');
    await flushPromises();
    await body.findAll('[role="tab"]').find(tab => tab.find('[aria-label="Codex"]').exists())!.trigger('click');
    await flushPromises();
    await body.get('button[aria-label="Service tier: Fast"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.backend-model-selector').text()).toContain('high');
    await wrapper.get('.code-review-panel__start').trigger('click');
    expect(actions.startReview).toHaveBeenLastCalledWith('owner', expect.objectContaining({ selection: { backend: 'codex', model: 'codex-model', reasoningEffort: 'high', serviceTier: null } }));
    await flushPromises();
    await wrapper.get('[role="switch"]').setValue(false);
    const currentThread = wrapper.findAll('[role="radio"]').find(radio => radio.text().includes('Current thread'))!;
    expect(currentThread.text()).toContain('Existing context');
    expect(currentThread.text()).not.toContain('Not available for automatic reviews');
    expect(currentThread.attributes('disabled')).toBeUndefined();
  });

  it.each(['reviewing', 'fixing'] as const)('switches %s to manual without interrupting, then exposes Stop review and manual completion controls', async status => {
    const review = session([finding({ remediation: status === 'fixing' ? { state: 'fixing', startedAt: 'now' } : { state: 'notStarted' } })], status);
    review.automation = { enabled: true, maxPriority: 'p2', maxRounds: 3, autoCommit: true, state: 'running', commits: [] };
    const { wrapper: fixture, actions } = mountPanel();
    const owner = fixture.props('agent');
    fixture.unmount();
    const { api } = createClientApiMock();
    api.switchCodeReviewToManual.mockResolvedValue({} as AppSnapshot);
    let resolveInterrupt!: (snapshot: AppSnapshot) => void;
    api.interruptAgent.mockImplementation(() => new Promise(resolve => { resolveInterrupt = resolve; }));
    api.listBackendModels.mockResolvedValue([]);
    configureAppClient({ platform: 'web', api });
    const wrapper = mount(CodeReviewPanel, { props: { ...actions, agent: { ...owner, codeReview: review } } });
    try {
      expect(wrapper.text()).toContain('Automatic · round 1 of 3');
      expect(wrapper.find('.code-review-panel__footer').exists()).toBe(false);
      await wrapper.get('.code-review-panel__automation-status button').trigger('click');
      await flushPromises();
      expect(api.switchCodeReviewToManual).toHaveBeenCalledExactlyOnceWith('owner', 'review-1');
      expect(api.interruptAgent).not.toHaveBeenCalled();
      expect(api.discardCodeReview).not.toHaveBeenCalled();
      expect(wrapper.get('.code-review-panel__automation-status button').text()).toBe('Switch to manual');
      const manual = { ...review, automation: { ...review.automation, enabled: false, state: 'manual' as const } };
      await wrapper.setProps({ agent: { ...owner, codeReview: manual } });
      expect(wrapper.get('.code-review-panel__automation-status').text()).toContain('Manual review');
      const stop = wrapper.get('.code-review-panel__automation-status button');
      expect(stop.text()).toBe('Stop review');
      await stop.trigger('click');
      expect(api.interruptAgent).toHaveBeenCalledExactlyOnceWith('owner');
      expect(stop.attributes('disabled')).toBeDefined();
      expect(api.discardCodeReview).not.toHaveBeenCalled();
      resolveInterrupt({} as AppSnapshot);
      await flushPromises();
      expect(wrapper.find('.code-review-panel__footer').exists()).toBe(false);
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      const complete = session(status === 'fixing' ? [] : review.rounds[0]!.findings, status === 'fixing' ? 'readyToFinish' : 'ready');
      complete.automation = manual.automation;
      await wrapper.setProps({ agent: { ...owner, codeReview: complete } });
      expect(stop.attributes('disabled')).toBeDefined();
      const controls = wrapper.findAll('.code-review-panel__footer button');
      expect(controls.map(button => button.text())).toStrictEqual(status === 'fixing' ? ['Finish review', 'Review again'] : ['Remediate selected findings']);
      await controls[status === 'fixing' ? 1 : 0]!.trigger('click');
      expect(status === 'fixing' ? actions.reviewAgain : actions.submitReviewRound).toHaveBeenCalledWith('owner', 'review-1');
    } finally { wrapper.unmount(); configureAppClient(); }
  });

  it('offers Stop review for an originally manual review, including discussion turns, and disables it while idle', async () => {
    const review = session([finding()]);
    const { wrapper, actions } = mountPanel(review);
    const stop = wrapper.get('.code-review-panel__automation-status button');
    expect(stop.text()).toBe('Stop review');
    expect(stop.attributes('disabled')).toBeDefined();
    const owner = wrapper.props('agent');
    await wrapper.setProps({ agent: { ...owner, status: { type: 'awaitingInput' } } });
    expect(stop.attributes('disabled')).toBeUndefined();
    await stop.trigger('click');
    await flushPromises();
    expect(actions.stop).toHaveBeenCalledExactlyOnceWith('owner');
    await wrapper.setProps({ agent: { ...owner, codeReview: { ...review, status: 'finished' } } });
    expect(wrapper.find('.code-review-panel__automation-status button').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps the saved model and effort when returning from a reviewer to the original setup', async () => {
    const { wrapper } = mountPanel(undefined, undefined, true, {
      backend: 'codex', automation: { enabled: true, maxPriority: 'p2', maxRounds: 3 },
      providers: { codex: {backend: 'codex', serviceTier: null,  model: 'codex-model', reasoningEffort: 'high' } },
    });
    await flushPromises();
    const owner = wrapper.props('agent');
    await wrapper.setProps({ agent: { ...owner, id: 'reviewer', codeReview: session([]) } });
    await flushPromises();
    await wrapper.setProps({ agent: owner });
    await flushPromises();
    expect(wrapper.get('.backend-model-selector').text()).toContain('Codex model');
    expect(wrapper.get('.backend-model-selector').text()).toContain('high');
  });

  it('starts an independent review from an artifact-first empty state', async () => {
    const { wrapper, actions } = mountPanel();
    await flushPromises();

    expect(wrapper.text()).toContain('Start a review');
    expect(wrapper.text()).not.toContain('Choose a scope and reviewer.');
    expect(wrapper.findAll('fieldset')).toHaveLength(3);
    expect(wrapper.findAll('.code-review-panel__choices')).toHaveLength(2);
    expect(wrapper.findAll('.code-review-panel__choice-icon')).toHaveLength(4);
    const independent = wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Independent reviewer'))!;
    expect(independent.attributes('aria-checked')).toBe('true');
    const modelGroup = wrapper.findAll('fieldset').find(fieldset => fieldset.get('legend').text() === 'Review model')!;
    expect(modelGroup.get('button[aria-label="Coding agent and model"]').text()).toContain('Codex model');
    await modelGroup.get('button[aria-label="Coding agent and model"]').trigger('click');
    await flushPromises();
    const modelMenu = new DOMWrapper(document.body);
    await modelMenu.get('button[aria-label="Service tier: Standard"]').trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text().includes('Start review'))!.trigger('click');
    expect(actions.startReview).toHaveBeenCalledWith('owner', { scope: { type: 'uncommitted' }, threadMode: 'independent', automation: { enabled: false, maxPriority: 'p2', maxRounds: 3, autoCommit: false }, selection: { backend: 'codex', model: 'codex-model', reasoningEffort: 'high', serviceTier: 'fast' } });
  });

  it('offers branch scope when available and can review it in the current thread', async () => {
    const gitStatus: AgentGitStatus = {
      folder: '/repo', repository: 'app', branch: 'feature/review-setup',
      ahead: 2, behind: 0, changedFiles: 3, addedLines: 24, removedLines: 4,
      hasUntracked: false, state: 'dirty', updatedAt: '2026-09-19T10:00:00.000Z',
      diffCatalog: {
        defaultTarget: { type: 'branch', baseRef: 'origin/main' },
        branch: { baseRef: 'origin/main', addedLines: 24, removedLines: 4, changedFiles: 3 },
        uncommitted: { addedLines: 5, removedLines: 1, changedFiles: 1 },
        unstaged: { addedLines: 5, removedLines: 1, changedFiles: 1 },
        staged: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        commits: [{
          sha: 'abcdef123456', shortSha: 'abcdef1', subject: 'add review setup',
          addedLines: 19, removedLines: 3, changedFiles: 2,
        }],
      },
    };
    const { wrapper, actions } = mountPanel(undefined, gitStatus);

    expect(wrapper.text()).toContain('Against origin/main');
    expect(wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Uncommitted changes'))!.attributes('aria-checked')).toBe('true');
    await wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Current branch'))!.trigger('click');
    await wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Current thread'))!.trigger('click');
    expect(wrapper.get('.backend-model-selector').attributes('disabled')).toBeDefined();
    await wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Independent reviewer'))!.trigger('click');
    expect(wrapper.get('.backend-model-selector').attributes('disabled')).toBeUndefined();
    await wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Current thread'))!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Start review'))!.trigger('click');

    expect(actions.startReview).toHaveBeenCalledWith('owner', {
      scope: { type: 'branch', baseRef: 'origin/main' },
      threadMode: 'current',
      automation: { enabled: false, maxPriority: 'p2', maxRounds: 3, autoCommit: false },
    });
  });

  it('defaults to the branch when there are commits but no uncommitted changes', async () => {
    const gitStatus: AgentGitStatus = {
      folder: '/repo', repository: 'app', branch: 'feature/review-setup',
      ahead: 1, behind: 0, changedFiles: 0, addedLines: 0, removedLines: 0,
      hasUntracked: false, state: 'clean', updatedAt: '2026-09-19T10:00:00.000Z',
      diffCatalog: {
        defaultTarget: { type: 'branch', baseRef: 'origin/main' },
        branch: { baseRef: 'origin/main', addedLines: 19, removedLines: 3, changedFiles: 2 },
        uncommitted: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        unstaged: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        staged: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        commits: [{
          sha: 'abcdef123456', shortSha: 'abcdef1', subject: 'add review setup',
          addedLines: 19, removedLines: 3, changedFiles: 2,
        }],
      },
    };
    const { wrapper, actions } = mountPanel(undefined, gitStatus);

    await flushPromises();
    const lastCommit = wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Last commit'))!;
    expect(lastCommit.attributes('disabled')).toBeUndefined();
    const branch = wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Current branch'))!;
    expect(branch.attributes('aria-checked')).toBe('true');
    await wrapper.findAll('button').find((button) => button.text().includes('Start review'))!.trigger('click');

    expect(actions.startReview).toHaveBeenCalledWith('owner', { scope: { type: 'branch', baseRef: 'origin/main' }, threadMode: 'independent', automation: { enabled: false, maxPriority: 'p2', maxRounds: 3, autoCommit: false }, selection: { backend: 'codex', model: 'codex-model', reasoningEffort: 'high', serviceTier: null } });
    await lastCommit.trigger('click');
    await wrapper.get('.code-review-panel__start').trigger('click');
    expect(actions.startReview.mock.calls.at(-1)![1]).toMatchObject({ scope: { type: 'commit', sha: 'abcdef123456' } });
  });

  it('keeps unavailable branch and current-thread choices visible but disabled', () => {
    const gitStatus: AgentGitStatus = {
      folder: '/repo', repository: 'app', branch: 'feature/review-setup',
      ahead: 0, behind: 0, changedFiles: 1, addedLines: 3, removedLines: 0,
      hasUntracked: false, state: 'dirty', updatedAt: '2026-09-19T10:00:00.000Z',
      diffCatalog: {
        defaultTarget: { type: 'uncommitted' },
        branch: { baseRef: 'origin/main', addedLines: 0, removedLines: 0, changedFiles: 0 },
        uncommitted: { addedLines: 3, removedLines: 0, changedFiles: 1 },
        unstaged: { addedLines: 3, removedLines: 0, changedFiles: 1 },
        staged: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        commits: [],
      },
    };
    const { wrapper } = mountPanel(undefined, gitStatus, false);

    const branch = wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Current branch'))!;
    const current = wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Current thread'))!;
    expect(branch.attributes('disabled')).toBeDefined();
    expect(branch.text()).toContain('No branch changes');
    expect(current.attributes('disabled')).toBeDefined();
    expect(current.text()).toContain('Start a conversation first');
  });

  it('defaults to the last commit when the working tree and branch are clean', async () => {
    const gitStatus: AgentGitStatus = {
      folder: '/repo', repository: 'app', branch: 'main',
      ahead: 0, behind: 0, changedFiles: 0, addedLines: 0, removedLines: 0,
      hasUntracked: false, state: 'clean', updatedAt: '2026-09-19T10:00:00.000Z',
      diffCatalog: {
        defaultTarget: { type: 'uncommitted' },
        branch: { baseRef: 'origin/main', addedLines: 0, removedLines: 0, changedFiles: 0 },
        uncommitted: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        unstaged: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        staged: { addedLines: 0, removedLines: 0, changedFiles: 0 },
        commits: [],
        lastCommit: { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'latest change', addedLines: 2, removedLines: 0, changedFiles: 1 },
      },
    };
    const { wrapper, actions } = mountPanel(undefined, gitStatus);

    await flushPromises();
    const lastCommit = wrapper.findAll('[role="radio"]').find((radio) => radio.text().includes('Last commit'))!;
    expect(lastCommit.attributes('aria-checked')).toBe('true');
    expect(lastCommit.text()).toContain('aaaaaaa');
    await wrapper.get('.code-review-panel__start').trigger('click');
    expect(actions.startReview.mock.calls[0]![1]).toMatchObject({ scope: { type: 'commit', sha: 'a'.repeat(40) } });
    // A repository without a commit still has nothing to review.
    await wrapper.setProps({ gitStatus: { ...gitStatus, diffCatalog: { ...gitStatus.diffCatalog!, lastCommit: undefined } } });
    expect(wrapper.text()).toContain('Nothing to review');
    expect(wrapper.find('.code-review-panel__start').exists()).toBe(false);
  });

  it('shows findings as they arrive while describing the active review scope', async () => {
    const uncommittedReview = session([], 'reviewing');
    const { wrapper } = mountPanel(
      uncommittedReview,
      { branch: 'feat/iterative-review' } as AgentGitStatus,
    );

    expect(wrapper.get('.code-review-panel__header h2').text()).toBe('feat/iterative-review');
    expect(wrapper.get('.code-review-panel__working').classes()).toContain('is-waiting');
    expect(wrapper.get('.code-review-panel__working').text()).toContain('Review in progress');
    expect(wrapper.get('.code-review-panel__working').text()).toContain('Inspecting uncommitted changes.');
    expect(wrapper.find('.code-review-panel__progress').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Independent review');

    const reported = finding({ title: 'Validate the live finding' });
    await wrapper.setProps({
      agent: { ...wrapper.props('agent'), codeReview: session([reported], 'reviewing') },
    });

    expect(wrapper.get('.code-review-panel__working').text()).toContain('1 found');
    expect(wrapper.get('.code-review-panel__working').classes()).not.toContain('is-waiting');
    expect(wrapper.get('.review-finding').text()).toContain('Validate the live finding');
    expect(wrapper.find('.review-finding__quick-actions').exists()).toBe(false);

    const branchReview = session([], 'reviewing');
    branchReview.scope = { type: 'branch', baseRef: 'origin/main' };
    await wrapper.setProps({
      agent: { ...wrapper.props('agent'), codeReview: branchReview },
      gitStatus: { branch: 'feature/review-copy' } as AgentGitStatus,
    });

    expect(wrapper.get('.code-review-panel__working').text()).toContain(
      'Inspecting feature/review-copy against origin/main.',
    );
    expect(wrapper.get('.code-review-panel__header h2').text()).toBe('feature/review-copy');
  });

  it('shows a compact priority-ordered triage list and expands only one finding body from its header', async () => {
    const low = finding({ id: 'finding-low', priority: 'p3', title: 'Address the low priority issue', location: undefined });
    const critical = finding({ id: 'finding-critical', priority: 'p0', title: 'Address the critical issue', location: { file: 'src/auth.ts', line: 42, endLine: 47 } });
    const { wrapper } = mountPanel(session([low, critical]));

    expect(wrapper.get('[role="tab"]').text()).toBe('Round 1');
    expect(wrapper.findAll('.review-finding').map((node) => node.text())).toEqual([
      expect.stringContaining('Address the critical issue'),
      expect.stringContaining('Address the low priority issue'),
    ]);
    expect(wrapper.find('.review-finding__body').exists()).toBe(false);
    expect(wrapper.findAll('.review-finding__quick-action')).toHaveLength(2);
    expect(wrapper.findAll('.review-finding__quick-action').map((button) => button.attributes('aria-label'))).toEqual([
      'Clarify', 'Clarify',
    ]);
    expect(wrapper.findAll('.review-finding__selection')).toHaveLength(2);

    const criticalCard = wrapper.findAll('.review-finding')[0]!;
    await criticalCard.get('.review-finding__selection').trigger('click');
    expect(criticalCard.find('.review-finding__body').exists()).toBe(false);
    await criticalCard.get('.review-finding__quick-action').trigger('click');
    expect(criticalCard.find('.review-finding__body').exists()).toBe(false);
    await criticalCard.get('.review-finding__toggle').trigger('click');
    expect(criticalCard.text()).toContain('The public mutation writes before checking ownership.');
    expect(criticalCard.text()).toContain('Authorize before writing.');
    expect(criticalCard.get('code').text()).toBe('ownership');
    expect(criticalCard.get('.review-finding__location').text()).toBe('src/auth.ts:42–47');

    const lowCard = wrapper.findAll('.review-finding')[1]!;
    await lowCard.get('.review-finding__toggle').trigger('click');
    expect(criticalCard.get('.review-finding__toggle').attributes('aria-expanded')).toBe('false');
    expect(wrapper.findAll('.review-finding__body')).toHaveLength(1);
    expect(lowCard.find('.review-finding__location').exists()).toBe(false);
  });

  it('deselects findings through compact toggles and visually mutes unselected cards', async () => {
    const low = finding({
      id: 'finding-low',
      priority: 'p3',
      title: 'Address the low priority issue',
      decision: { state: 'rejected', decidedAt: 'now' },
    });
    const critical = finding({ id: 'finding-critical', priority: 'p0', title: 'Address the critical issue' });
    const { wrapper, actions } = mountPanel(session([low, critical]));

    expect(wrapper.find('.review-finding__state').exists()).toBe(false);
    const criticalCard = wrapper.findAll('.review-finding')[0]!;
    expect((criticalCard.get('.review-finding__selection input').element as HTMLInputElement).checked).toBe(true);
    await criticalCard.get('.review-finding__selection').trigger('click');
    await flushPromises();
    expect(actions.decideFinding).toHaveBeenCalledWith('owner', expect.objectContaining({
      findingId: 'finding-critical', decision: 'reject',
    }));

    const lowCard = wrapper.findAll('.review-finding')[1]!;
    expect(lowCard.attributes('data-decision')).toBe('rejected');
    expect((lowCard.get('.review-finding__selection input').element as HTMLInputElement).checked).toBe(false);
    await lowCard.get('.review-finding__selection').trigger('click');
    await flushPromises();
    expect(actions.decideFinding).toHaveBeenCalledWith('owner', expect.objectContaining({
      findingId: 'finding-low', decision: 'select',
    }));
  });

  it('keeps the review controls stable while a finding decision is saved', async () => {
    let resolveDecision!: (snapshot: AppSnapshot) => void;
    const pendingDecision = new Promise<AppSnapshot>((resolve) => {
      resolveDecision = resolve;
    });
    const { wrapper } = mountPanel(session([
      finding({ id: 'finding-critical', priority: 'p0' }),
      finding({ id: 'finding-secondary', priority: 'p2' }),
    ]));
    await wrapper.setProps({ decideFinding: vi.fn().mockReturnValue(pendingDecision) });

    const findingCards = wrapper.findAll('.review-finding');
    const footerAction = wrapper.get('.code-review-panel__footer .app-button--primary');
    const secondaryClarify = findingCards[1]!.get('.review-finding__quick-action');
    await findingCards[0]!.get('.review-finding__selection').trigger('click');

    expect(footerAction.attributes('disabled')).toBeUndefined();
    expect(secondaryClarify.attributes('disabled')).toBeUndefined();

    resolveDecision({} as AppSnapshot);
    await flushPromises();
  });

  it('hands clarification to the owning conversation without rendering a local composer or history', async () => {
    const selected = finding({
      decision: { state: 'selected', decidedAt: 'now' },
      discussion: [{
        id: 'discussion-1',
        author: 'reviewer',
        body: 'This belongs in the conversation.',
        createdAt: 'now',
      }],
    });
    const { wrapper } = mountPanel(session([selected]));

    await wrapper.get('.review-finding__quick-action').trigger('click');
    expect(wrapper.emitted('clarifyFinding')).toEqual([[
      { sessionId: 'review-1', roundId: 'round-1', finding: selected },
    ]]);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('form').exists()).toBe(false);
    await wrapper.get('.review-finding__toggle').trigger('click');
    expect(wrapper.text()).not.toContain('This belongs in the conversation.');
  });

  it('shows only remediation statuses after the round starts', async () => {
    const { wrapper } = mountPanel(session([
      finding({ id: 'skipped', decision: { state: 'rejected', decidedAt: 'now', reason: 'Expected by contract.' }, remediation: { state: 'skipped', startedAt: 'now' } }),
      finding({ id: 'pending', decision: { state: 'selected', decidedAt: 'now' }, remediation: { state: 'pending', queuedAt: 'now' } }),
      finding({ id: 'fixing', decision: { state: 'selected', decidedAt: 'now' }, remediation: { state: 'fixing', startedAt: 'now' } }),
      finding({ id: 'fixed', decision: { state: 'selected', decidedAt: 'now' }, remediation: { state: 'fixed', completedAt: 'now' } }),
    ], 'fixing'));

    expect(wrapper.findAll('.review-finding').map((node) => node.attributes('data-state'))).toEqual([
      'skipped', 'pending', 'fixing', 'fixed',
    ]);
    expect(wrapper.findAll('.review-finding__state').map((node) => node.text())).toEqual([
      'Skipped', 'Pending', 'Fixing', 'Fixed',
    ]);
    await wrapper.findAll('.review-finding__toggle')[0]!.trigger('click');
    expect(wrapper.text()).toContain('Expected by contract.');
  });

  it('offers the exact finish and repeat actions after fixes complete', async () => {
    const { wrapper, actions } = mountPanel(session([], 'readyToFinish'));
    const buttons = wrapper.findAll('.code-review-panel__footer button');
    const clearCopy = wrapper.get('.code-review-panel__clear');

    expect(clearCopy.text()).toContain('No findings in this round');
    expect(clearCopy.findAll('strong, span').map((node) => getComputedStyle(node.element).gridColumn))
      .toEqual(['2', '2']);
    expect(buttons.map((button) => button.text())).toEqual(['Finish review', 'Review again']);
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    expect(actions.finishReview).toHaveBeenCalledWith('owner', 'review-1');
    expect(actions.reviewAgain).toHaveBeenCalledWith('owner', 'review-1');
  });

  describe('committing before completion', () => {
    const dirtyStatus: AgentGitStatus = {
      folder: '/repo', repository: 'app', branch: 'feature/demo', ahead: 0, behind: 0, changedFiles: 2,
      addedLines: 6, removedLines: 1, hasUntracked: false, state: 'dirty', updatedAt: '2026-09-19T10:00:00.000Z',
    };
    const cleanStatus: AgentGitStatus = { ...dirtyStatus, changedFiles: 0, addedLines: 0, removedLines: 0, state: 'clean' };
    const footerButtons = (wrapper: ReturnType<typeof mountPanel>['wrapper']) => wrapper.findAll('.code-review-panel__footer button');
    const checkbox = (wrapper: ReturnType<typeof mountPanel>['wrapper']) => wrapper.find('.code-review-panel__footer input[type="checkbox"]');

    it('keeps Finish review secondary and Review again primary, with a commit option only while changes remain', async () => {
      const dirty = mountPanel(session([], 'readyToFinish'), dirtyStatus);
      expect(footerButtons(dirty.wrapper).map((button) => [button.text(), button.classes().find((name) => name.startsWith('app-button--'))]))
        .toEqual([['Finish review', 'app-button--secondary'], ['Review again', 'app-button--primary']]);
      expect(dirty.wrapper.get('.code-review-panel__footer').text()).toContain('Commit changes');
      expect(checkbox(dirty.wrapper).element).toHaveProperty('checked', false);
      dirty.wrapper.unmount();

      const clean = mountPanel(session([], 'readyToFinish'), cleanStatus);
      expect(footerButtons(clean.wrapper).map((button) => button.text())).toEqual(['Finish review', 'Review again']);
      expect(checkbox(clean.wrapper).exists()).toBe(false);
      clean.wrapper.unmount();
    });

    it('does not commit unless the option is ticked', async () => {
      const { wrapper, actions } = mountPanel(session([], 'readyToFinish'), dirtyStatus);
      await footerButtons(wrapper)[0]!.trigger('click');
      await flushPromises();
      expect(actions.commitReview).not.toHaveBeenCalled();
      expect(actions.finishReview).toHaveBeenCalledExactlyOnceWith('owner', 'review-1');
      wrapper.unmount();
    });

    it.each([['finishReview', 0], ['reviewAgain', 1]] as const)('commits through the review agent before %s runs', async (action, index) => {
      const { wrapper, actions } = mountPanel(session([], 'readyToFinish'), dirtyStatus);
      const order: string[] = [];
      actions.commitReview.mockImplementation(async () => { order.push('commit'); return {} as AppSnapshot; });
      actions[action].mockImplementation(async () => { order.push(action); return {} as AppSnapshot; });

      await checkbox(wrapper).setValue(true);
      await footerButtons(wrapper)[index]!.trigger('click');
      await flushPromises();

      expect(order).toEqual(['commit', action]);
      expect(actions.commitReview).toHaveBeenCalledExactlyOnceWith('owner', 'review-1');
      wrapper.unmount();
    });

    it('keeps the review available and skips the action when the commit fails', async () => {
      const { wrapper, actions } = mountPanel(session([], 'readyToFinish'), dirtyStatus);
      actions.commitReview.mockRejectedValue(new Error('The review agent did not create a commit.'));

      await checkbox(wrapper).setValue(true);
      await footerButtons(wrapper)[0]!.trigger('click');
      await flushPromises();
      await footerButtons(wrapper)[1]!.trigger('click');
      await flushPromises();

      expect(wrapper.get('[role="alert"]').text()).toBe('The review agent did not create a commit.');
      expect(actions.finishReview).not.toHaveBeenCalled();
      expect(actions.reviewAgain).not.toHaveBeenCalled();
      expect(footerButtons(wrapper).every((button) => button.attributes('disabled') === undefined)).toBe(true);
      expect(checkbox(wrapper).element).toHaveProperty('checked', true);
      wrapper.unmount();
    });

    it('shows progress and ignores repeated clicks while the agent is committing', async () => {
      let resolveCommit!: (value: AppSnapshot) => void;
      const { wrapper, actions } = mountPanel(session([], 'readyToFinish'), dirtyStatus);
      actions.commitReview.mockImplementation(() => new Promise<AppSnapshot>((resolve) => { resolveCommit = resolve; }));

      await checkbox(wrapper).setValue(true);
      await footerButtons(wrapper)[0]!.trigger('click');
      expect(wrapper.get('.code-review-panel__footer').text()).toContain('Committing changes');
      expect(footerButtons(wrapper).every((button) => button.attributes('disabled') !== undefined)).toBe(true);
      await footerButtons(wrapper)[0]!.trigger('click');
      expect(actions.commitReview).toHaveBeenCalledTimes(1);

      resolveCommit({} as AppSnapshot);
      await flushPromises();
      expect(actions.finishReview).toHaveBeenCalledTimes(1);
      expect(wrapper.get('.code-review-panel__footer').text()).not.toContain('Committing changes');
      wrapper.unmount();
    });

    it('lets the debug simulation reveal the commit option on a clean folder', async () => {
      const simulate = ref(false);
      const { wrapper } = mountPanel(session([], 'readyToFinish'), cleanStatus, true, undefined, {}, { [codeReviewUncommittedPreviewKey as symbol]: simulate });
      expect(checkbox(wrapper).exists()).toBe(false);
      simulate.value = true;
      await flushPromises();
      expect(checkbox(wrapper).exists()).toBe(true);
      wrapper.unmount();
    });
  });

  it('submits selected findings through one remediation action without assignment', async () => {
    const selected = finding({ decision: { state: 'selected', decidedAt: 'now' } });
    const { wrapper, actions } = mountPanel(session([selected]));
    const action = wrapper.get('.code-review-panel__footer .app-button--primary');

    expect(wrapper.find('.review-finding__assignment').exists()).toBe(false);
    expect(action.text()).toBe('Remediate selected findings');
    await action.trigger('click');
    expect(actions.submitReviewRound).toHaveBeenCalledWith('owner', 'review-1');
  });

  it('surfaces start failures in the empty state', async () => {
    const { wrapper } = mountPanel();
    await flushPromises();
    await wrapper.setProps({ startReview: vi.fn().mockRejectedValue(new Error('Reviewer unavailable.')) });

    await wrapper.findAll('button').find((button) => button.text().includes('Start review'))!.trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Reviewer unavailable.');
  });

  it.each([
    { state: 'paused', autoCommit: undefined },
    { state: 'paused', autoCommit: false },
    { state: 'paused', autoCommit: true },
    { state: 'manual', autoCommit: true },
  ] as const)('retries a $state review without changing its mode or commit choice ($autoCommit)', async ({ state, autoCommit }) => {
    const failed = session(state === 'manual' ? [finding()] : [], 'failed');
    failed.automation = { enabled: state !== 'manual', maxPriority: 'p1', maxRounds: 4, autoCommit, state, baseRef: 'a'.repeat(40), commits: [], reason: 'Paused.' };
    if (state === 'manual') failed.rounds[0]!.error = 'Review stopped. Retry to complete the inspection.';
    const { wrapper } = mountPanel(failed);
    const startReview = vi.fn(async () => ({} as AppSnapshot));
    await wrapper.setProps({ startReview });

    if (state === 'manual') {
      expect(wrapper.get('.code-review-panel__error').text()).toBe('Review stopped. Retry to complete the inspection.');
      expect(wrapper.get('.code-review-panel__findings').text()).toContain('Authorize before writing');
      expect(wrapper.find('[aria-label="Include finding in remediation"]').exists()).toBe(false);
      expect(wrapper.get('.code-review-panel__footer button').text()).toBe('Retry review');
      expect(wrapper.get('.code-review-panel__automation-status button').attributes('disabled')).toBeDefined();
    }

    await wrapper.get('.code-review-panel__footer button').trigger('click');
    await flushPromises();

    expect(startReview).toHaveBeenCalledWith('owner', {
      scope: { type: 'branch', baseRef: 'a'.repeat(40) }, threadMode: 'independent',
      automation: { enabled: state !== 'manual', maxPriority: 'p1', maxRounds: 4, autoCommit: autoCommit ?? false },
    });
  });

  it('does not send or offer review model overrides for the current thread', async () => {
    const { wrapper, actions } = mountPanel(undefined, undefined, true, {
      backend: 'codex', automation: { enabled: false, maxPriority: 'p2', maxRounds: 3 },
      providers: { codex: {backend: 'codex', serviceTier: null,  model: 'codex-model', reasoningEffort: 'high' } },
    });
    await flushPromises();
    expect(wrapper.get('.backend-model-selector').text()).toContain('Codex model');
    await wrapper.findAll('[role="radio"]').find(radio => radio.text().includes('Current thread'))!.trigger('click');
    await flushPromises();

    expect(wrapper.get('.backend-model-selector').attributes('disabled')).toBeDefined();
    await wrapper.get('.code-review-panel__start').trigger('click');
    const input = actions.startReview.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(input).toMatchObject({ threadMode: 'current' });
    expect(input).not.toHaveProperty('model');
    expect(input).not.toHaveProperty('reasoningEffort');
    expect(input).not.toHaveProperty('serviceTier');
  });

  it('offers retry when a review round fails', async () => {
    const failed = session([], 'failed');
    failed.instructions = 'Check retry safety.';
    failed.rounds[0]!.error = 'Reviewer stopped unexpectedly.';
    const { wrapper } = mountPanel(failed);
    const startReview = vi.fn(async (_agentId: string, input: unknown) => {
      structuredClone(input);
      return {} as AppSnapshot;
    });
    await wrapper.setProps({ startReview });

    expect(wrapper.get('[role="alert"]').text()).toBe('Reviewer stopped unexpectedly.');
    await wrapper.get('.code-review-panel__footer button').trigger('click');
    await flushPromises();

    expect(startReview).toHaveBeenCalledWith('owner', {
      scope: { type: 'uncommitted' },
      threadMode: 'independent',
      instructions: 'Check retry safety.',
    });
    expect(wrapper.findAll('[role="alert"]').map((alert) => alert.text())).toEqual([
      'Reviewer stopped unexpectedly.',
    ]);
  });
});
