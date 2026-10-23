import { workProviderDefinition } from '@workspace/core/work-providers';
import { agentDisplayName } from '@workspace/core/agent-display';
import type {
  Agent,
  AgentGitBranchInput,
  ReasoningEffort,
  AppSnapshot,
  CreateAgentInput,
  CreateSourceWorktreeInput,
  DuplicateAgentOptions,
  SourceRepository,
  SourceWorktree,
  Team,
  WorkItem,
  WorkItemQuery,
} from '@workspace/core/contracts';
import { findAssignedAgentForWorkItem } from '@workspace/core/work-assignments';
import {
  workItemAssignmentPrompt,
  workItemComposerPrompt,
  workItemBranchName,
  workItemDisplayIdentifier,
  type WorkItemAssignmentAction,
} from '@workspace/core/work-item-prompts';
import { computed, ref } from 'vue';
import { translate } from '../i18n';
import type { RepositoryWorkStartInput } from './right-workspace';
import type { WorkspaceProvisioningOperation } from './WorkspaceProvisioningProgressDialog.vue';

export type StartWorkItemsInput = {
  action: WorkItemAssignmentAction;
  items: WorkItem[];
  teamId: string;
  backend?: Agent['backend'];
  model?: string;
  reasoningEffort?: string;
  repository?: SourceRepository;
  isCurrent?: () => boolean;
};

export type WorkItemAssignmentIntent = {
  item: WorkItem;
  teamId?: string;
};

type WorkItemRoutingModel = {
  activeTeamId: () => string | undefined;
  composerText: () => string;
  currentAgent: () => Agent | null;
  snapshot: () => AppSnapshot;
  sourceRepositories: () => SourceRepository[];
};

type WorkItemRoutingActions = {
  assign: (payload: { agentId: string; item: WorkItem; prompt?: string }) => Promise<void>;
  assignFromUi: (payload: { agentId: string; item: WorkItem }) => void;
  createAgent: (input: CreateAgentInput) => Promise<Agent | null | void>;
  createBranch: (agentId: string, input: AgentGitBranchInput) => Promise<unknown>;
  createWorktree: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  listBranches: (repoPath: string, remoteConnectionId?: string) => Promise<unknown>;
  duplicateAgent: (agentId: string, options: DuplicateAgentOptions) => Promise<Agent | null>;
  loadItems: (
    provider: WorkItem['provider'],
    repositoryId: string,
    query: WorkItemQuery,
  ) => Promise<WorkItem[] | void>;
};

type WorkItemRoutingUi = {
  confirmReassignment: (message: string) => Promise<boolean>;
  focusComposer: () => void;
  openNewAgent: (teamId: string | undefined, sourceRepositoryName: string) => void;
  notifyError?: (message: string) => void;
  selectAgent: (agentId: string) => void;
  updateComposer: (agentId: string, text: string) => void;
};

