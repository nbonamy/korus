import { closeAgentInSnapshot, updateAgentFolder } from '@workspace/core/agent-manager';
import type { BackendEvent } from '@workspace/core/backend-driver';
import { agentGitBackendMethods, backendMethods, type AgentGitBackendMethod } from '@workspace/core/backend-protocol/methods';
import { requireAgentFolder } from '@workspace/core/agent-folder';
import type {
  Agent,
  AgentGitDiff,
  AgentGitLogInput,
  AgentGitLogCommitInput,
  AgentGitLogFileInput,
  AgentGitLogPage,
  AgentGitLogDetails,
  AgentGitLogFileDiff,
  AgentGitDiffTarget,
  AgentGitMessageGenerationResult,
  AgentGitOperationProgress,
  AgentGitPullRequest,
  AgentGitUpdateFromBaseResult,
  AgentGitPullResult,
  AgentGitWorkflow,
  GitPruneInventory,
  GitPruneInput,
  GitPruneResult,
  AppSnapshot,
} from '@workspace/core/contracts';
import type { DelegatedWorkReportPort } from '../agents/delegated-work-report-service';
import type { BranchCurrentWorkService } from './branch-current-work-service';
import type { BranchWorkInput, BranchWorkPreview, BranchWorkResult } from '@workspace/core/branch-current-work';
import type { AgentGitService } from './agent-git-service';

export type AgentGitRequest = {
  method: AgentGitBackendMethod;
  agentId: string;
  params: Record<string, unknown>;
};

type AgentGitWorkIntegrationsPort = {
  githubConnected(): Promise<boolean>;
  findPullRequest(repositoryId: string, branch: string): Promise<AgentGitPullRequest | null>;
  createPullRequest(repositoryId: string, input: { branch: string; title: string; body: string }): Promise<AgentGitPullRequest>;
};

export type AgentGitWorkflowServiceOptions = {
  branchWork?: BranchCurrentWorkService;
  applyEvent: (event: BackendEvent) => void;
  archiveConversation: (agent: Agent) => Promise<void>;
  delegatedWorkReports: DelegatedWorkReportPort;
  driverRequest: (agent: Agent, method: string, params: unknown) => Promise<unknown>;
  releaseConversation: (agent: Agent) => Promise<void>;
  getSnapshot: () => AppSnapshot;
  getWorkIntegrations: () => AgentGitWorkIntegrationsPort;
  git: AgentGitService;
  persistAndEmitSnapshot: () => Promise<AppSnapshot>;
  refreshGitStatus: (agentId: string) => Promise<void>;
  refreshWorkspaceIdentity: (agentId: string) => Promise<boolean>;
  sendPrompt: (agentId: string, prompt: string) => void;
};

/** Owns the complete local workflow for app-level agent Git requests. */
export class AgentGitWorkflowService {
  constructor(private readonly options: AgentGitWorkflowServiceOptions) {}

