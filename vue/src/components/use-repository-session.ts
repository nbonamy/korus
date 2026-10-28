import { agentDisplayName } from '@workspace/core/agent-display';
import { preferredBackendChoices } from './backend-selection';
import type {
  Agent,
  AgentBackend,
  AgentCreationProgress,
  AppSnapshot,
  AutomationLocation,
  CreateAgentInput,
  CreateSourceWorktreeInput,
  SourceBranch,
  SourceRepository,
  SourceWorktree,
  WorkItem,
  WorkSource,
  WorkProviderKind,
} from '@workspace/core/contracts';
import { workItemAssignmentPrompt, workItemBranchName } from '@workspace/core/work-item-prompts';
import { canonicalGitRemoteIdentity } from '@workspace/core/git-remote';
import { computed, ref } from 'vue';
import { translate } from '../i18n';
import type { WorkItemAssignmentSelection, WorkItemAssignmentSession } from './WorkItemAssignmentPicker.vue';
import { resolveRepositorySessionContext, type RepositorySessionSource } from './repository-session-context';

export function useRepositorySession(options: {
  activeTeamId: () => string | undefined;
  assignWorkItem: (payload: { agentId: string; item: WorkItem; prompt?: string }) => Promise<void>;
  createAgent: (input: CreateAgentInput) => Promise<Agent | null | void>;
  createIsolatedWorkItemAgent: (
    item: WorkItem,
    teamId: string,
    options?: { reuseExisting?: boolean; backend?: AgentBackend; model?: string; reasoningEffort?: string; serviceTier?: string; repository?: SourceRepository; remoteConnectionId?: string; isCurrent?: () => boolean; onPhase?: (phase: 'creatingAgent') => void },
  ) => Promise<{ agent: Agent; item: WorkItem }>;
  createSourceWorktree: (input: CreateSourceWorktreeInput) => Promise<SourceWorktree>;
  getAgentGitRemote?: (agentId: string) => Promise<string | undefined>;
  getSnapshot: () => AppSnapshot;
  getWorkRepositories: (provider: WorkProviderKind) => WorkSource[];
  listSourceRepositories: (remoteConnectionId?: string) => Promise<SourceRepository[]>;
  listSourceBranches: (repoPath: string, remoteConnectionId?: string) => Promise<SourceBranch[]>;
  loadWorkItems: (repositoryId: string, location?: AutomationLocation, provider?: WorkProviderKind) => Promise<WorkItem[]>;
  loadWorkRepositories: (location?: AutomationLocation, provider?: WorkProviderKind) => Promise<WorkSource[] | void>;
  notifyError: (message: string) => void;
  prefillWorkItemForAgent: (agentId: string, item: WorkItem) => void;
  startWorkItemInExistingSession: (
    agentId: string,
    item: WorkItem,
    action: WorkItemAssignmentSelection['action'],
    isCurrent?: () => boolean,
  ) => Promise<void>;
  suggestSourceWorktreePath: (input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath' | 'remoteConnectionId'>) => Promise<string>;
}) {
  const source = ref<RepositorySessionSource | null>(null);
  const backend = ref<AgentBackend | undefined>();
  const visible = ref(false);
  const branches = ref<SourceBranch[]>([]);
  const workItems = ref<WorkItem[]>([]);
  const workSourceId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const creationProgress = ref<AgentCreationProgress | null>(null);
  const backgroundedCreationIds = new Set<string>();
  const worktreeSource = ref<RepositorySessionSource | null>(null);
  const worktreeBranches = ref<SourceBranch[]>([]);
  const worktreeBranchesLoading = ref(false);
  let sourceRequestId = 0;
  let worktreeRequestId = 0;

  const assignmentSessions = computed<WorkItemAssignmentSession[]>(() => {
    const current = source.value;
    if (!current) return [];
    const { teamId, remoteConnectionId } = context(current);
    return options.getSnapshot().agents
      .filter((agent) => (!teamId || agent.teamId === teamId)
        && agent.remoteConnectionId === remoteConnectionId
        && agent.workspace?.kind === 'git'
        && agent.workspace.primaryWorktreeRoot === current.repositoryRoot)
      .map((agent) => ({
        agentId: agent.id,
        branch: agent.workspace?.kind === 'git' ? agent.workspace.branch ?? '' : '',
        label: agent.workspace?.kind === 'git' && agent.workspace.branch
          ? `${agentDisplayName(agent)} · ${agent.workspace.branch}`
          : agentDisplayName(agent),
      }));
  });
  const worktreeRepository = computed<SourceRepository | null>(() => {
    const current = worktreeSource.value;
    return current ? { name: current.repositoryName, path: current.repositoryRoot, worktrees: [] } : null;
  });

  async function open(nextSource: RepositorySessionSource): Promise<void> {
    backend.value = preferredBackendChoices(options.getSnapshot(), context(nextSource).remoteConnectionId)[0];
    const requestId = ++sourceRequestId;
    source.value = nextSource;
    visible.value = true;
    branches.value = [];
    workItems.value = [];
    workSourceId.value = null;
    error.value = null;
    loading.value = true;
    const { teamId, remoteConnectionId, location } = context(nextSource);
    try {
      const loadedBranches = await options.listSourceBranches(nextSource.repositoryRoot, remoteConnectionId || undefined);
      if (requestId !== sourceRequestId) return;
      branches.value = loadedBranches;
      try {
        if (nextSource.workSource) {
          workSourceId.value = nextSource.workSource.id;
          const loadedItems = await options.loadWorkItems(nextSource.workSource.id, location, nextSource.workSource.provider);
          if (requestId === sourceRequestId) workItems.value = loadedItems;
          return;
        }
        const checkouts = await options.listSourceRepositories(remoteConnectionId);
        if (requestId !== sourceRequestId) return;
        const checkout = checkouts.find(repository => repository.path === nextSource.repositoryRoot
          || repository.worktrees.some(worktree => worktree.path === nextSource.repositoryRoot));
        const owningAgent = options.getSnapshot().agents.find(agent => (!nextSource.agentId || agent.id === nextSource.agentId)
          && agent.teamId === teamId && agent.workspace?.kind === 'git'
          && (agent.workspace.primaryWorktreeRoot === nextSource.repositoryRoot || agent.workspace.repositoryRoot === nextSource.repositoryRoot));
        const identity = checkout ? checkout.remoteIdentity : owningAgent
          ? canonicalGitRemoteIdentity(await options.getAgentGitRemote?.(owningAgent.id) ?? '') : undefined;
        if (requestId !== sourceRequestId) return;
        const provider = identity?.startsWith('github.com/') ? 'github' : identity?.startsWith('gitlab.com/') ? 'gitlab' : undefined;
        if (!provider) return;
        const repositories = await options.loadWorkRepositories(location, provider);
        if (requestId !== sourceRequestId) return;
        const matchingRepositories = (repositories ?? (location ? [] : options.getWorkRepositories(provider)))
          .filter(repository => repository.provider === provider && canonicalGitRemoteIdentity(repository.url) === identity);
        const workRepository = matchingRepositories.length === 1 ? matchingRepositories[0] : undefined;
        if (workRepository) {
          workSourceId.value = workRepository.id;
          const loadedItems = await options.loadWorkItems(workRepository.id, location, provider);
          if (requestId === sourceRequestId) workItems.value = loadedItems;
        }
      } catch {
        if (requestId === sourceRequestId) workItems.value = [];
      }
    } catch (caught) {
      if (requestId !== sourceRequestId) return;
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (requestId === sourceRequestId) loading.value = false;
    }
  }

  function close(): void {
    sourceRequestId += 1;
    visible.value = false;
    source.value = null;
    workSourceId.value = null;
    loading.value = false;
    error.value = null;
  }

  async function listBranches(input: { agentId: string; repositoryRoot: string; remoteConnectionId?: string }): Promise<SourceBranch[]> {
    const { remoteConnectionId } = context(input);
    return options.listSourceBranches(input.repositoryRoot, remoteConnectionId);
  }

  function createOnBranch(payload: RepositorySessionSource & { branch: SourceBranch }): void {
    backend.value = preferredBackendChoices(options.getSnapshot(), context(payload).remoteConnectionId)[0];
    const { branch, ...nextSource } = payload;
    void createSession(nextSource, branch);
  }

  async function openWorktree(nextSource: RepositorySessionSource): Promise<void> {
    const requestId = ++worktreeRequestId;
    worktreeSource.value = nextSource;
    worktreeBranches.value = [];
    worktreeBranchesLoading.value = true;
    const { remoteConnectionId } = context(nextSource);
    try {
      const loaded = await options.listSourceBranches(nextSource.repositoryRoot, remoteConnectionId || undefined);
      if (requestId === worktreeRequestId) worktreeBranches.value = loaded;
    } catch (caught) {
      if (requestId === worktreeRequestId) {
        options.notifyError(caught instanceof Error ? caught.message : String(caught));
        worktreeSource.value = null;
      }
    } finally {
      if (requestId === worktreeRequestId) worktreeBranchesLoading.value = false;
    }
  }

  function closeWorktree(): void {
    worktreeRequestId += 1;
    worktreeSource.value = null;
    worktreeBranches.value = [];
    worktreeBranchesLoading.value = false;
  }

  async function createWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree> {
    const { remoteConnectionId } = context(worktreeSource.value);
    return options.createSourceWorktree({ ...input, ...(remoteConnectionId ? { remoteConnectionId } : {}) });
  }

  async function suggestWorktreePath(
    input: Pick<CreateSourceWorktreeInput, 'branchName' | 'repoPath'>,
  ): Promise<string> {
    const { remoteConnectionId } = context(worktreeSource.value);
    return options.suggestSourceWorktreePath({ ...input, ...(remoteConnectionId ? { remoteConnectionId } : {}) });
  }

  async function createFromWorktree(worktree: SourceWorktree): Promise<void> {
    const nextSource = worktreeSource.value;
    closeWorktree();
    if (!nextSource) return;
    const { teamId, remoteConnectionId } = context(nextSource);
    try {
      await options.createAgent({
        name: null,
        folder: worktree.path,
        backend: backend.value,
        sourceRepositoryName: nextSource.repositoryName,
        ...(teamId ? { teamId } : {}),
        ...(remoteConnectionId ? { remoteConnectionId } : {}),
      });
    } catch (caught) {
      options.notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function createForSourceBranch(branch: SourceBranch): void {
    const current = source.value;
    if (current) void createSession(current, branch);
  }

  async function startWork(selection: WorkItemAssignmentSelection): Promise<void> {
    await runWork(selection, selection.action, async (agent, item) => {
      await options.assignWorkItem({
        agentId: agent.id,
        item,
        prompt: workItemAssignmentPrompt(item, { action: selection.action }),
      });
    }, () => options.startWorkItemInExistingSession(selection.agentId!, selection.item, selection.action));
  }

  async function customizeWork(selection: Omit<WorkItemAssignmentSelection, 'action'>): Promise<void> {
    await runWork(selection, 'custom', (agent, item) => options.prefillWorkItemForAgent(agent.id, item),
      () => options.prefillWorkItemForAgent(selection.agentId!, selection.item));
  }

  // The picker closes as soon as the user confirms; from then on the work runs to completion on its own.
  async function runWork(
    selection: Omit<WorkItemAssignmentSelection, 'action'>,
    action: WorkItemAssignmentSelection['action'] | 'custom',
    handOverToNewAgent: (agent: Agent, item: WorkItem) => void | Promise<void>,
    handOverToExistingAgent: () => void | Promise<void>,
  ): Promise<void> {
    const current = source.value;
    if (!current) return;
    if (selection.isCurrent && !selection.isCurrent()) return;
    const { teamId, remoteConnectionId } = context(current);
    close();
    if (selection.destination === 'existing') {
      try {
        if (!selection.agentId) throw new Error(translate('surface.appShell.theSelectedAgentIsUnavailable'));
        await handOverToExistingAgent();
      } catch (caught) {
        reportWorkError(caught);
      }
      return;
    }

    const id = `work-item-${Date.now()}`;
    const branchName = workItemBranchName(selection.item);
    const resolvedBackend = selection.backend ?? backend.value ?? 'codex';
    creationProgress.value = {
      id,
      state: 'running',
      backend: resolvedBackend,
      repositoryName: current.repositoryName,
      createWorktree: true,
      branchName,
      hasPrompt: action !== 'custom',
      phase: 'creatingWorktree',
    };
    const update = (change: Partial<AgentCreationProgress>) => {
      if (creationProgress.value?.id === id) creationProgress.value = { ...creationProgress.value, ...change };
    };
    try {
      if (!teamId) throw new Error(translate('surface.appShell.createOrSelectATeamBeforeStartingRepositoryWork'));
      const { agent, item } = await options.createIsolatedWorkItemAgent(selection.item, teamId, {
        backend: resolvedBackend,
        ...(selection.model ? { model: selection.model } : {}),
        ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
        ...(selection.serviceTier ? { serviceTier: selection.serviceTier } : {}),
        ...(selection.reuseExisting ? { reuseExisting: true } : {}),
        repository: { name: current.repositoryName, path: current.repositoryRoot, worktrees: [] },
        ...(remoteConnectionId ? { remoteConnectionId } : {}),
        onPhase: (phase) => update({ phase }),
      });
      update({ phase: 'startingPrompt', agentId: agent.id, agentName: agentDisplayName(agent) });
      await handOverToNewAgent(agent, item);
      update({ state: 'success' });
      backgroundedCreationIds.delete(id);
    } catch (caught) {
      const backgrounded = backgroundedCreationIds.delete(id);
      if (isAssignmentCancelled(caught)) {
        if (creationProgress.value?.id === id) creationProgress.value = null;
        return;
      }
      if (backgrounded) {
        // The progress dialog is gone, so a failure must not be swallowed.
        options.notifyError(caught instanceof Error ? caught.message : String(caught));
        return;
      }
      update({ state: 'error', error: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  function reportWorkError(caught: unknown): void {
    if (isAssignmentCancelled(caught)) return;
    options.notifyError(caught instanceof Error ? caught.message : String(caught));
  }

  function isAssignmentCancelled(caught: unknown): boolean {
    return caught instanceof Error && caught.message === translate('surface.appShell.assignmentCancelled');
  }

  function closeCreationProgress(id: string): void {
    if (creationProgress.value?.id === id) creationProgress.value = null;
  }

  function backgroundCreationProgress(id: string): void {
    if (creationProgress.value?.id !== id) return;
    if (creationProgress.value.state === 'running') backgroundedCreationIds.add(id);
    creationProgress.value = null;
  }

  async function createSession(nextSource: RepositorySessionSource, branch: SourceBranch): Promise<void> {
    const { teamId, remoteConnectionId } = context(nextSource);
    close();
    try {
      await options.createAgent({
        name: null,
        folder: nextSource.repositoryRoot,
        repositorySession: { existingBranch: branch.name },
        backend: backend.value,
        sourceRepositoryName: nextSource.repositoryName,
        ...(teamId ? { teamId } : {}),
        ...(remoteConnectionId ? { remoteConnectionId } : {}),
      });
    } catch (caught) {
      options.notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function context(current?: Pick<RepositorySessionSource, 'agentId' | 'teamId' | 'remoteConnectionId'> | null) {
    return resolveRepositorySessionContext(options.getSnapshot(), current, options.activeTeamId());
  }

  return {
    backend,
    assignmentSessions,
    branches,
    close,
    closeWorktree,
    closeCreationProgress,
    backgroundCreationProgress,
    creationProgress,
    createForSourceBranch,
    createFromWorktree,
    createOnBranch,
    createWorktree,
    customizeWork,
    error,
    listBranches,
    loading,
    open,
    openWorktree,
    source,
    startWork,
    suggestWorktreePath,
    visible,
    workItems,
    workSourceId,
    worktreeBranches,
    worktreeBranchesLoading,
    worktreeRepository,
    worktreeSource,
  };
}