export function useWorkItemRouting(options: {
  actions: WorkItemRoutingActions;
  model: WorkItemRoutingModel;
  ui: WorkItemRoutingUi;
}) {
  const pendingNewAgentItem = ref<WorkItem | null>(null);
  const creationProgress = ref<Exclude<WorkspaceProvisioningOperation, { mode: 'branchMove' | 'batch' }> | null>(null);
  const backgroundSignals = new Map<string, () => void>();

  const newAgentTeamName = computed(() => (
    pendingNewAgentItem.value ? workItemTeamName(pendingNewAgentItem.value) : ''
  ));
  const newAgentWorktreeBranchName = computed(() => {
    const item = pendingNewAgentItem.value;
    if (!item) return '';
    return workItemBranchName(item);
  });

  async function startRepositoryWork(agentId: string, input: RepositoryWorkStartInput): Promise<void> {
    const sourceAgent = findAgent(agentId);
    if (!sourceAgent) throw new Error(translate('surface.appShell.theSelectedAgentIsUnavailable'));
    await validateAgentRepository(sourceAgent);

    const item = await resolvePullRequestBranch(input.item);
    ensureCurrent(input.isCurrent);
    const sourceAgentName = agentDisplayName(sourceAgent);
    const targetLabel = input.target === 'duplicate' ? `a duplicate of ${sourceAgentName}` : sourceAgentName;
    if (!await confirmAssignedOverride(item, targetLabel, input.target === 'current' ? sourceAgent.id : undefined)) {
      throw new Error(translate('surface.appShell.assignmentCancelled'));
    }
    ensureCurrent(input.isCurrent);

    const targetAgent = input.target === 'duplicate'
      ? input.model || (input.backend && input.backend !== sourceAgent.backend)
        ? await options.actions.createAgent({
            name: `${sourceAgentName} ${workItemDisplayIdentifier(item)}`, folder: sourceAgent.folder ?? '',
            backend: input.backend, teamId: sourceAgent.teamId,
            ...(input.model ? { modelSelection: { model: input.model, ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort as ReasoningEffort } : {}) } } : {}),
          })
        : await options.actions.duplicateAgent(sourceAgent.id, {
          select: false,
          name: `${sourceAgentName} ${workItemDisplayIdentifier(item)}`,
        })
      : sourceAgent;
    if (!targetAgent) throw new Error(translate('surface.appShell.theDuplicateAgentCouldNotBeCreated'));
    ensureCurrent(input.isCurrent);
    if (input.target === 'duplicate' && input.workspace.kind !== 'worktree') {
      throw new Error(translate('surface.appShell.aDuplicatedAgentRequiresANewWorktree'));
    }

    // Work handed to the current agent stays on that agent's branch; only duplicates get a branch.
    if (input.target === 'duplicate') {
      const pullRequestBranch = item.kind === 'pullRequest' ? item.branchName?.trim() : undefined;
      if (item.kind === 'pullRequest' && !pullRequestBranch) {
        throw new Error(translate('surface.appShell.gitHubDidNotReturnThePullRequestBranch'));
      }
      const checkoutBranch = pullRequestBranch ?? (input.workspace.kind === 'worktree' ? input.workspace.branchName : undefined);
      if (checkoutBranch) {
        await options.actions.createBranch(targetAgent.id, {
          name: checkoutBranch,
          createWorktree: true,
          ...(item.kind === 'pullRequest' ? { pullRequestNumber: item.number } : {}),
          confirmed: true,
        });
      }
    }
    ensureCurrent(input.isCurrent);
    if (input.action === 'custom') prefill(targetAgent.id, item);
    else await assignWithPrompt(targetAgent.id, item, input.action);
  }

  function prefill(agentId: string, item: WorkItem): void {
    const prompt = workItemComposerPrompt(item);
    const existingText = options.model.currentAgent()?.id === agentId
      ? options.model.composerText().trimEnd()
      : '';
    const text = existingText ? `${existingText}\n\n${prompt}` : prompt;
    options.ui.updateComposer(agentId, text);
    options.ui.selectAgent(agentId);
    options.ui.focusComposer();
  }

  async function openNewAgent(intent: WorkItemAssignmentIntent): Promise<void> {
    if (!await confirmAssignedOverride(intent.item, 'a new agent')) return;
    pendingNewAgentItem.value = intent.item;
    options.ui.openNewAgent(
      intent.teamId ?? options.model.activeTeamId(),
      workItemRepositoryName(intent.item),
    );
  }

  function clearNewAgent(): void {
    pendingNewAgentItem.value = null;
  }

  function assignCreatedAgent(agent: Agent | null | void): void {
    const item = pendingNewAgentItem.value;
    if (agent && item) options.actions.assignFromUi({ agentId: agent.id, item });
    clearNewAgent();
  }

  async function startMany(input: StartWorkItemsInput): Promise<void> {
    if (!input.items.length) return;
    const keys = new Set<string>();
    for (const item of input.items) {
      const key = `${item.provider}:${item.id}`;
      if (keys.has(key)) throw new Error('The same issue was selected more than once.');
      keys.add(key);
    }
    const id = crypto.randomUUID();
    const progress = input.items.length === 1
      ? { mode: 'single' as const, progress: {
          id, state: 'running' as const, backend: input.backend ?? 'codex',
          repositoryName: input.repository?.name ?? workItemRepositoryName(input.items[0]!),
          createWorktree: true, branchName: workItemBranchName(input.items[0]!), hasPrompt: true, phase: 'creatingWorktree' as const,
        } }
      : { mode: 'multiple' as const, id, state: 'running' as const, ticketCount: input.items.length,
          repositories: input.items.map(item => input.repository?.name ?? workItemRepositoryName(item)), phase: 'creatingWorktrees' as const };
    creationProgress.value = progress;
    const backgrounded = new Promise<'background'>((resolve) => backgroundSignals.set(id, () => resolve('background')));
    let prepared = 0;
    let created = 0;
    const settled = Promise.allSettled(input.items.map(async listedItem => {
      const { agent, item } = await createIsolatedAgent(listedItem, input.teamId, {
        backend: input.backend, model: input.model, reasoningEffort: input.reasoningEffort,
        repository: input.repository, isCurrent: input.isCurrent,
        onPhase: () => {
          if (++prepared !== input.items.length) return;
          const current = creationProgress.value;
          if (current?.mode === 'single') current.progress.phase = 'creatingAgent';
          else if (current) current.phase = 'initializingWorkspaces';
        },
      });
      if (++created === input.items.length) {
        const current = creationProgress.value;
        if (current?.mode === 'single') Object.assign(current.progress, { phase: 'startingPrompt', agentId: agent.id, agentName: agentDisplayName(agent) });
        else if (current) current.phase = 'startingAgents';
      }
      ensureCurrent(input.isCurrent);
      await assignWithPrompt(agent.id, item, input.action);
    }));
    const outcome = await Promise.race([settled, backgrounded]);
    backgroundSignals.delete(id);
    if (outcome === 'background') {
      // The dialog is gone; the caller is released and a later failure must still reach the user.
      void settled.then((results) => {
        const late = results.find(result => result.status === 'rejected');
        if (late) options.ui.notifyError?.(late.reason instanceof Error ? late.reason.message : String(late.reason));
      });
      return;
    }
    const results = outcome;
    const failure = results.find(result => result.status === 'rejected');
    const current = creationProgress.value;
    const state = current?.mode === 'single' ? current.progress : current;
    if (state) Object.assign(state, { state: failure ? 'error' : 'success', ...(failure ? { error: String(failure.reason instanceof Error ? failure.reason.message : failure.reason) } : {}) });
    if (failure) throw failure.reason;
  }

  function backgroundCreationProgress(id: string): void {
    const current = creationProgress.value;
    if (!current || (current.mode === 'single' ? current.progress.id : current.id) !== id) return;
    creationProgress.value = null;
    backgroundSignals.get(id)?.();
  }

  function closeCreationProgress(id: string): void {
    const current = creationProgress.value;
    if (current && (current.mode === 'single' ? current.progress.id : current.id) === id) creationProgress.value = null;
  }

  async function createIsolatedAgent(
    listedItem: WorkItem,
    teamId: string,
    creationOptions: { reuseExisting?: boolean; backend?: Agent['backend']; model?: string; reasoningEffort?: string; repository?: SourceRepository; isCurrent?: () => boolean; onPhase?: (phase: 'creatingAgent') => void } = {},
  ): Promise<{ agent: Agent; item: WorkItem }> {
    const team = options.model.snapshot().teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new Error(translate('surface.appShell.theSelectedTeamIsUnavailable'));

    const item = await resolvePullRequestBranch(listedItem);
    ensureCurrent(creationOptions.isCurrent);
    const repositoryName = workItemRepositoryName(item);
    const repository = creationOptions.repository ?? (workProviderDefinition(item.provider).repositoryBacked
      ? options.model.sourceRepositories().find((candidate) => candidate.name === repositoryName) : undefined);
    if (!repository) throw new Error(`${item.sourceName} is not available in the source folder.`);
    if (!await confirmAssignedOverride(item, 'a new agent')) throw new Error(translate('surface.appShell.assignmentCancelled'));
    ensureCurrent(creationOptions.isCurrent);

    const worktree = await options.actions.createWorktree({
      repoPath: repository.path,
      branchName: workItemBranchName(item),
      ...(creationOptions.reuseExisting ? { reuseExisting: true } : {}),
      ...remoteConnection(team),
    });
    ensureCurrent(creationOptions.isCurrent);
    creationOptions.onPhase?.('creatingAgent');
    const agent = await options.actions.createAgent({
      name: null,
      folder: worktree.path,
      ...(creationOptions.backend ? { backend: creationOptions.backend } : {}),
      ...(creationOptions.model ? { modelSelection: {
        model: creationOptions.model,
        ...(creationOptions.reasoningEffort ? { reasoningEffort: creationOptions.reasoningEffort as ReasoningEffort } : {}),
      } } : {}),
      sourceRepositoryName: repository.name,
      teamId: team.id,
    });
    if (!agent) throw new Error(`Could not create an agent for ${item.sourceName} ${workItemDisplayIdentifier(item)}.`);
    return { agent, item };
  }

  async function startInExistingSession(
    agentId: string,
    listedItem: WorkItem,
    action: WorkItemAssignmentAction,
    isCurrent?: () => boolean,
  ): Promise<void> {
    const agent = findAgent(agentId);
    if (!agent) throw new Error(translate('surface.appShell.theSelectedAgentIsUnavailable'));
    await validateAgentRepository(agent);
    const item = await resolvePullRequestBranch(listedItem);
    ensureCurrent(isCurrent);
    if (!await confirmAssignedOverride(item, agentDisplayName(agent), agent.id)) {
      throw new Error(translate('surface.appShell.assignmentCancelled'));
    }
    ensureCurrent(isCurrent);

    await assignWithPrompt(agent.id, item, action);
  }

  async function assignExisting(payload: { agentId: string; item: WorkItem }): Promise<void> {
    const targetAgent = findAgent(payload.agentId);
    if (!await confirmAssignedOverride(payload.item, targetAgent?.name ?? 'this agent', payload.agentId)) return;
    options.actions.assignFromUi(payload);
  }

  async function resolvePullRequestBranch(item: WorkItem): Promise<WorkItem> {
    if (item.kind !== 'pullRequest' || item.branchName?.trim()) return item;
    const refreshedItems = await options.actions.loadItems(item.provider, item.sourceId, {
      kind: 'pullRequest',
      state: 'all',
    });
    const resolved = refreshedItems?.find((candidate) => candidate.id === item.id) ?? item;
    if (!resolved.branchName?.trim()) throw new Error(translate('surface.appShell.gitHubDidNotReturnThePullRequestBranch'));
    return resolved;
  }

  async function confirmAssignedOverride(
    item: WorkItem,
    targetLabel: string,
    targetAgentId?: string,
  ): Promise<boolean> {
    const assignedAgent = findAssignedAgentForWorkItem(
      options.model.snapshot().agents,
      options.model.snapshot().workBacklog.assignments,
      item,
    );
    if (!assignedAgent || assignedAgent.id === targetAgentId) return true;
    return options.ui.confirmReassignment(
      `${workProviderTitle(item.provider)} ${workItemDisplayIdentifier(item)} is already assigned to ${assignedAgent.name}. We don't know if ${assignedAgent.name} is still working on it. Assign it to ${targetLabel} anyway?`,
    );
  }

  function findAgent(agentId: string): Agent | null {
    return options.model.snapshot().agents.find((candidate) => candidate.id === agentId) ?? null;
  }

  async function validateAgentRepository(agent: Agent): Promise<void> {
    if (agent.workspace?.kind !== 'git') throw new Error('The selected code repository is unavailable.');
    const team = options.model.snapshot().teams.find(team => team.id === agent.teamId);
    await options.actions.listBranches(agent.workspace.primaryWorktreeRoot, team?.remoteConnectionId);
  }

  async function assignWithPrompt(
    agentId: string,
    item: WorkItem,
    action: WorkItemAssignmentAction,
  ): Promise<void> {
    await options.actions.assign({
      agentId,
      item,
      prompt: workItemAssignmentPrompt(item, { action }),
    });
  }

  return {
    assignCreatedAgent,
    assignExisting,
    clearNewAgent,
    createIsolatedAgent,
    creationProgress,
    closeCreationProgress,
    backgroundCreationProgress,
    newAgentItem: pendingNewAgentItem,
    newAgentTeamName,
    newAgentWorktreeBranchName,
    openNewAgent,
    prefill,
    startInExistingSession,
    startMany,
    startRepositoryWork,
  };
}

function workItemRepositoryName(item: WorkItem): string {
  if (!workProviderDefinition(item.provider).repositoryBacked) return '';
  return item.sourceName.split('/').filter(Boolean).at(-1) ?? item.sourceName;
}

function workItemTeamName(item: WorkItem): string {
  return `${workProviderTitle(item.provider)} ${workItemDisplayIdentifier(item)}`;
}

function ensureCurrent(isCurrent?: () => boolean): void {
  if (isCurrent && !isCurrent()) throw new Error('The backlog selection changed. Select the issue again.');
}

function workProviderTitle(provider: WorkItem['provider']): string {
  return workProviderDefinition(provider).label;
}

function remoteConnection(team: Team): { remoteConnectionId?: string } {
  const remoteConnectionId = team.remoteConnectionId?.trim();
  return remoteConnectionId ? { remoteConnectionId } : {};
}