  async execute(request: AgentGitRequest, agent: Agent): Promise<AgentGitLogPage | AgentGitLogDetails | AgentGitLogFileDiff | BranchWorkPreview | BranchWorkResult | AgentGitDiff | AgentGitMessageGenerationResult | AgentGitWorkflow | AgentGitUpdateFromBaseResult | AgentGitPullResult | GitPruneInventory | GitPruneResult> {
    const { method, agentId, params } = request;
    switch (method) {
      case backendMethods.agentGitBranchWorkPreview:
        if (!this.options.branchWork) throw new Error('Branch transfer is unavailable.');
        return this.options.branchWork.preview(requireAgentFolder(agent), agent.id);
      case backendMethods.agentGitBranchWork: {
        if (!this.options.branchWork) throw new Error('Branch transfer is unavailable.');
        const input = requireConfirmed(params.input, 'Branching current work');
        const result = await this.options.branchWork.execute(agent, input as BranchWorkInput);
        await this.options.refreshGitStatus(agent.id);
        return result;
      }
      case backendMethods.agentGitPruneGet:
        return this.pruneInventory(agent);
      case backendMethods.agentGitPrune: {
        const input = requireConfirmed(params.input, 'Pruning a repository');
        return this.options.git.pruning.prune(requireAgentFolder(agent), input as GitPruneInput, () => this.pruneOwners());
      }
      case backendMethods.agentGitLogGet:
        return this.options.git.history.list(requireAgentFolder(agent), params.input as AgentGitLogInput | undefined);
      case backendMethods.agentGitLogCommitGet:
        return this.options.git.history.commit(requireAgentFolder(agent), params.input as AgentGitLogCommitInput);
      case backendMethods.agentGitLogFileGet:
        return this.options.git.history.file(requireAgentFolder(agent), params.input as AgentGitLogFileInput);
      case backendMethods.agentGitDiffGet:
        return this.getDiff(agent, parseGitDiffTarget(params.target));
      case backendMethods.agentGitWorkflowGet:
        return this.workflow(agent);
      case backendMethods.agentGitMessageGenerate:
        return this.generateMessage(agent, params);
      case backendMethods.agentGitStage: {
        requireConfirmed(params.input, 'Staging files');
        const input = requireRecord(params.input);
        const paths = requireStringArray(input.paths, 'paths');
        await this.options.git.stage(requireAgentFolder(agent), paths);
        return this.workflow(agent, { refreshStatus: true });
      }
      case backendMethods.agentGitRevert: {
        const input = requireConfirmed(params.input, 'Reverting changes');
        if (typeof input.includeUntracked !== 'boolean') throw new Error('Choose whether to include unversioned files.');
        await this.options.git.revert(requireAgentFolder(agent), input.includeUntracked);
        return this.workflow(agent, { refreshStatus: true });
      }
      case backendMethods.agentGitCommit: {
        const folder = requireAgentFolder(agent);
        const input = requireConfirmed(params.input, 'Creating a commit');
        const workflow = await this.options.git.workflow(folder);
        const pathsToStage = workflow.files
          .filter((file) => (file.indexStatus === '?' ? input.includeUntracked === true : input.includeUnstaged === true))
          .map((file) => file.path);
        if (pathsToStage.length > 0) {
          await this.options.git.stage(folder, pathsToStage);
        }
        await this.options.git.commit(folder, requireString(input.message, 'message'));
        return this.workflow(agent, { refreshStatus: true });
      }
      case backendMethods.agentGitPush: {
        const folder = requireAgentFolder(agent);
        const input = requireConfirmed(params.input, 'Pushing a branch');
        if (input.closeAgentAfterPush === true && input.target !== 'mergeTarget') {
          throw new Error('Closing an agent after pushing is only available for a completed merge.');
        }
        const currentWorkflow = await this.options.git.workflow(folder);
        const pushFolder = input.target === 'mergeTarget' && !isIntegrationBranchName(currentWorkflow.branch)
          ? await this.options.git.mergeTarget(folder)
          : folder;
        const workflow = pushFolder === folder ? currentWorkflow : await this.options.git.workflow(pushFolder);
        if (workflow.detached || !workflow.branch) throw new Error('Create or check out a branch before pushing.');
        if (!workflow.remote) throw new Error('Add a Git remote before pushing.');
        await this.options.git.push(pushFolder, workflow.remote, workflow.branch, !workflow.upstream);
        const result = await this.workflow(agent, { refreshStatus: true });
        if (input.closeAgentAfterPush === true) {
          await this.options.archiveConversation(agent);
          closeAgentInSnapshot(this.options.getSnapshot(), agentId);
          await this.options.persistAndEmitSnapshot();
        }
        return result;
      }
      case backendMethods.agentGitBranchCreate: {
        const folder = requireAgentFolder(agent);
        const input = requireConfirmed(params.input, 'Creating a branch');
        const pullRequestNumber = input.pullRequestNumber;
        if (pullRequestNumber !== undefined && (!Number.isInteger(pullRequestNumber) || (pullRequestNumber as number) <= 0)) {
          throw new Error('Invalid pull request number.');
        }
        const branchName = requireString(input.name, 'name');
        const targetFolder = pullRequestNumber === undefined
          ? await this.options.git.createBranch(folder, branchName, input.createWorktree === true)
          : await this.options.git.createBranch(folder, branchName, input.createWorktree === true, pullRequestNumber as number);
        if (input.createWorktree === true) {
          updateAgentFolder(this.options.getSnapshot(), agentId, targetFolder);
          await this.options.releaseConversation(agent);
        }
        const workspaceChanged = await this.options.refreshWorkspaceIdentity(agentId);
        if (input.createWorktree === true || workspaceChanged) await this.options.persistAndEmitSnapshot();
        return this.workflow(agent, { refreshStatus: true });
      }
      case backendMethods.agentGitPullRequestCreate:
        return this.createPullRequest(agent, agentId, params);
      case backendMethods.agentGitMerge:
        return this.merge(agent, agentId, params);
      case backendMethods.agentGitUpdateFromBase:
        return this.updateFromBase(agent, agentId, params);
      case backendMethods.agentGitPull: {
        const input = requireConfirmed(params.input, 'Pulling a branch');
        const result = await this.options.git.pull(requireAgentFolder(agent), input.allowDirty === true);
        if (result.conflicts.length > 0) {
          this.options.sendPrompt(agentId, conflictResolutionPrompt({ ...result, baseBranch: result.upstream }));
        }
        return { ...result, workflow: await this.workflow(agent, { refreshStatus: true }) };
      }
    }
  }

