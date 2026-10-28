import { flushPromises, mount } from '@vue/test-utils';
import { mountProvisioningHost } from './provisioning-host';
import { computed } from 'vue';
import { ElDialog, ElPopover, ElTabs, ElTabPane } from 'element-plus';
import { backendChoicesKey } from '../backend-selection';
import { backendModelCatalogKey } from '../backend-model-catalog';
import { describe, expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission, type Mission } from '@workspace/core/missions';
import type { MissionArtifactReadResult, MissionExecutionInput, MissionImplementationStartProgress, MissionRun } from '@workspace/core/mission-execution';
import type { Agent, BackendModelOption, OpenInApplicationCatalog } from '@workspace/core/contracts';
import MissionWorkspace from '../MissionWorkspace.vue';
import WorkspaceProvisioningProgressDialog from '../WorkspaceProvisioningProgressDialog.vue';
import MissionTicketBoard, { type MissionTicketComment } from '../MissionTicketBoard.vue';
import '../../styles/base.css';

function missionWithRun(status: MissionRun['status'], proposal = false): Mission {
  const snapshot = createInitialSnapshot();
  const mission = createMission(snapshot, { outcome: 'Add team billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
  const artifacts = structuredClone(mission.artifacts);
  artifacts.requirements = { problem: 'Teams need one bill', acceptance: 'An owner can pay for the team' };
  mission.execution = {
    teamId: snapshot.teams[0]!.id,
    repoPath: snapshot.agents[0]!.folder!,
    memberIds: snapshot.agents.map(agent => agent.id),
    runs: [{
      id: 'run-requirements',
      stage: 'requirements',
      memberId: snapshot.agents[0]!.id,
      workerId: snapshot.agents[0]!.id,
      status,
      skills: [{ name: 'grilling', path: '/skills/grilling/SKILL.md' }],
      feedback: '',
      startedAt: '2026-09-19T00:00:00.000Z',
      ...(proposal ? { proposal: artifacts, summary: 'Billing brief ready' } : {}),
    }],
  };
  return mission;
}

function mountWorkspace(mission: Mission, options: {
  models?: BackendModelOption[] | Partial<Record<Agent['backend'], BackendModelOption[]>>;
  agents?: Agent[];
  executeMission?: (input: MissionExecutionInput) => Promise<void>;
  readMissionArtifact?: (missionId: string, stage: MissionArtifactReadResult['stage']) => Promise<MissionArtifactReadResult>;
  sendMissionPrompt?: (prompt: string) => Promise<void>;
  openInAvailable?: boolean;
  openInApplications?: OpenInApplicationCatalog;
  implementationStartProgress?: MissionImplementationStartProgress;
} = {}) {
  return mount(MissionWorkspace, {
    global: options.models ? { components: { ElPopover, ElTabs, ElTabPane }, stubs: { ElDialog }, provide: {
      [backendChoicesKey as symbol]: computed(() => ['codex', 'claude']),
      [backendModelCatalogKey as symbol]: { listModels: vi.fn(async (_agentId: string, backend: Agent['backend']) => Array.isArray(options.models) ? options.models : options.models?.[backend] ?? []) },
    } } : undefined,
    props: {
      mission: structuredClone(mission),
      agents: structuredClone(options.agents ?? createInitialSnapshot().agents),
      executeMission: options.executeMission ?? vi.fn().mockResolvedValue(undefined),
      readMissionArtifact: options.readMissionArtifact,
      sendMissionPrompt: options.sendMissionPrompt,
      openInAvailable: options.openInAvailable,
      openInApplications: options.openInApplications,
      implementationStartProgress: options.implementationStartProgress,
    },
    slots: {
      conversation: '<div class="conversation-slot">Conversation for {{ params.agentId }}</div>',
      'code-review': '<div class="code-review-slot">Code for {{ params.agentId }}: {{ params.reviewSummary }}</div>',
      ship: '<div class="ship-slot">Repository delivery</div>',
    },
  });
}

describe('MissionWorkspace', () => {
  it('selects the implementation model in a cancellable approval dialog without changing the lead', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.stage = 'tickets';
    mission.execution!.runs[0]!.stage = 'tickets';
    mission.execution!.runs[0]!.proposal!.tickets = [{ title: 'Checkout', repositoryPath: '/repo', done: false }];
    const agents = createInitialSnapshot().agents;
    agents[0]!.backendDefaults = { kind: 'codex', model: 'planner', reasoningEffort: 'high' };
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { agents: [], executeMission, models: { codex: [
      { id: 'planner', model: 'planner', displayName: 'Planner', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }] },
      { id: 'luna', model: 'luna', displayName: 'Luna', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] },
    ], claude: [{ id: 'sonnet', model: 'sonnet', displayName: 'Sonnet', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] }] } });
    await flushPromises();
    await wrapper.setProps({ agents }); await flushPromises();
    const approve = wrapper.get('.mission-workspace__stage-header .app-button--primary');
    expect(approve.text()).toBe('Implement');
    expect(wrapper.find('[aria-label="Coding agent and model"]').exists()).toBe(false);
    await approve.trigger('click'); await flushPromises();
    expect(executeMission).not.toHaveBeenCalled();
    expect(wrapper.get('[role="dialog"][aria-label="Start implementation"]').text()).toContain('1 ticket');
    expect(wrapper.get('[role="switch"][aria-label="Allow parallel agents in the same repository"]').attributes('aria-checked')).toBe('false');
    const picker = wrapper.get('[aria-label="Coding agent and model"]');
    expect(picker.text()).toContain('Planner');
    await picker.trigger('click'); await flushPromises();
    const tabs = [...document.querySelectorAll('[role="tab"] [aria-label]')];
    expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual(['Codex', 'Claude Code']);
    const low = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent?.trim() === 'low');
    expect(low).toBeDefined();
    low!.click(); await flushPromises();
    expect(picker.text()).toContain('Luna');
    await wrapper.get('[role="switch"][aria-label="Allow parallel agents in the same repository"]').setValue(true);
    await wrapper.get('[role="dialog"] .app-button--tertiary').trigger('click'); await flushPromises();
    expect(executeMission).not.toHaveBeenCalled();
    expect(wrapper.find('[aria-label="Coding agent and model"]').exists()).toBe(false);
    await approve.trigger('click'); await flushPromises();
    const reopenedPicker = wrapper.get('[aria-label="Coding agent and model"]');
    expect(wrapper.get('[role="switch"][aria-label="Allow parallel agents in the same repository"]').attributes('aria-checked')).toBe('false');
    expect(reopenedPicker.text()).toContain('Planner');
    await reopenedPicker.trigger('click'); await flushPromises();
    document.querySelector('[role="tab"] [aria-label="Claude Code"]')!.closest<HTMLElement>('[role="tab"]')!.click();
    await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent?.trim() === 'low')!.click();
    await flushPromises();
    const confirm = wrapper.get('[role="dialog"] .app-button--primary');
    await wrapper.get('[role="switch"][aria-label="Allow parallel agents in the same repository"]').setValue(true);
    expect(wrapper.get('.mission-workspace__parallel-warning').text()).toContain('Agents share files and Git state');
    expect(confirm.text()).toBe('Start');
    await confirm.trigger('click'); await flushPromises();
    expect(executeMission).toHaveBeenCalledExactlyOnceWith({
      id: mission.id, revision: mission.revision, action: 'accept', runId: mission.execution!.runs[0]!.id,
      implementationModel: { backend: 'claude', model: 'sonnet', reasoningEffort: 'low', serviceTier: null },
      parallelImplementation: true,
    });
    expect(() => structuredClone(executeMission.mock.calls[0]![0])).not.toThrow();
    expect(wrapper.props('agents')![0]!.backendDefaults).toMatchObject({ model: 'planner', reasoningEffort: 'high' });
    expect(wrapper.find('[aria-label="Coding agent and model"]').exists()).toBe(false);
    await wrapper.setProps({ mission: { ...mission, stage: 'review' } });
    expect(wrapper.find('[aria-label="Coding agent and model"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('starts implementation on the chosen service tier, prefilled from the lead while the model still offers it', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.execution!.parallelImplementation = true;
    mission.stage = 'tickets';
    mission.execution!.runs[0]!.stage = 'tickets';
    mission.execution!.runs[0]!.proposal!.tickets = [{ title: 'Checkout', repositoryPath: '/repo', done: false }];
    const agents = createInitialSnapshot().agents;
    agents[0]!.backendDefaults = { kind: 'codex', model: 'planner', reasoningEffort: 'high', serviceTier: 'fast' };
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const tiers = [{ id: 'fast', name: 'Fast', description: '' }, { id: 'ultrafast', name: 'Ultrafast', description: '' }];
    const wrapper = mountWorkspace(mission, { agents: [], executeMission, models: { codex: [
      { id: 'planner', model: 'planner', displayName: 'Planner', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }], serviceTiers: tiers },
      { id: 'luna', model: 'luna', displayName: 'Luna', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }] },
    ] } });
    await flushPromises();
    await wrapper.setProps({ agents }); await flushPromises();
    await wrapper.get('.mission-workspace__stage-header .app-button--primary').trigger('click'); await flushPromises();
    const parallel = wrapper.get('[role="switch"][aria-label="Allow parallel agents in the same repository"]');
    expect(parallel.attributes('aria-checked')).toBe('true');
    await parallel.setValue(false);
    const picker = wrapper.get('[aria-label="Coding agent and model"]');
    expect(picker.text()).toContain('fast');
    await picker.trigger('click'); await flushPromises();
    [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(item => item.textContent?.trim() === 'ultrafast')!.click();
    await flushPromises();
    await wrapper.get('[role="dialog"] .app-button--primary').trigger('click'); await flushPromises();
    expect(executeMission).toHaveBeenCalledExactlyOnceWith({
      id: mission.id, revision: mission.revision, action: 'accept', runId: mission.execution!.runs[0]!.id,
      implementationModel: { backend: 'codex', model: 'planner', reasoningEffort: 'high', serviceTier: 'ultrafast' },
      parallelImplementation: false,
    });
    wrapper.unmount();
  });

  it('waits for the user to move completed Implementation into Review', async () => {
    const mission = missionWithRun('accepted', true);
    mission.stage = 'implementation';
    mission.artifacts.tickets = [{ title: 'Checkout', repositoryPath: '/src/billing-service', done: true }];
    mission.artifacts.implementation = { changes: 'Checkout implemented.', tests: 'Tests pass.' };
    mission.execution!.runs = [{
      id: 'implementation-run', stage: 'implementation', memberId: 'agent-dina', workerId: 'agent-dina',
      ticketIndex: 0, repositoryPath: '/src/billing-service', status: 'accepted', skills: [], feedback: '', startedAt: 'now',
    }];
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { executeMission });

    const continueButton = wrapper.get('.mission-workspace__stage-header .app-button');
    expect(continueButton.text()).toContain('Continue to Review');
    const agents = createInitialSnapshot().agents;
    agents.find(agent => agent.id === 'agent-dina')!.status = { type: 'working' };
    await wrapper.setProps({ agents });
    expect(wrapper.find('.mission-workspace__stage-header .app-button').exists()).toBe(false);
    agents.find(agent => agent.id === 'agent-dina')!.status = { type: 'idle' };
    await wrapper.setProps({ agents: structuredClone(agents) });
    expect(executeMission).not.toHaveBeenCalled();
    await wrapper.get('.mission-workspace__stage-header .app-button').trigger('click');
    await flushPromises();
    expect(executeMission).toHaveBeenCalledExactlyOnceWith({
      id: mission.id, revision: mission.revision, action: 'continueToReview',
    });

    mission.artifacts.tickets[0]!.done = false;
    await wrapper.setProps({ mission: structuredClone(mission) });
    expect(wrapper.find('.mission-workspace__stage-header .app-button').exists()).toBe(false);
  });

  it('keeps Review approval available when selected findings remain unresolved', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.stage = 'review';
    mission.execution!.runs[0]!.stage = 'review';
    mission.execution!.runs[0]!.proposal!.review.summary = 'Reviewed';
    mission.artifacts.review.findings = [{
      id: 'finding-1', priority: 'p1', title: 'Fix persistence', body: 'Selection is lost.', repositoryPath: '/repo', selected: false,
      remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
    }];
    const wrapper = mountWorkspace(mission);
    expect(wrapper.findAll('button').find(button => button.text().includes('Approve and continue'))!.attributes('disabled')).toBeUndefined();

    mission.artifacts.review.findings[0]!.selected = true;
    mission.execution!.debugFixture = true;
    await wrapper.setProps({ mission: structuredClone(mission) });
    expect(wrapper.findAll('button').find(button => button.text().includes('Approve and continue'))!.attributes('disabled')).toBeUndefined();
  });

  it('frames a running mission as a five-stage process with the orchestrator conversation always present', async () => {
    const mission = missionWithRun('running');
    const wrapper = mountWorkspace(mission);
    await flushPromises();

    expect(wrapper.get('.mission-workspace__identity').text()).toBe(mission.outcome);
    expect(getComputedStyle(wrapper.get('.mission-workspace__header').element).boxShadow).toBe('var(--shadow-content-edge)');
    expect(getComputedStyle(wrapper.get('.mission-workspace__body').element).boxShadow).toBe('var(--shadow-content-edge)');
    expect(wrapper.get('[aria-label="Workflow progress"]').findAll('button')).toHaveLength(5);
    expect(wrapper.get('[aria-current="step"]').text()).toContain('Requirements');
    expect(wrapper.get('.mission-workspace__run-status').text()).toBe('Shaping requirements');
    expect(wrapper.get('.mission-workspace__run-status').attributes()).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
    });
    expect(wrapper.find('.mission-workspace__working').exists()).toBe(false);
    expect(wrapper.find('.mission-workspace__empty-artifact').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('grilling');
    expect(wrapper.get('.conversation-slot').text()).toContain(mission.execution!.runs[0]!.workerId);
    expect(wrapper.emitted('open-conversation')).toStrictEqual([[mission.execution!.runs[0]!.workerId]]);
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find('select').exists()).toBe(false);
    const stageHeader = wrapper.get('.mission-workspace__stage-header');
    const conversationHeader = wrapper.get('.mission-conversation-rail__navigation > header');
    expect(getComputedStyle(stageHeader.element).minHeight).not.toBe('');
    expect(getComputedStyle(stageHeader.element).minHeight).toBe(getComputedStyle(conversationHeader.element).minHeight);
    expect(getComputedStyle(wrapper.get('.mission-stage-rail__heading').element).minHeight).toBe(getComputedStyle(stageHeader.element).minHeight);
    const scrollingContent = wrapper.get('.mission-workspace__workbench-scroll');
    expect(scrollingContent.element.contains(stageHeader.element)).toBe(false);

    await wrapper.setProps({ sidebarCollapsed: true });
    const sidebarButton = wrapper.get('button[aria-label="Show agent sidebar"]');
    expect(sidebarButton.text()).toBe('');
    expect(sidebarButton.find('svg').exists()).toBe(true);
    await sidebarButton.trigger('click');
    expect(wrapper.emitted('expand-sidebar')).toStrictEqual([[]]);
    await wrapper.setProps({ sidebarCollapsed: false });
    expect(wrapper.find('button[aria-label="Show agent sidebar"]').exists()).toBe(false);
  });

  it('keeps the proposal beside its conversation and carries the accepted artifact into the next stage', async () => {
    const mission = missionWithRun('awaitingReview', true);
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { executeMission });

    expect(wrapper.get('[aria-label="Artifact ready for review"]').text()).toContain('Teams need one bill');
    const stageHeader = wrapper.get('.mission-workspace__stage-header');
    expect(stageHeader.get('h2').text()).toBe('Mission brief');
    expect(stageHeader.text()).not.toContain('Define the outcome');
    expect(stageHeader.find('.mission-workspace__review-status').exists()).toBe(false);
    expect(stageHeader.find('.app-button').exists()).toBe(false);
    expect(wrapper.get('.plan-review-footer .app-button--primary').text()).toBe('Approve');
    expect(wrapper.find('.mission-workspace__artifact-toolbar').exists()).toBe(false);
    expect(wrapper.get('.plan-review-panel').text()).toContain('Teams need one bill');
    expect(wrapper.find('.conversation-slot').exists()).toBe(true);

    await wrapper.get('.plan-review-footer .app-button--primary').trigger('click');
    await flushPromises();

    expect(executeMission).toHaveBeenNthCalledWith(1, {
      id: mission.id,
      revision: mission.revision,
      action: 'accept',
      runId: 'run-requirements',
    });
    expect(executeMission).toHaveBeenCalledOnce();
  });

  it('shows button and worktree progress while approved tickets start Implementation', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.stage = 'tickets';
    mission.execution!.runs[0]!.stage = 'tickets';
    mission.execution!.runs[0]!.proposal!.tickets = [
      { title: 'Build API', repositoryPath: '/src/billing-api', done: false },
      { title: 'Build web', repositoryPath: '/src/billing-web', done: false },
    ];
    let finish!: () => void;
    const executeMission = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const wrapper = mountWorkspace(mission, {
      executeMission,
      models: [{ id: 'luna', model: 'luna', displayName: 'Luna', isDefault: true }],
      implementationStartProgress: {
        missionId: mission.id,
        phase: 'initializingWorkspaces',
        repositoryCount: 2,
        ticketCount: 2,
      },
    });
    const continueButton = wrapper.get('.mission-workspace__stage-header .app-button');

    await continueButton.trigger('click');
    await flushPromises();
    expect(executeMission).not.toHaveBeenCalled();
    await wrapper.get('[role="dialog"] .app-button--primary').trigger('click');

    expect(continueButton.attributes('aria-busy')).toBe('true');
    const host = mountProvisioningHost();
    const progress = host.getComponent(WorkspaceProvisioningProgressDialog);
    expect(progress.text()).toContain('Preparing worktrees');
    expect(progress.text()).toContain('2 repositories');
    expect(progress.text()).toContain('billing-api, billing-web');
    expect(progress.text()).toContain('2 tickets');
    expect(progress.props('operation')).toMatchObject({ mode: 'multiple', phase: 'initializingWorkspaces' });

    finish();
    await flushPromises();

    expect(host.getComponent(WorkspaceProvisioningProgressDialog).props('operation')).toBeNull();
    wrapper.unmount();
  });

  it('keeps the selected model available for retry when starting Implementation fails', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.stage = 'tickets';
    mission.execution!.runs[0]!.stage = 'tickets';
    mission.execution!.runs[0]!.proposal!.tickets = [{ title: 'Checkout', done: false }];
    const executeMission = vi.fn().mockRejectedValueOnce(new Error('Worktree initialization failed')).mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { executeMission, models: [{ id: 'luna', model: 'luna', displayName: 'Luna', isDefault: true }] });
    await wrapper.get('.mission-workspace__stage-header .app-button--primary').trigger('click'); await flushPromises();
    await wrapper.get('[role="dialog"] .app-button--primary').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toBe('Worktree initialization failed');
    expect(wrapper.get('[aria-label="Coding agent and model"]').text()).toContain('Luna');
    await wrapper.get('[role="dialog"] .app-button--primary').trigger('click'); await flushPromises();
    expect(executeMission).toHaveBeenCalledTimes(2);
    expect(executeMission.mock.calls[1]![0]).toStrictEqual(executeMission.mock.calls[0]![0]);
    expect(wrapper.find('[aria-label="Coding agent and model"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('reviews requirement choices and diagrams through the shared plan editor and sends confirmed feedback without approving', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.execution!.runs[0]!.proposal!.requirements.problem = '# Payment roles\n\n- [x] Owner\n- [ ] Member\n\n## Billing flow\n\n```mermaid\nflowchart LR\n Owner --> Checkout\n```';
    const sendMissionPrompt = vi.fn().mockRejectedValueOnce(new Error('Delivery failed')).mockResolvedValue(undefined);
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { sendMissionPrompt, executeMission });
    try {
      expect(wrapper.get('figure img').attributes('alt')).toContain('Billing flow');
      await wrapper.findAll('.plan-choice-option input')[1]!.setValue(true);
      await wrapper.get('.plan-review-footer .app-button--primary').trigger('click');
      expect(wrapper.get('[role="dialog"]').text()).toContain('Approve the requirements and continue to Tickets anyway?');
      await wrapper.get('[role="dialog"] .app-button--tertiary').trigger('click');
      await wrapper.get('[role="switch"]').setValue(true);
      await wrapper.get('button[aria-label^="Comment on diagram"]').trigger('click');
      await wrapper.get('textarea').setValue('Include the cancellation path.');
      const revise = wrapper.get('.plan-review-footer .app-button--secondary');
      await revise.trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Delivery failed');
      expect(wrapper.get('textarea').element.value).toBe('Include the cancellation path.');
      await revise.trigger('click');
      await flushPromises();
      expect(sendMissionPrompt).toHaveBeenCalledTimes(2);
      const feedback = sendMissionPrompt.mock.calls[1]![0];
      expect(feedback).toContain('Include the cancellation path.');
      expect(feedback).toContain('flowchart LR');
      expect(feedback).toContain('"selected": [\n        "Owner",\n        "Member"\n      ]');
      expect(executeMission).not.toHaveBeenCalled();
      expect(revise.attributes('disabled')).toBeDefined();
    } finally { wrapper.unmount(); }
  });

  it('allows debug requirements feedback and decisions locally, and resets them when the fixture is reapplied', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.execution!.debugFixture = true;
    mission.execution!.runs[0]!.proposal!.requirements.problem = '# Payment roles\n\n- [x] Owner\n- [ ] Member';
    const sendMissionPrompt = vi.fn().mockResolvedValue(undefined);
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { sendMissionPrompt, executeMission });
    try {
      const choices = wrapper.findAll('.plan-choice-option input');
      expect(choices[1]!.attributes('disabled')).toBeUndefined();
      await choices[1]!.setValue(true);
      await wrapper.get('[role="switch"]').setValue(true);
      await wrapper.get('button[aria-label="Comment on this section: Payment roles"]').trigger('click');
      await wrapper.get('textarea').setValue('Allow a delegated billing owner.');
      await wrapper.get('.plan-review-footer .app-button--secondary').trigger('click');
      await flushPromises();
      expect(wrapper.get('textarea').element.value).toBe('Allow a delegated billing owner.');
      expect(wrapper.get('.plan-review-footer .app-button--primary').attributes('disabled')).toBeDefined();
      expect(sendMissionPrompt).not.toHaveBeenCalled();
      expect(executeMission).not.toHaveBeenCalled();

      mission.execution!.runs[0]!.startedAt = '2026-09-19T00:01:00.000Z';
      await wrapper.setProps({ mission: structuredClone(mission) });
      expect(wrapper.get('.plan-choice-option input').attributes('disabled')).toBeUndefined();
      expect(wrapper.find('textarea').exists()).toBe(false);
      await wrapper.get('.plan-review-footer .app-button--primary').trigger('click');
      await wrapper.get('[role="dialog"] .app-button--primary').trigger('click');
      await flushPromises();
      expect(executeMission).not.toHaveBeenCalled();
      expect(sendMissionPrompt).not.toHaveBeenCalled();
    } finally { wrapper.unmount(); }
  });

  it('does not synthesize follow-up revisions when the accepted snapshot arrives during approval', async () => {
    const mission = missionWithRun('awaitingReview', true);
    const initialRevision = mission.revision;
    let wrapper!: ReturnType<typeof mountWorkspace>;
    const executeMission = vi.fn(async (input: MissionExecutionInput) => {
      if (input.action !== 'accept') return;
      mission.revision = initialRevision + 1;
      mission.execution!.runs[0]!.status = 'accepted';
      await wrapper.setProps({ mission: structuredClone(mission) });
    });
    wrapper = mountWorkspace(mission, { executeMission });

    await wrapper.get('.plan-review-footer .app-button--primary').trigger('click');
    await flushPromises();

    expect(executeMission).toHaveBeenCalledExactlyOnceWith({
      id: mission.id,
      revision: initialRevision,
      action: 'accept',
      runId: 'run-requirements',
    });
  });

  it('groups sequential ticket work under its repository conversation', async () => {
    const snapshot = createInitialSnapshot();
    const mission = missionWithRun('accepted', true);
    mission.stage = 'implementation';
    mission.artifacts.tickets = [
      { title: 'Provider contracts', repositoryPath: '/src/billing-service', done: true },
      { title: 'OAuth connection', repositoryPath: '/src/billing-service', done: false },
    ];
    mission.execution!.runs.push(
      {
        id: 'run-ticket-1', stage: 'implementation', memberId: snapshot.agents[1]!.id,
        workerId: snapshot.agents[1]!.id, ticketIndex: 0, repositoryPath: '/src/billing-service',
        status: 'accepted', skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z',
      },
      {
        id: 'run-ticket-2', stage: 'implementation', memberId: snapshot.agents[1]!.id,
        workerId: snapshot.agents[1]!.id, ticketIndex: 1, repositoryPath: '/src/billing-service',
        status: 'running', skills: [], feedback: '', startedAt: '2026-09-19T00:02:00.000Z',
      },
    );
    const worktreePath = '/src/billing-service-mission';
    snapshot.agents[1]!.folder = worktreePath;
    snapshot.agents[1]!.openInApplication = 'vscode';
    mission.execution!.workspaces = [{
      repositoryPath: '/src/billing-service',
      path: worktreePath,
      branch: 'mission/add-billing',
    }];
    const wrapper = mountWorkspace(mission, {
      agents: snapshot.agents,
      openInAvailable: true,
      openInApplications: {
        defaultApplication: 'finder',
        applications: [{ id: 'vscode', label: 'VS Code' }, { id: 'finder', label: 'Finder' }],
      },
    });
    await flushPromises();

    const implementationLane = wrapper.get('.mission-implementation__lane');
    expect(getComputedStyle(implementationLane.element)).toMatchObject({ width: '100%', maxWidth: 'none' });
    expect(getComputedStyle(implementationLane.get('.mission-implementation__ticket-item').element).maxWidth).toBe('320px');
    expect(getComputedStyle(implementationLane.get('.mission-implementation__ticket').element).height).toBe('196px');
    expect(implementationLane.get('header').text()).toContain('mission/add-billing');
    await implementationLane.get('[aria-label="Open in VS Code"]').trigger('click');
    expect(wrapper.emitted('open-worktree')).toStrictEqual([[
      { agentId: snapshot.agents[1]!.id, application: 'vscode', path: worktreePath },
    ]]);

    const conversations = wrapper.get('[aria-label="Mission conversations"]');
    const tabs = conversations.findAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs.map(tab => tab.attributes('aria-label'))).toStrictEqual(['Mission lead', 'billing-service']);
    expect(tabs.map(tab => tab.text())).toStrictEqual(['Mission lead', 'billing-service']);
    expect(tabs[1]!.attributes('aria-selected')).toBe('true');
    expect(wrapper.get('[aria-label="Stage conversation"]').get('header').text()).toContain('billing-serviceBuilderOAuth connection');
    expect(wrapper.get('.conversation-slot').text()).toContain(snapshot.agents[1]!.id);

    await tabs[0]!.trigger('click');

    expect(tabs[0]!.attributes('aria-selected')).toBe('true');
    expect(wrapper.get('.conversation-slot').text()).toContain(snapshot.agents[0]!.id);
    expect(wrapper.emitted('open-conversation')?.at(-1)).toStrictEqual([snapshot.agents[0]!.id]);
  });

  it('keeps accepted artifacts available while work moves through later stages', async () => {
    const mission = missionWithRun('accepted', true);
    mission.artifacts = structuredClone(mission.execution!.runs[0]!.proposal!);
    mission.stage = 'tickets';
    mission.execution!.runs.push({
      id: 'run-tickets', stage: 'tickets', memberId: 'agent-dina', workerId: 'agent-dina', status: 'running',
      skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z',
    });
    const wrapper = mountWorkspace(mission);

    const [requirements, tickets, implementation] = wrapper.get('[aria-label="Workflow progress"]').findAll('button');
    expect(tickets!.attributes('aria-current')).toBe('step');
    expect(implementation!.attributes('disabled')).toBeDefined();
    await requirements!.trigger('click');

    expect(wrapper.get('[aria-label="Accepted artifact"]').text()).toContain('Teams need one bill');
    expect(wrapper.get('.mission-workspace__stage-header h2').text()).toBe('Mission brief');
    expect(wrapper.get('.mission-workspace__accepted-status').text()).toBe('Accepted');
    expect(wrapper.get('[aria-label="Stage conversation"]').get('header').text()).toContain('Mission lead');
  });

  it('shows ticket drafts as the orchestrator creates them without waiting for stage review', async () => {
    const mission = missionWithRun('accepted', true);
    mission.artifacts = structuredClone(mission.execution!.runs[0]!.proposal!);
    mission.stage = 'tickets';
    mission.execution!.runs.push({
      id: 'run-tickets', stage: 'tickets', memberId: 'agent-dina', workerId: 'agent-dina', status: 'running',
      skills: [{ name: 'to-tickets', path: '/skills/to-tickets/SKILL.md' }], feedback: '', startedAt: '2026-09-19T00:01:00.000Z',
      draftTickets: [
        { id: 'mission-ticket-foundation', title: 'Create billing account', body: 'Deliver the account with integration coverage.', done: false },
        { id: 'mission-ticket-checkout', title: 'Add owner checkout', body: 'Let an owner buy seats.', done: false, dependsOn: [0] },
      ],
    });
    const sendMissionPrompt = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { sendMissionPrompt });

    const drafts = wrapper.get('[aria-label="Draft tickets"]');
    expect(wrapper.get('.mission-workspace__stage-header h2').text()).toBe('Implementation backlog');
    expect(wrapper.get('.mission-workspace__stage-heading > span').text()).toBe('2 drafts');
    expect(wrapper.find('.mission-workspace__artifact-toolbar').exists()).toBe(false);
    const ticketCards = drafts.findAll('.mission-ticket-board__card');
    expect(ticketCards).toHaveLength(2);
    expect(ticketCards[0]!.text()).toContain('Create billing account');
    expect(ticketCards[0]!.text()).toContain('Deliver the account with integration coverage.');
    expect(ticketCards[1]!.text()).toContain('After 01');
    expect(wrapper.get('.mission-workspace__run-status').text()).toBe('Shaping tickets');

    await ticketCards[1]!.trigger('click');
    await flushPromises();

    expect(wrapper.findComponent({ name: 'ElDialog' }).props('modelValue')).toBe(true);
    expect(wrapper.findComponent({ name: 'ElDialog' }).text()).toContain('Let an owner buy seats.');
    expect(wrapper.text()).not.toContain('to-tickets');
    expect(wrapper.find('[aria-label="Artifact ready for review"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Mission conversations"]').exists()).toBe(false);

    wrapper.findComponent(MissionTicketBoard).vm.$emit('sendComments', [
      {
        id: 'comment-1', ticketKey: 'mission-ticket-foundation', ticketNumber: '01',
        ticketTitle: 'Create billing account', quote: 'integration coverage', body: 'Name the integration boundary.',
      },
      {
        id: 'comment-2', ticketKey: 'mission-ticket-checkout', ticketNumber: '02',
        ticketTitle: 'Add owner checkout', quote: 'buy seats', body: 'Include the cancellation path.',
      },
    ] satisfies MissionTicketComment[]);
    await flushPromises();

    expect(sendMissionPrompt).toHaveBeenCalledOnce();
    expect(sendMissionPrompt.mock.calls[0]![0]).toContain('Ticket 01 — Create billing account');
    expect(sendMissionPrompt.mock.calls[0]![0]).toContain('Ticket 02 — Add owner checkout');
    expect(sendMissionPrompt.mock.calls[0]![0]).toContain('Include the cancellation path.');
    wrapper.unmount();
  });

  it('renders the canonical persisted artifact instead of the structured handoff projection', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.artifactFiles = {
      requirements: { revision: 1, size: 47, updatedAt: '2026-09-19T00:02:00.000Z' },
    };
    const readMissionArtifact = vi.fn().mockResolvedValue({
      stage: 'requirements',
      content: '# Canonical billing brief\n\nReviewed with the user.',
      revision: 1,
      updatedAt: '2026-09-19T00:02:00.000Z',
    });

    const wrapper = mountWorkspace(mission, { readMissionArtifact });
    await flushPromises();

    expect(readMissionArtifact).toHaveBeenCalledExactlyOnceWith(mission.id, 'requirements');
    expect(wrapper.get('[aria-label="Artifact ready for review"]').text()).toContain('Canonical billing brief');
    expect(wrapper.get('[aria-label="Artifact ready for review"]').text()).not.toContain('Teams need one bill');
  });

  it('approves review before entering Ship', async () => {
    const mission = missionWithRun('accepted', true);
    mission.stage = 'review';
    mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
    mission.artifacts.tickets = [{ title: 'Implement billing', done: true }];
    mission.artifacts.implementation = { changes: 'billing.ts', tests: 'billing test passes' };
    const proposal = structuredClone(mission.artifacts);
    proposal.review = { summary: 'Ready to ship', pullRequestUrl: '' };
    mission.execution!.runs = [{
      id: 'run-review', stage: 'review', memberId: 'agent-dina', workerId: 'agent-dina', status: 'awaitingReview',
      skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z', proposal, summary: 'Review complete',
    }];
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { executeMission });

    await wrapper.get('.mission-workspace__stage-header .app-button').trigger('click');
    await flushPromises();

    expect(executeMission).toHaveBeenCalledTimes(1);
  });

  it('shows affected repository lanes, switches to a ticket agent, and opens accepted evidence', async () => {
    const mission = missionWithRun('accepted', true);
    mission.stage = 'implementation';
    mission.artifacts.requirements = { problem: 'Billing', acceptance: 'Owner pays' };
    mission.artifacts.tickets = [
      { title: 'Checkout', body: 'Implement checkout end to end.', repositoryPath: '/src/billing-service', done: true },
      { title: 'Invoice', body: 'Render the paid invoice.', repositoryPath: '/src/invoice-app', done: false },
    ];
    mission.execution!.workspaces = [
      { repositoryPath: '/src/billing-service', path: '/src/billing-service-add-team-billing', branch: 'mission/add-team-billing' },
      { repositoryPath: '/src/invoice-app', path: '/src/invoice-app-add-team-billing', branch: 'mission/add-team-billing' },
    ];
    mission.execution!.runs = [
      {
        id: 'run-checkout', stage: 'implementation', memberId: 'agent-dina', workerId: 'agent-dina', ticketIndex: 0,
        repositoryPath: '/src/billing-service', status: 'accepted', skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z',
        implementationResult: { changes: 'checkout.ts now completes payment.', tests: 'checkout integration test passes' },
      },
      {
        id: 'run-invoice', stage: 'implementation', memberId: 'agent-jesse', workerId: 'agent-jesse', ticketIndex: 1,
        repositoryPath: '/src/invoice-app', status: 'running', skills: [], feedback: '', startedAt: '2026-09-19T00:01:01.000Z',
      },
    ];
    const wrapper = mountWorkspace(mission);

    const board = wrapper.get('[aria-label="Implementation by repository"]');
    expect(board.text()).toContain('2 affected repositories');
    expect(board.get('.mission-implementation__summary').text()).not.toContain('mission/add-team-billing');
    expect(board.find('[aria-label="View implementation evidence"]').exists()).toBe(false);
    expect(board.findAll('.mission-implementation__workspace').map(workspace => workspace.text())).toStrictEqual([
      'mission/add-team-billing',
      'mission/add-team-billing',
    ]);
    expect(getComputedStyle(board.get('.mission-implementation__workspace').element).alignSelf).toBe('center');
    expect(board.text()).toContain('billing-service');
    expect(board.text()).toContain('invoice-app');
    expect(board.text()).toContain('Done');
    expect(board.text()).toContain('Building');
    expect(board.get('[aria-label="Execution status"]').text()).toContain('1 active');
    expect(board.get('[aria-label="Execution status"]').text()).toContain('1 complete');
    expect(board.get('[role="progressbar"]').attributes()).toMatchObject({
      'aria-valuemax': '2',
      'aria-valuenow': '1',
    });
    expect(board.findAll('.mission-implementation__agent').map(agent => agent.text())).toStrictEqual(['Builder', 'Builder']);
    expect(board.findAll('.mission-implementation__ticket-details')[0]!.attributes('aria-label')).toBe('View evidence for Checkout');

    await board.findAll('.mission-implementation__ticket')[0]!.trigger('click');
    expect(wrapper.get('.conversation-slot').text()).toContain('agent-dina');
    expect(wrapper.get('[aria-label="Stage conversation"]').get('h2').text()).toBe('billing-service');
    expect(wrapper.get('[aria-label="Stage conversation"]').get('header p').text()).toBe('BuilderCheckout');
    expect(wrapper.findComponent({ name: 'ElDialog' }).props('modelValue')).toBe(false);

    await board.findAll('.mission-implementation__ticket-details')[0]!.trigger('click');
    await flushPromises();

    const ticketDialog = wrapper.findComponent({ name: 'ElDialog' });
    expect(ticketDialog.props('modelValue')).toBe(true);
    expect(ticketDialog.text()).toContain('Implement checkout end to end.');
    expect(ticketDialog.text()).toContain('checkout integration test passes');

    expect(wrapper.find('.mission-implementation__dialog-footer .app-button').exists()).toBe(false);
  });

  it('keeps failed and running implementation tickets recoverable from their repository lane', async () => {
    const mission = missionWithRun('accepted', true);
    mission.stage = 'implementation';
    mission.artifacts.tickets = [{ title: 'Checkout', repositoryPath: '/src/billing-service', done: false }];
    mission.execution!.workspaces = [{ repositoryPath: '/src/billing-service', path: '/src/billing-service-checkout', branch: 'mission/checkout' }];
    mission.execution!.runs = [{
      id: 'run-checkout', stage: 'implementation', memberId: 'agent-dina', workerId: 'agent-dina', ticketIndex: 0,
      repositoryPath: '/src/billing-service', status: 'failed', skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z', error: 'Tests failed',
    }];
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { executeMission });

    await wrapper.get('.mission-implementation__ticket-details').trigger('click');
    await flushPromises();
    expect(wrapper.get('.mission-implementation__ticket').text()).toContain('Failed');
    await wrapper.get('.mission-implementation__dialog-footer .app-button').trigger('click');
    expect(executeMission).toHaveBeenLastCalledWith({
      id: mission.id, revision: mission.revision, action: 'run', ticketIndex: 0,
    });

    mission.revision++;
    mission.execution!.runs[0]!.status = 'running';
    await wrapper.setProps({ mission: structuredClone(mission) });
    expect(wrapper.get('.mission-implementation__ticket').text()).toContain('Building');
    expect(wrapper.get('.mission-implementation__ticket-details').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.mission-workspace__run-status').text()).toBe('Building tickets');
    expect(wrapper.find('.mission-workspace__run-status button').exists()).toBe(false);
    await wrapper.get('.mission-implementation__dialog-footer .app-button').trigger('click');
    expect(executeMission).toHaveBeenLastCalledWith({
      id: mission.id, revision: mission.revision, action: 'cancel', runId: 'run-checkout',
    });
  });

  it('keeps simulated implementation fixtures visual and non-interactive', async () => {
    const mission = missionWithRun('accepted', true);
    mission.stage = 'implementation';
    mission.execution!.debugFixture = true;
    mission.artifacts.tickets = [{ title: 'Execution board', repositoryPath: '/src/agent-workspace', done: false }];
    mission.execution!.workspaces = [{ repositoryPath: '/src/agent-workspace', path: '/src/agent-workspace', branch: 'mission/debug' }];
    mission.execution!.runs = [{
      id: 'run-debug', stage: 'implementation', memberId: 'agent-dina', workerId: 'agent-dina', ticketIndex: 0,
      repositoryPath: '/src/agent-workspace', status: 'awaitingReview', skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z',
      implementationResult: { changes: 'Rendered the execution board.', tests: 'Component behavior passes.' },
    }];
    const wrapper = mountWorkspace(mission);

    await wrapper.get('.mission-implementation__ticket-details').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent({ name: 'ElDialog' }).text()).toContain('Rendered the execution board.');
    expect(wrapper.find('.mission-implementation__dialog-footer .app-button').exists()).toBe(false);
    expect(wrapper.find('.code-review-slot').exists()).toBe(false);
  });

  it('can retry a retained failed stage', async () => {
    const mission = missionWithRun('running');
    const executeMission = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountWorkspace(mission, { executeMission });

    mission.execution!.runs[0]!.status = 'failed';
    mission.execution!.runs[0]!.error = 'Provider offline';
    await wrapper.setProps({ mission: structuredClone(mission) });
    await wrapper.get('.mission-workspace__empty-artifact .app-button').trigger('click');
    expect(executeMission).toHaveBeenLastCalledWith({ id: mission.id, revision: mission.revision, action: 'run' });
  });

  it('keeps restart failures visible beside the mission stage', async () => {
    const mission = missionWithRun('running');
    const executeMission = vi.fn().mockRejectedValueOnce('Could not restart the worker');
    const wrapper = mountWorkspace(mission, { executeMission });

    mission.execution!.runs[0]!.status = 'failed';
    await wrapper.setProps({ mission: structuredClone(mission) });
    await wrapper.get('.mission-workspace__empty-artifact .app-button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Could not restart the worker');
  });

  it('renders accepted ticket, implementation, and review artifacts as the mission advances', async () => {
    const mission = missionWithRun('accepted', true);
    mission.artifacts = structuredClone(mission.execution!.runs[0]!.proposal!);
    mission.artifacts.tickets = [
      { title: 'Create billing foundation', done: true, reference: 'https://example.com/tickets/1' },
      { title: 'Add team checkout', done: true, dependsOn: [0] },
    ];
    mission.artifacts.implementation = { changes: 'billing.ts changed', tests: 'billing integration passes' };
    mission.artifacts.review = { summary: 'Acceptance verified', pullRequestUrl: 'https://example.com/pull/2' };
    mission.execution!.runs = [{
      id: 'run-implementation', stage: 'implementation', memberId: 'agent-dina', workerId: 'agent-dina', ticketIndex: 0,
      repositoryPath: '/src/billing-service', status: 'accepted', skills: [], feedback: '', startedAt: '2026-09-19T00:01:00.000Z',
      implementationResult: { changes: 'billing.ts changed', tests: 'billing integration passes' },
    }];
    const wrapper = mountWorkspace(mission);

    mission.stage = 'tickets';
    await wrapper.setProps({ mission: structuredClone(mission) });
    const acceptedTickets = wrapper.get('[aria-label="Accepted artifact"]');
    expect(acceptedTickets.findAll('.mission-ticket-board__card')).toHaveLength(2);
    await acceptedTickets.findAll('.mission-ticket-board__card')[0]!.trigger('click');
    expect(acceptedTickets.get('[aria-label="Ticket details"]').text()).toContain('Open canonical ticket');
    await acceptedTickets.findAll('.mission-ticket-board__card')[1]!.trigger('click');
    expect(acceptedTickets.get('[aria-label="Ticket details"]').text()).toContain('Blocked by tickets: 01');

    mission.stage = 'implementation';
    await wrapper.setProps({ mission: structuredClone(mission) });
    expect(wrapper.find('[aria-label="Accepted artifact"]').exists()).toBe(false);
    await wrapper.get('[aria-label="View evidence for Create billing foundation"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents({ name: 'ElDialog' })[0]!.text()).toContain('billing integration passes');
    expect(wrapper.find('.code-review-slot').exists()).toBe(false);

    mission.stage = 'review';
    mission.status = 'completed';
    await wrapper.setProps({ mission: structuredClone(mission) });
    expect(wrapper.find('[aria-label="Accepted artifact"]').exists()).toBe(false);
    expect(wrapper.get('.code-review-slot').text()).toContain('agent-dina');
    expect(wrapper.get('.code-review-slot').text()).toContain('Acceptance verified');
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100');
  });

  it('renders the real review surface slot for debug Mission fixtures', async () => {
    const mission = missionWithRun('awaitingReview', true);
    mission.stage = 'review';
    mission.execution!.debugFixture = true;
    mission.execution!.runs[0]!.stage = 'review';
    mission.execution!.runs[0]!.proposal!.review.summary = 'Debug review summary';
    mission.artifacts.review.findings = [{
      id: 'finding-debug', priority: 'p1', title: 'Debug finding', body: 'Use the composed review surface.', repositoryPath: '/repo', selected: true,
      remediation: { state: 'open' }, createdAt: 'now', updatedAt: 'now',
    }];

    const wrapper = mountWorkspace(mission);

    expect(wrapper.get('.code-review-slot').text()).toContain('Debug review summary');
    expect(wrapper.findComponent({ name: 'MissionReviewFindings' }).exists()).toBe(false);
  });

  it('shows orchestration failures without replacing the process', async () => {
    const mission = missionWithRun('awaitingReview', true);
    const wrapper = mountWorkspace(mission, { executeMission: vi.fn().mockRejectedValue(new Error('Worker unavailable')) });

    await wrapper.get('.plan-review-footer .app-button--primary').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Worker unavailable');
    expect(wrapper.get('[aria-label="Workflow progress"]').findAll('button')).toHaveLength(5);
    expect(wrapper.find('.conversation-slot').exists()).toBe(true);
  });
});