  private pruneOwners(): { folder: string; name: string }[] {
    const snapshot = this.options.getSnapshot();
    return snapshot.agents.filter(agent => agent.folder && !snapshot.teams.find(team => team.id === agent.teamId)?.remoteConnectionId)
      .map(agent => ({ folder: agent.folder!, name: agent.name ?? agent.id }));
  }

  private async pruneInventory(agent: Agent): Promise<GitPruneInventory> {
    const inventory = await this.options.git.pruning.inventory(requireAgentFolder(agent), this.pruneOwners());
    const workflow = await this.options.git.workflow(requireAgentFolder(agent));
    const integrations = this.options.getWorkIntegrations();
    if (workflow.repository.includes('/') && await integrations.githubConnected()) {
      // PR badges are context, never proof that a ref's current head is merged.
      await Promise.all(inventory.groups.map(async group => {
        const remote = group.remotes.find(target => target.name === `${workflow.remote}/${group.branch}`);
        if (!remote) return;
        const pr = await integrations.findPullRequest(workflow.repository, group.branch).catch(() => null);
        if (pr && pr.headSha === remote.sha) remote.pullRequest = pr;
      }));
    }
    return inventory;
  }

  private async getDiff(agent: Agent, target: AgentGitDiffTarget): Promise<AgentGitDiff> {
    if (target.type === 'turn') {
      const turnDiff = this.options.getSnapshot().turnGitDiffs[target.turnId];
      if (!turnDiff || turnDiff.agentId !== agent.id || turnDiff.diff === undefined) {
        throw new Error('The selected turn does not have a Git diff.');
      }
      return {
        target,
        summary: { addedLines: turnDiff.addedLines, removedLines: turnDiff.removedLines, changedFiles: 0 },
        diff: turnDiff.diff,
        sections: [],
      };
    }
    return this.options.git.diff(requireAgentFolder(agent), target);
  }

  private async workflow(agent: Agent, options: { includePullRequest?: boolean; refreshStatus?: boolean } = {}): Promise<AgentGitWorkflow> {
    const workflow = await this.options.git.workflow(requireAgentFolder(agent));
    if (options.refreshStatus) {
      await this.options.refreshGitStatus(agent.id);
    }
    const workIntegrations = this.options.getWorkIntegrations();
    const githubConnected = await workIntegrations.githubConnected();
    let existingPullRequest = null;
    let githubError: string | undefined;
    if (options.includePullRequest && githubConnected && workflow.branch && workflow.repository.includes('/')) {
      try {
        existingPullRequest = await workIntegrations.findPullRequest(workflow.repository, workflow.branch);
      } catch (error) {
        githubError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ...workflow,
      githubConnected,
      ...(existingPullRequest ? { existingPullRequest } : {}),
      ...(githubError ? { githubError } : {}),
    };
  }

  private async generateMessage(agent: Agent, params: Record<string, unknown>): Promise<AgentGitMessageGenerationResult> {
    const folder = requireAgentFolder(agent);
    const input = requireRecord(params.input);
    const kind = requireString(input.kind, 'kind');
    if (kind === 'commit') {
      const source = await this.options.git.commitMessageContext(folder, {
        includeUnstaged: input.includeUnstaged === true,
        includeUntracked: input.includeUntracked === true,
      });
      const generated = await this.options.driverRequest(agent, backendMethods.driverTextGenerate, {
        agent,
        cwd: folder,
        prompt: `Write a commit message for these selected changes.\n\n${source.context}`,
        developerInstructions: ['Return a git commit message. By default use one concise, imperative subject and follow the repository convention when evident. Do not add Markdown fences or explanations.', this.options.getSnapshot().general.commitMessageInstructions].filter(Boolean).join('\n\n'),
        outputSchema: commitMessageOutputSchema,
      });
      return parseGeneratedGitMessage(generated, 'commit');
    }
    if (kind === 'pullRequest') {
      const source = await this.options.git.pullRequestMessageContext(folder);
      const generated = await this.options.driverRequest(agent, backendMethods.driverTextGenerate, {
        agent,
        cwd: folder,
        prompt: `Draft a pull request title and body for the changes from ${source.baseRef ?? 'the base branch'} to the current branch.\n\n${source.context}`,
        developerInstructions: ['Return a concise pull request title and a useful Markdown body describing the outcome, important implementation details, and testing when supported by the supplied context. Do not invent facts.', this.options.getSnapshot().general.pullRequestInstructions].filter(Boolean).join('\n\n'),
        outputSchema: pullRequestMessageOutputSchema,
      });
      return parseGeneratedGitMessage(generated, 'pullRequest');
    }
    throw new Error(`Unsupported Git message kind: ${kind}`);
  }

  private async createPullRequest(agent: Agent, agentId: string, params: Record<string, unknown>): Promise<AgentGitWorkflow> {
    const folder = requireAgentFolder(agent);
    const input = requireConfirmed(params.input, 'Creating a pull request');
    const workflow = await this.workflow(agent, { includePullRequest: true });
    if (!workflow.branch || workflow.detached) throw new Error('Create or check out a branch before creating a pull request.');
    if (isIntegrationBranchName(workflow.branch)) throw new Error('Create a feature branch before creating a pull request.');
    if (!workflow.remote || !workflow.remoteUrl) throw new Error('Add a GitHub remote before creating a pull request.');
    if (workflow.githubError) throw new Error(`Could not verify existing pull requests: ${workflow.githubError}`);
    if (workflow.existingPullRequest) throw new Error(`Pull request #${workflow.existingPullRequest.number} already exists for this branch.`);
    await this.options.git.assertPullRequestChanges(folder);
    if (input.reportBack === true) this.emitOperationProgress(agentId, 'pullRequest', 'handoff');
    const handoff = input.reportBack === true
      ? await this.options.delegatedWorkReports.prepare(agent, {
        kind: 'pullRequest',
        branch: workflow.branch,
      })
      : null;
    if (input.reportBack === true) this.emitOperationProgress(agentId, 'pullRequest', 'delivery');
    if (!workflow.upstream || workflow.ahead > 0) {
      await this.options.git.push(folder, workflow.remote, workflow.branch, !workflow.upstream);
    }
    const createdPullRequest = await this.options.getWorkIntegrations().createPullRequest(workflow.repository, {
      branch: workflow.branch,
      title: requireString(input.title, 'title'),
      body: typeof input.body === 'string' ? input.body : '',
    });
    const outcome = {
      kind: 'pullRequest' as const,
      branch: workflow.branch,
      title: createdPullRequest.title,
      number: createdPullRequest.number,
      url: createdPullRequest.url,
      draft: createdPullRequest.draft,
    };
    const now = new Date().toISOString();
    agent.pullRequest = {
      ...createdPullRequest,
      provider: 'github',
      repository: workflow.repository,
      branch: workflow.branch,
      createdAt: now,
      updatedAt: now,
    };
    const result = {
      ...await this.workflow(agent, { refreshStatus: true }),
      existingPullRequest: createdPullRequest,
    };
    this.options.delegatedWorkReports.notifyWorker(agent, outcome);
    if (input.reportBack === true) {
      this.options.delegatedWorkReports.deliver(agent, outcome, handoff);
    }
    await this.options.persistAndEmitSnapshot();
    return result;
  }

  private async merge(agent: Agent, agentId: string, params: Record<string, unknown>): Promise<AgentGitWorkflow> {
    const folder = requireAgentFolder(agent);
    const input = requireConfirmed(params.input, 'Merging a branch');
    const strategy = input.strategy === 'squash' ? 'squash' : 'merge';
    const commitMessage = strategy === 'squash' ? requireString(input.commitMessage, 'commitMessage') : undefined;
    const deleteWorktree = input.deleteWorktree === true;
    const sourceWorkflow = input.reportBack === true ? await this.workflow(agent) : null;
    if (input.reportBack === true) this.emitOperationProgress(agentId, 'merge', 'handoff');
    const handoff = input.reportBack === true
      ? await this.options.delegatedWorkReports.prepare(agent, {
        kind: 'merge',
        branch: sourceWorkflow?.branch ?? 'branch',
        repository: sourceWorkflow?.repository ?? 'the base branch',
      })
      : null;
    if (input.reportBack === true) this.emitOperationProgress(agentId, 'merge', 'delivery');
    const mergeResult = await this.options.git.merge(folder, strategy, input.deleteBranch === true, deleteWorktree, commitMessage);
    const targetFolder = mergeResult.targetFolder;
    const outcome = {
      kind: 'merge' as const,
      branch: sourceWorkflow?.branch ?? 'branch',
      repository: sourceWorkflow?.repository ?? 'the base branch',
    };
    if (deleteWorktree) {
      updateAgentFolder(this.options.getSnapshot(), agentId, targetFolder);
      await this.options.releaseConversation(agent);
    }
    const targetWorkflow = await this.workflow(agent, { refreshStatus: true });
    const result = mergeResult.warning ? { ...targetWorkflow, warning: mergeResult.warning } : targetWorkflow;
    if (input.reportBack === true) {
      this.options.delegatedWorkReports.deliver(agent, outcome, handoff);
    }
    if (deleteWorktree) {
      if (input.pushAfter !== true) {
        await this.options.archiveConversation(agent);
        closeAgentInSnapshot(this.options.getSnapshot(), agentId);
      }
      await this.options.persistAndEmitSnapshot();
    }
    return result;
  }

  private async updateFromBase(agent: Agent, agentId: string, params: Record<string, unknown>): Promise<AgentGitUpdateFromBaseResult> {
    const input = requireConfirmed(params.input, 'Updating a branch from its base branch');
    const result = await this.options.git.updateFromBase(requireAgentFolder(agent), input.allowDirty === true);
    if (result.conflicts.length > 0) {
      this.options.sendPrompt(agentId, conflictResolutionPrompt(result));
    }
    return {
      ...result,
      workflow: await this.workflow(agent, { refreshStatus: true }),
    };
  }

  private emitOperationProgress(
    agentId: string,
    operation: AgentGitOperationProgress['operation'],
    phase: AgentGitOperationProgress['phase'],
  ): void {
    this.options.applyEvent({
      agentId,
      type: 'git.operationProgress',
      payload: { operation, phase } satisfies AgentGitOperationProgress,
    });
  }
}

function conflictResolutionPrompt(result: { baseBranch: string; branch: string; conflicts: string[] }): string {
  return [
    `Git encountered conflicts while updating \`${result.branch}\` from \`${result.baseBranch}\`.`,
    '',
    'Conflicted files:',
    ...result.conflicts.map((path) => `- ${path}`),
    '',
    'Resolve the conflicts and preserve the intended changes from both branches. Check git status: if a rebase is in progress, stage the resolved files and run git rebase --continue, repeating for further conflicts; otherwise commit the merge when ready. Run the relevant tests. If asked to abandon the update, abort the active rebase or merge. Do not push.',
  ].join('\n');
}

function parseGitDiffTarget(value: unknown): AgentGitDiffTarget {
  if (value === undefined) return { type: 'uncommitted' };
  const record = requireRecord(value);
  const type = requireString(record.type, 'Git diff target type');
  if (type === 'branch') {
    return typeof record.baseRef === 'string' && record.baseRef.trim()
      ? { type, baseRef: record.baseRef }
      : { type };
  }
  if (type === 'uncommitted' || type === 'unstaged' || type === 'staged') return { type };
  if (type === 'commit') return { type, sha: requireString(record.sha, 'commit SHA') };
  if (type === 'turn') return { type, turnId: requireString(record.turnId, 'turn ID') };
  throw new Error(`Unsupported Git diff target: ${type}`);
}

export function parseAgentGitRequest(method: string, value: unknown): AgentGitRequest | null {
  if (!agentGitBackendMethods.some((candidate) => candidate === method)) return null;
  const params = requireRecord(value);
  return {
    method: method as AgentGitBackendMethod,
    agentId: requireString(params.agentId, 'agentId'),
    params,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Invalid work integration request params.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${name}.`);
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Invalid ${name}.`);
  return value as string[];
}

function requireConfirmed(value: unknown, action: string): Record<string, unknown> {
  const input = requireRecord(value);
  if (input.confirmed !== true) throw new Error(`${action} requires explicit confirmation.`);
  return input;
}

function isIntegrationBranchName(branch?: string): boolean {
  return branch === 'main' || branch === 'master' || branch === 'develop' || branch === 'development' || branch === 'trunk';
}

const commitMessageOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { message: { type: 'string' } },
  required: ['message'],
};

const pullRequestMessageOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['title', 'body'],
};

function parseGeneratedGitMessage(value: unknown, kind: 'commit' | 'pullRequest'): AgentGitMessageGenerationResult {
  if (!isRecord(value) || typeof value.text !== 'string') throw new Error('The backend returned an invalid generated message.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.text);
  } catch {
    throw new Error('The backend returned malformed generated content.');
  }
  if (!isRecord(parsed)) throw new Error('The backend returned malformed generated content.');
  if (kind === 'commit') {
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!message) throw new Error('The backend returned an empty commit message.');
    return { kind, message };
  }
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
  if (!title) throw new Error('The backend returned an empty pull request title.');
  return { kind, title, body };
}
