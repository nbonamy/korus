import { applyExecutionSelection } from '@workspace/core/execution-selection';
import type { ExecutionSelection } from '@workspace/core/contracts/execution';
import type { Agent, AppSnapshot, BackendModelOption, CreateSourceWorktreeInput, SourceWorktree } from '@workspace/core/contracts';
import { createAgentInSnapshot } from '@workspace/core/agent-manager';
import { resolveAgentBackend } from '@workspace/core/agent-backends';
import { createEntityId } from '@workspace/core/ids';
import { isAbsolute, relative, sep } from 'node:path';
import { isMissionArtifacts, missionTicketReady, type Mission, type MissionArtifacts, type MissionReviewFinding, type MissionStage } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { missionLeadAgentId } from '@workspace/core/mission-attention';
import { missionImplementationBusy, missionRunAssignment, missionRunTicketIndex, pendingMissionRun, type MissionArtifactReadResult, type MissionArtifactWriteInput, type MissionExecutionInput, type MissionImplementationStartProgress, type MissionResultInput, type MissionReviewFindingInput, type MissionReviewFindingUpdateInput, type MissionRun, type MissionTicketDraftInput, type MissionTicketDraftResult, type MissionToolContext } from '@workspace/core/mission-execution';
import type { MissionService } from './mission-service';
import { MissionAgentTools } from './mission-agent-tools';
import { missionAgent, missionTeamRepositories, sameSkills, stageKickoffPrompt } from './mission-execution-policy';
import { MissionWorkspaceService } from './mission-workspace-service';

export type MissionExecutionPorts = {
  snapshot: AppSnapshot;
  missions: MissionService;
  publish(): Promise<unknown>;
  listModels?(agent: Agent): Promise<BackendModelOption[]>;
  reportImplementationStartProgress?(progress: MissionImplementationStartProgress): void;
  ensureMissionHome(missionId: string): Promise<string>;
  readArtifact(missionId: string, stage: MissionStage): Promise<string>;
  writeArtifact(missionId: string, stage: MissionStage, content: string): Promise<{ size: number }>;
  validateRepository(path: string): Promise<void>;
  createWorktree(input: CreateSourceWorktreeInput): Promise<SourceWorktree>;
  getHead(path: string): Promise<string>;
  ensureStageSkills(missionId: string, stage: MissionStage): Promise<MissionRun['skills']>;
  refreshWorkspace(agentId: string): Promise<void>;
  refreshConversationContext(agent: Agent): Promise<void>;
  continueStage(agentId: string, prompt: string): Promise<void>;
  startRemediation(agentId: string, prompt: string): Promise<void>;
  sendMessage?(fromAgentId: string, toAgentId: string, content: string): void;
  interrupt(agent: Agent): Promise<unknown>;
  isCommitLockOwnerStopped?(agent: Agent): Promise<boolean>;
};

/** Mission policy owns durable runs; provider hosts still own conversations and turns. */
export class MissionExecutionService {
  private readonly launches = new Map<string, Promise<void>>();
  private readonly postTurnLaunches = new Map<string, { missionId: string; runIds: string[] }>();
  private readonly remediationDispatches = new Set<string>();
  private readonly remediationTurns = new Map<string, { missionId: string; leadId: string; findingIds: string[]; frozenFindingIds: string[] }>();
  private readonly completedTurns = new Map<string, Set<string>>();
  private readonly activeTurns = new Map<string, string>();
  private readonly cancellingRuns = new Map<string, Promise<void>>();
  private readonly completionRetries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly commitLockWaiters = new Set<() => void>();
  private readonly recoveredLocks = new Set<string>();
  private readonly agentTools: MissionAgentTools;
  private readonly workspaces: MissionWorkspaceService;
  constructor(private readonly ports: MissionExecutionPorts) {
    for (const mission of ports.snapshot.missions ?? []) {
      for (const workspace of mission.execution?.workspaces ?? []) {
        if (workspace.commitLock) this.recoveredLocks.add(JSON.stringify([mission.id, workspace.repositoryPath, workspace.commitLock]));
      }
    }
    this.agentTools = new MissionAgentTools(ports, input => this.execute(input));
    this.workspaces = new MissionWorkspaceService(ports);
  }

  async execute(input: MissionExecutionInput): Promise<void> {
    if (!input || typeof input.id !== 'string' || !Number.isInteger(input.revision)) throw new Error('Invalid mission command.');
    const mission = this.requireMission(input.id);
    if (mission.revision !== input.revision) throw new Error('This mission changed. Reload before continuing.');
    if (input.action === 'configure') {
      const team = this.ports.snapshot.teams.find(team => team.id === input.teamId && team.id === mission.teamId);
      if (!team || !Array.isArray(input.memberIds) || !input.memberIds.length || input.memberIds.length > 20
        || input.memberIds.some(id => !this.ports.snapshot.agents.some(agent => agent.id === id && agent.teamId === team.id && !agent.remoteConnectionId))) throw new Error('Choose a local team and at least one of its agents.');
      await this.change(input, current => {
        if (current.execution?.workspace || current.execution?.runs.length) throw new Error('Mission workspace configuration is locked after the first run.');
        current.execution = { teamId: team.id, memberIds: [...new Set(input.memberIds)], workspaces: [], runs: [] };
      });
      return;
    }
    if (input.action === 'attachRepository') {
      if (typeof input.repoPath !== 'string' || !input.repoPath.trim()) throw new Error('Choose a repository.');
      const repoPath = input.repoPath.trim();
      if (!missionTeamRepositories(this.ports.snapshot, mission).includes(repoPath)) throw new Error('Choose a repository represented in this mission team.');
      await this.ports.validateRepository(repoPath);
      await this.change(input, current => {
        if (current.execution?.workspace) throw new Error('The mission repository is locked after its worktree is created.');
        current.execution!.repoPath = repoPath;
      });
      return;
    }
    if (input.action === 'recordDelivery') {
      if (typeof input.repositoryPath !== 'string' || !input.repositoryPath.trim() || !input.result
        || !['pullRequest', 'merge'].includes(input.result.kind)
        || (input.result.kind === 'pullRequest' && (!Number.isInteger(input.result.number) || input.result.number <= 0 || typeof input.result.url !== 'string' || !/^https?:\/\//.test(input.result.url)))) {
        throw new Error('Invalid Mission delivery result.');
      }
      await this.change(input, current => {
        if (current.stage !== 'ship') throw new Error('Repositories can be delivered only from the Ship stage.');
        const delivery = current.execution?.deliveries?.find(candidate => candidate.repositoryPath === input.repositoryPath);
        if (!delivery) throw new Error('This repository is not part of the Mission delivery.');
        if (delivery.status !== 'pending') throw new Error('This repository has already been delivered.');
        if (input.result.kind === 'pullRequest') {
          delivery.status = 'pullRequestCreated';
          delivery.pullRequest = { number: input.result.number, url: input.result.url };
        } else {
          delivery.status = 'merged';
          delete delivery.pullRequest;
        }
        if (current.execution!.deliveries!.every(candidate => candidate.status !== 'pending')) current.status = 'completed';
      });
      return;
    }
    if (input.action === 'cancel') {
      const run = mission.execution?.runs.find(run => run.id === input.runId);
      if (!run || !['preparing', 'running', 'awaitingReview'].includes(run.status)) throw new Error('No cancellable mission run.');
      if (this.cancellingRuns.has(run.id)) throw new Error('This run is already being stopped.');
      let finishCancellation!: () => void;
      this.cancellingRuns.set(run.id, new Promise<void>(resolve => { finishCancellation = resolve; }));
      try {
        const worker = this.agent(run.workerId);
        const deferred = worker && this.postTurnLaunches.get(worker.id);
        if (worker && deferred?.runIds.includes(run.id)) {
          deferred.runIds = deferred.runIds.filter(id => id !== run.id);
          if (!deferred.runIds.length) this.postTurnLaunches.delete(worker.id);
        }
        if (worker && worker.status.type !== 'idle' && worker.status.type !== 'error') await this.ports.interrupt(worker);
        await this.ports.missions.change(input.id, current => {
          const latest = current.execution?.runs.find(candidate => candidate.id === input.runId);
          if (current.status === 'completed' || current.stage !== run.stage || !latest || (run.workerId && latest.workerId !== run.workerId)
            || !(['preparing', 'running', 'awaitingReview'].includes(latest.status) || (worker && latest.status === 'failed'))) {
            throw new Error('This mission changed. Reload before continuing.');
          }
          latest.status = 'cancelled'; latest.finishedAt = new Date().toISOString();
        });
        await this.ports.publish();
      } finally {
        this.cancellingRuns.delete(run.id);
        finishCancellation();
      }
      return;
    }
    if (input.action === 'selectReviewFinding') {
      if (typeof input.findingId !== 'string' || !input.findingId.trim() || typeof input.selected !== 'boolean') {
        throw new Error('Invalid Mission review finding selection.');
      }
      await this.change(input, current => {
        if (current.stage !== 'review') throw new Error('Review findings can be selected only during Review.');
        const finding = current.artifacts.review.findings?.find(candidate => candidate.id === input.findingId);
        if (!finding) throw new Error('Mission review finding was not found.');
        if (finding.remediation.state !== 'open') throw new Error('A finding already being remediated cannot be changed.');
        finding.selected = input.selected;
        finding.updatedAt = new Date().toISOString();
      });
      return;
    }
    if (input.action === 'fixSelectedReviewFindings') {
      if (mission.execution?.debugFixture) {
        await this.change(input, current => {
          if (current.stage !== 'review') throw new Error('Findings can be fixed only during Review.');
          const openFindings = (current.artifacts.review.findings ?? []).filter(finding => finding.remediation.state === 'open');
          if (!openFindings.some(finding => finding.selected)) throw new Error('Select at least one unresolved finding.');
          const completedAt = new Date().toISOString();
          for (const finding of openFindings) {
            finding.remediation = finding.selected
              ? { state: 'fixed', completedAt, evidence: 'Debug fixture remediation completed.' }
              : { state: 'skipped', startedAt: completedAt };
            finding.updatedAt = completedAt;
          }
        });
        return;
      }
      const reviewRun = mission.execution?.runs.slice().reverse().find(candidate => (
        candidate.stage === 'review' && candidate.status === 'awaitingReview' && candidate.workerId
      ));
      if (!reviewRun?.workerId) throw new Error('Submit the Review result before fixing findings.');
      if ([...this.remediationTurns.values()].some(turn => turn.missionId === input.id)) {
        throw new Error('Review finding remediation is already running.');
      }
      let findings: MissionReviewFinding[] = [];
      let batches: Array<{ workerId: string; findings: MissionReviewFinding[]; frozenFindingIds: string[] }> = [];
      let allFrozenFindingIds: string[] = [];
      let findingsMarked = false;
      try {
        const openFindings = mission.artifacts.review.findings?.filter(finding => finding.remediation.state === 'open') ?? [];
        findings = openFindings.filter(finding => finding.selected);
        if (!findings.length) throw new Error('Select at least one unresolved finding.');
        const findingsByRepository = new Map<string, MissionReviewFinding[]>();
        for (const finding of findings) {
          const repositoryFindings = findingsByRepository.get(finding.repositoryPath) ?? [];
          repositoryFindings.push(finding);
          findingsByRepository.set(finding.repositoryPath, repositoryFindings);
        }
        const workerIds = new Set<string>();
        batches = [...findingsByRepository].map(([repositoryPath, repositoryFindings]) => {
          const workerId = mission.execution?.runs.slice().reverse().find(run => (
            run.stage === 'implementation' && run.repositoryPath === repositoryPath && run.status === 'accepted' && run.workerId
          ))?.workerId;
          if (!workerId || !this.agent(workerId)) throw new Error(`The implementation worker for ${repositoryPath} is unavailable.`);
          if (workerIds.has(workerId)) throw new Error('Each affected repository must have its own implementation worker.');
          if (this.remediationDispatches.has(workerId) || this.remediationTurns.has(workerId)) {
            throw new Error('Review finding remediation is already running.');
          }
          workerIds.add(workerId);
          return {
            workerId,
            findings: repositoryFindings,
            frozenFindingIds: openFindings.filter(finding => finding.repositoryPath === repositoryPath).map(finding => finding.id),
          };
        });
        for (const workerId of workerIds) this.remediationDispatches.add(workerId);
        await this.change(input, current => {
          if (current.stage !== 'review') throw new Error('Findings can be fixed only during Review.');
          const run = current.execution?.runs.slice().reverse().find(candidate => candidate.stage === 'review' && candidate.status === 'awaitingReview');
          if (!run) throw new Error('Submit the Review result before fixing findings.');
          const currentOpenFindings = (current.artifacts.review.findings ?? []).filter(finding => finding.remediation.state === 'open');
          if (currentOpenFindings.filter(finding => finding.selected).map(finding => finding.id).join() !== findings.map(finding => finding.id).join()) {
            throw new Error('The selected Review findings changed. Reload before continuing.');
          }
          const startedAt = new Date().toISOString();
          allFrozenFindingIds = currentOpenFindings.map(finding => finding.id);
          for (const finding of currentOpenFindings) {
            finding.remediation = finding.selected
              ? { state: 'fixing', startedAt }
              : { state: 'skipped', startedAt };
            finding.updatedAt = startedAt;
          }
        });
        findingsMarked = true;
        const results = await Promise.allSettled(batches.map(async batch => {
          await this.ports.startRemediation(batch.workerId, missionFindingFixPrompt(mission, batch.findings));
          this.remediationTurns.set(batch.workerId, {
            missionId: input.id,
            leadId: reviewRun.workerId!,
            findingIds: batch.findings.map(finding => finding.id),
            frozenFindingIds: batch.frozenFindingIds,
          });
        }));
        const failedBatches = batches.filter((_batch, index) => results[index]!.status === 'rejected');
        if (failedBatches.length) {
          throw (results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason;
        }
      } catch (error) {
        if (findingsMarked) {
          const activeFindingIds = new Set([...this.remediationTurns.values()]
            .filter(turn => turn.missionId === input.id)
            .flatMap(turn => turn.frozenFindingIds));
          const changedFindingIds = new Set(allFrozenFindingIds.filter(findingId => !activeFindingIds.has(findingId)));
          if (changedFindingIds.size) {
            await this.ports.missions.change(input.id, current => {
              for (const finding of current.artifacts.review.findings ?? []) {
                if (changedFindingIds.has(finding.id) && ['fixing', 'skipped'].includes(finding.remediation.state)) finding.remediation = { state: 'open' };
              }
            });
            await this.ports.publish();
          }
        }
        throw error;
      } finally {
        for (const batch of batches) this.remediationDispatches.delete(batch.workerId);
      }
      return;
    }
    if (input.action === 'rerunReview') {
      if (mission.execution?.debugFixture) {
        await this.change(input, current => {
          if (current.stage !== 'review') throw new Error('Review can be re-run only during Review.');
          const findings = current.artifacts.review.findings ?? [];
          if (!findings.length || !findings.every(finding => finding.remediation.state === 'fixed' || finding.remediation.state === 'skipped')) {
            throw new Error('Complete remediation before re-running Review.');
          }
          const updatedAt = new Date().toISOString();
          for (const finding of findings) {
            finding.remediation = { state: 'open' };
            finding.updatedAt = updatedAt;
          }
        });
        return;
      }
      let runId = '';
      await this.changeAsync(input, async current => {
        if (current.stage !== 'review') throw new Error('Review can be re-run only during Review.');
        const findings = current.artifacts.review.findings ?? [];
        if (!findings.length || !findings.every(finding => finding.remediation.state === 'fixed' || finding.remediation.state === 'skipped')) {
          throw new Error('Complete remediation before re-running Review.');
        }
        const previousRun = current.execution?.runs.slice().reverse().find(run => run.stage === 'review' && run.status === 'awaitingReview' && run.proposal);
        if (!previousRun) throw new Error('No completed Review result is available to re-run.');
        previousRun.status = 'accepted';
        previousRun.finishedAt = new Date().toISOString();
        current.artifacts.review = { summary: '', pullRequestUrl: '', findings: [] };
        if (current.artifactFiles) delete current.artifactFiles.review;
        runId = this.enqueueRun(current, { feedback: 'Re-review the remediated Mission workspaces and report the current findings.' });
      });
      void this.startLaunch(input.id, runId);
      return;
    }
    if (input.action === 'accept') {
      let nextRunIds: string[] = [];
      let implementationCompleted = false;
      const startsImplementation = mission.stage === 'tickets';
      const implementationTickets = mission.execution?.runs.find(run => run.id === input.runId)?.proposal?.tickets
        ?? mission.artifacts.tickets;
      const reportImplementationStartProgress = (phase: MissionImplementationStartProgress['phase']): void => {
        if (!startsImplementation) return;
        this.ports.reportImplementationStartProgress?.({
          missionId: mission.id,
          phase,
          repositoryCount: new Set(implementationTickets.map(ticket => ticket.repositoryPath).filter(Boolean)).size,
          ticketCount: implementationTickets.length,
        });
      };
      await this.changeAsync(input, async current => {
        const workflow = missionWorkflow(current.workflow.type);
        const run = current.execution?.runs.find(run => run.id === input.runId);
        if (!run || run.status !== 'awaitingReview' || !run.proposal || run.stage !== current.stage) throw new Error('No current proposal to accept.');
        if (input.implementationModel !== undefined && run.stage !== 'tickets') throw new Error('Choose the implementation model when approving Tickets.');
        if (input.parallelImplementation !== undefined) {
          if (run.stage !== 'tickets' || typeof input.parallelImplementation !== 'boolean') throw new Error('Choose parallel implementation when approving Tickets.');
          current.execution!.parallelImplementation = input.parallelImplementation;
        }
        const implementationModel = input.implementationModel ?? current.execution?.implementationModel;
        if (run.stage === 'tickets' && implementationModel) {
          current.execution!.implementationModel = await this.validateImplementationModel(current, implementationModel);
        }
        if (run.stage === 'implementation') {
          implementationCompleted = this.acceptImplementationResult(current, run);
          await this.persistImplementationArtifact(current);
        } else {
          if (run.stage === 'tickets' && !workflow.stageReady('tickets', run.proposal)) {
            throw new Error('Assign one represented repository to every ticket before starting implementation.');
          }
          const reviewFindings = structuredClone(current.artifacts.review.findings ?? []);
          current.artifacts = structuredClone(run.proposal);
          if (run.stage === 'review') current.artifacts.review.findings = reviewFindings;
          run.status = 'accepted';
        }
        if (current.stage !== 'implementation' && workflow.stageReady(current.stage, current.artifacts)) {
          current.stage = workflow.stages[workflow.stages.indexOf(current.stage) + 1]!;
          if (current.stage === 'implementation') {
            await this.workspaces.provisionImplementationWorkspaces(current, reportImplementationStartProgress);
            reportImplementationStartProgress('startingAgents');
          }
          if (current.stage === 'ship') this.workspaces.prepareDeliveries(current);
        }
        nextRunIds = this.enqueueRuns(current, {});
      });
      this.dispatchRuns(input.id, nextRunIds);
      if (implementationCompleted) await this.notifyImplementationComplete(this.requireMission(input.id));
      return;
    }
    if (input.action === 'continueToReview') {
      let runId: string | undefined;
      await this.change(input, current => {
        if (current.stage !== 'implementation') throw new Error('Only Implementation can continue to Review.');
        if (!missionWorkflow(current.workflow.type).stageReady('implementation', current.artifacts)) throw new Error('Complete every implementation ticket before continuing to Review.');
        if (pendingMissionRun(current)) throw new Error('Wait for the current implementation run to finish.');
        if (missionImplementationBusy(current, this.ports.snapshot.agents)) {
          throw new Error('An implementation worker is still active. Wait for it to finish before Review.');
        }
        current.stage = 'review';
        runId = this.enqueueRun(current, {});
      });
      if (runId) void this.startLaunch(input.id, runId);
      return;
    }
    if (input.action === 'reopen') {
      await this.change(input, current => {
        const workflow = missionWorkflow(current.workflow.type);
        this.requireNoActiveRun(current);
        if (!workflow.stages.includes(input.stage) || workflow.stages.indexOf(input.stage) > workflow.stages.indexOf(current.stage)) throw new Error('Only reached stages can be reopened.');
        current.stage = input.stage;
        current.status = 'active';
        // Changes to upstream decisions invalidate downstream completion claims.
        if (input.stage === 'requirements' || input.stage === 'tickets') {
          current.artifacts.tickets = current.artifacts.tickets.map(ticket => ({ ...ticket, done: false }));
          current.artifacts.implementation = { changes: '', tests: '' };
        }
        if (input.stage !== 'review') current.artifacts.review = { summary: '', pullRequestUrl: '' };
        if (input.stage !== 'ship') delete current.execution!.deliveries;
      }, true);
      return;
    }
    if (input.action !== 'run') throw new Error('Unknown mission command.');
    let runIds: string[] = [];
    await this.change(input, current => {
      if (current.stage !== 'implementation') this.requireNoActiveRun(current);
      runIds = this.enqueueRuns(current, input);
      if (!runIds.length) throw new Error('No implementation ticket is ready to start.');
    });
    this.dispatchRuns(input.id, runIds);
  }

  async recordMerge(agentId: string, sourceFolder: string | null, worktreeDeleted: boolean, pushPending = false): Promise<void> {
    for (const mission of this.ports.snapshot.missions ?? []) {
      const delivery = mission.execution?.deliveries?.find(candidate => candidate.agentId === agentId);
      if (mission.stage !== 'ship' || !delivery) continue;
      const workspace = mission.execution?.workspaces?.find(candidate => candidate.repositoryPath === delivery.repositoryPath);
      const worktreePath = workspace?.path ?? mission.execution?.workspace?.path;
      if (!worktreePath) continue;
      if (sourceFolder !== null) {
        const path = relative(worktreePath, sourceFolder);
        if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) continue;
      } else if (!delivery.mergePendingPush) continue;
      await this.ports.missions.change(mission.id, current => {
        const result = current.execution!.deliveries!.find(candidate => candidate.repositoryPath === delivery.repositoryPath)!;
        if (!pushPending) {
          result.status = 'merged';
          delete result.pullRequest;
          delete result.mergePendingPush;
        } else result.mergePendingPush = true;
        if (worktreeDeleted) {
          for (const workspace of current.execution!.workspaces ?? []) {
            if (workspace.path === worktreePath) workspace.deleted = true;
          }
          if (current.execution!.workspace?.path === worktreePath) current.execution!.workspace.deleted = true;
        }
        if (current.execution!.deliveries!.every(candidate => candidate.status !== 'pending')) current.status = 'completed';
      });
      await this.ports.publish();
    }
  }

  async recoverInterruptedRuns(): Promise<void> {
    for (const mission of this.ports.snapshot.missions ?? []) {
      for (const workspace of mission.execution?.workspaces ?? []) {
        await this.recoverCommitLock(mission.id, workspace.repositoryPath);
      }
    }
    for (const mission of this.ports.snapshot.missions ?? []) {
      if (mission.execution?.debugFixture) continue;
      const fixing = mission.artifacts.review.findings?.filter(finding => finding.remediation.state === 'fixing') ?? [];
      if (!fixing.length) continue;
      await this.ports.missions.change(mission.id, current => {
        const updatedAt = new Date().toISOString();
        for (const finding of current.artifacts.review.findings ?? []) {
          if (!['fixing', 'skipped'].includes(finding.remediation.state)) continue;
          finding.remediation = { state: 'open' };
          finding.updatedAt = updatedAt;
        }
      });
      await this.ports.publish();
    }
    for (const mission of this.ports.snapshot.missions ?? []) {
      if (mission.execution?.debugFixture || mission.stage !== 'implementation') continue;
      const legacyReviews = mission.execution?.runs.filter(run => (
        run.stage === 'implementation' && run.status === 'awaitingReview' && run.proposal && run.implementationResult
      )) ?? [];
      for (const run of legacyReviews) {
        const current = this.requireMission(mission.id);
        await this.execute({ id: current.id, revision: current.revision, action: 'accept', runId: run.id });
      }
    }
    const interrupted = (this.ports.snapshot.missions ?? []).flatMap(mission => (
      mission.execution?.debugFixture ? [] : mission.execution?.runs
        .filter(run => run.status === 'preparing' || (run.status === 'running' && !this.agent(run.workerId)?.backendSession))
        .map(run => ({ missionId: mission.id, runId: run.id })) ?? []
    ));
    await Promise.all(interrupted.map(({ missionId, runId }) => this.startLaunch(missionId, runId)));
  }

  async refreshOwnedSkills(): Promise<void> {
    let changed = false;
    for (const mission of this.ports.snapshot.missions ?? []) {
      if (mission.execution?.debugFixture) continue;
      const activeRuns = mission.execution?.runs.filter(run => ['preparing', 'running', 'awaitingReview'].includes(run.status)) ?? [];
      const replacements = await Promise.all(activeRuns.map(async run => ({
        runId: run.id,
        skills: await this.ports.ensureStageSkills(mission.id, run.stage),
      })));
      if (!replacements.some(({ runId, skills }) => !sameSkills(activeRuns.find(run => run.id === runId)!.skills, skills))) continue;
      await this.ports.missions.change(mission.id, current => {
        for (const replacement of replacements) {
          const run = current.execution!.runs.find(candidate => candidate.id === replacement.runId)!;
          run.skills = replacement.skills;
        }
      });
      changed = true;
    }
    if (changed) await this.ports.publish();
  }

  private startLaunch(missionId: string, runId: string): Promise<void> {
    const existing = this.launches.get(runId);
    if (existing) return existing;
    const launch = this.launch(missionId, runId).catch(async error => {
      await this.ports.missions.change(missionId, current => {
        const run = current.execution!.runs.find(run => run.id === runId)!;
        if (!['preparing', 'running'].includes(run.status)) return;
        run.status = 'failed'; run.error = error instanceof Error ? error.message : String(error); run.finishedAt = new Date().toISOString();
      });
      await this.ports.publish();
    }).finally(() => this.launches.delete(runId));
    this.launches.set(runId, launch);
    // Launch runs independently of request deadlines; snapshot shows its actual phase.
    void launch.catch(() => undefined);
    return launch;
  }

  async submit(agentId: string, input: MissionResultInput): Promise<{ success: true; status: 'awaitingReview' | 'accepted' }> {
    if (!input || (input.artifacts !== undefined && !isMissionArtifacts(input.artifacts)) || typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 20_000) throw new Error('Invalid mission result.');
    const context = this.agentTools.contextForAgent(agentId);
    if (!context) throw new Error('This agent does not own an active run for this mission stage.');
    let status: 'awaitingReview' | 'accepted' = 'awaitingReview';
    let nextRunIds: string[] = [];
    let implementationCompleted = false;
    let commitLockReleased = false;
    await this.ports.missions.changeAsync(context.missionId, async mission => {
      const workflow = missionWorkflow(mission.workflow.type);
      const run = mission.execution?.runs.find(run => run.id === context.runId);
      if (!run || !this.agentTools.ownsWritableRun(mission, run.id, agentId)) throw new Error('This agent does not own an active run for this mission stage.');
      if (run.stage !== 'implementation' && !mission.artifactFiles?.[run.stage]) throw new Error('Write the stage artifact before submitting it for review.');
      const proposal = structuredClone(mission.artifacts);
      if (run.stage === 'implementation') {
        const assignment = missionRunAssignment(mission, run);
        const index = missionRunTicketIndex(mission, run);
        if (!assignment || index === undefined) throw new Error('The assigned Mission ticket is unavailable. Read get-mission-assignment before continuing.');
        const expected = `Complete the assigned ticket. Expected ticket ${assignment.ticketNumber}: ${assignment.title} (${assignment.ticketId}) in ${assignment.repositoryPath}. Submit summary, ticketId and implementation { changes, tests }; read get-mission-assignment for your current assignment.`;
        const compact = input.ticketId !== undefined || input.implementation !== undefined;
        if (compact && (input.artifacts !== undefined || input.ticketId !== assignment.ticketId)) throw new Error(expected);
        if (!compact) {
          const submitted = input.artifacts?.tickets[index];
          if (!submitted || submitted.title !== assignment.title || !submitted.done
            || (submitted.id !== undefined && submitted.id !== assignment.ticketId)
            || (submitted.repositoryPath !== undefined && submitted.repositoryPath !== assignment.repositoryPath)) throw new Error(expected);
        }
        const evidence = compact ? input.implementation : input.artifacts?.implementation;
        if (!evidence || typeof evidence.changes !== 'string' || typeof evidence.tests !== 'string'
          || !evidence.changes.trim() || !evidence.tests.trim() || evidence.changes.length > 100_000 || evidence.tests.length > 100_000) {
          throw new Error(`Report code changes and actual test evidence. ${expected}`);
        }
        proposal.tickets[index]!.done = true;
        proposal.implementation = {
          changes: [proposal.implementation.changes, evidence.changes].filter(Boolean).join('\n\n'),
          tests: [proposal.implementation.tests, evidence.tests].filter(Boolean).join('\n\n'),
        };
        run.implementationResult = structuredClone(evidence);
      } else {
        if (!input.artifacts || input.ticketId !== undefined || input.implementation !== undefined) throw new Error('This stage requires the complete artifacts result.');
        if (run.stage === 'requirements') proposal.requirements = structuredClone(input.artifacts.requirements);
        if (run.stage === 'tickets') {
          if (!run.draftTickets?.length) throw new Error('Create Mission ticket drafts before submitting the Tickets stage.');
          proposal.tickets = run.draftTickets.map(ticket => ({ ...structuredClone(ticket), done: false }));
        }
        if (run.stage === 'review') proposal.review = { ...structuredClone(input.artifacts.review), findings: structuredClone(mission.artifacts.review.findings ?? []) };
        if (run.stage === 'review' && !proposal.review.summary.trim()) throw new Error('The stage result is incomplete.');
        if (run.stage !== 'review' && !workflow.stageReady(run.stage, proposal)) throw new Error('The stage result is incomplete.');
      }
      if (!isMissionArtifacts(proposal)) throw new Error('Mission evidence is too large. Submit a concise report with references.');
      run.proposal = proposal; run.summary = input.summary.trim(); run.status = 'awaitingReview'; run.finishedAt = new Date().toISOString();
      delete run.error;
      if (run.stage === 'implementation') {
        implementationCompleted = this.acceptImplementationResult(mission, run);
        await this.persistImplementationArtifact(mission);
        const workspace = mission.execution?.workspaces?.find(workspace => workspace.commitLock?.agentId === agentId && workspace.commitLock.runId === run.id);
        if (workspace) {
          delete workspace.commitLock;
          commitLockReleased = true;
        }
        status = 'accepted';
        nextRunIds = this.enqueueRuns(mission, {});
      }
    });
    if (commitLockReleased) for (const wake of this.commitLockWaiters) wake();
    await this.ports.publish();
    this.dispatchRuns(context.missionId, nextRunIds, agentId);
    if (implementationCompleted) await this.notifyImplementationComplete(this.requireMission(context.missionId));
    return { success: true, status };
  }

  contextForAgent(agentId: string): MissionToolContext | undefined { return this.agentTools.contextForAgent(agentId); }
  async acquireCommitLock(agentId: string, signal?: AbortSignal): Promise<{ acquired: true }> {
    const context = this.agentTools.contextForAgent(agentId);
    if (!context || context.stage !== 'implementation') throw new Error('No active implementation assignment.');
    const turnId = this.activeTurns.get(agentId);
    if (!turnId) throw new Error('The active provider turn is unavailable. Retry when the turn is active.');
    while (true) {
      if (signal?.aborted) throw new Error('Commit lock request cancelled.');
      const run = this.requireMission(context.missionId).execution?.runs.find(candidate => candidate.id === context.runId);
      if (run?.repositoryPath) await this.recoverCommitLock(context.missionId, run.repositoryPath);
      let wake!: () => void;
      const released = new Promise<void>(resolve => { wake = resolve; });
      this.commitLockWaiters.add(wake);
      signal?.addEventListener('abort', wake, { once: true });
      // A provider may be unavailable at startup, or finish a restored turn without
      // delivering its completion event. Recheck persisted owners while waiting.
      const retryRecovery = this.recoveredLocks.size ? setTimeout(wake, 5_000) : undefined;
      try {
        const busy = Symbol('commit lock busy');
        const acquired = await this.ports.missions.changeAsync(context.missionId, mission => {
          if (signal?.aborted || this.activeTurns.get(agentId) !== turnId) throw new Error('The requesting provider turn is no longer active.');
          const run = mission.execution?.runs.find(candidate => candidate.id === context.runId);
          if (!mission.execution?.parallelImplementation || !run || run.status !== 'running' || !this.agentTools.ownsWritableRun(mission, run.id, agentId)) throw new Error('No active parallel implementation assignment.');
          const workspace = mission.execution.workspaces?.find(candidate => candidate.repositoryPath === run.repositoryPath && !candidate.deleted);
          if (!workspace) throw new Error('Mission workspace is unavailable.');
          // Abort the transaction so a waiter does not persist an unpublished revision.
          if (workspace.commitLock && (workspace.commitLock.agentId !== agentId || workspace.commitLock.runId !== run.id)) throw busy;
          workspace.commitLock = { agentId, runId: run.id, turnId };
          return true;
        }).catch(error => {
          if (error === busy) return false;
          throw error;
        });
        if (acquired) {
          if (signal?.aborted || this.activeTurns.get(agentId) !== turnId) {
            await this.releaseCommitLock(agentId, turnId);
            throw new Error('The requesting provider turn is no longer active.');
          }
          await this.ports.publish();
          return { acquired: true };
        }
        await released;
      } finally {
        if (retryRecovery) clearTimeout(retryRecovery);
        this.commitLockWaiters.delete(wake);
        signal?.removeEventListener('abort', wake);
      }
    }
  }

  private async recoverCommitLock(missionId: string, repositoryPath: string): Promise<void> {
    const workspace = this.ports.snapshot.missions?.find(mission => mission.id === missionId)?.execution?.workspaces?.find(item => item.repositoryPath === repositoryPath);
    const lock = workspace?.commitLock;
    if (!lock) return;
    const key = JSON.stringify([missionId, repositoryPath, lock]);
    if (!this.recoveredLocks.has(key) || this.activeTurns.has(lock.agentId)) return;
    const owner = this.agent(lock.agentId);
    if (!owner || !this.ports.isCommitLockOwnerStopped) return;
    let stopped = false;
    try { stopped = await this.ports.isCommitLockOwnerStopped(owner); } catch { return; }
    if (!stopped) return;
    const changed = Symbol('commit lock changed');
    const released = await this.ports.missions.changeAsync(missionId, mission => {
      const current = mission.execution?.workspaces?.find(item => item.repositoryPath === repositoryPath)?.commitLock;
      if (!current || JSON.stringify(current) !== JSON.stringify(lock) || this.activeTurns.has(lock.agentId)) throw changed;
      const target = mission.execution!.workspaces!.find(item => item.repositoryPath === repositoryPath)!;
      delete target.commitLock;
      return true;
    }).catch(error => {
      if (error === changed) return false;
      throw error;
    });
    if (released) {
      this.recoveredLocks.delete(key);
      await this.ports.publish();
      for (const wake of this.commitLockWaiters) wake();
    }
  }

  async releaseCommitLock(agentId: string, expectedTurnId?: string): Promise<{ released: true }> {
    const mission = this.ports.snapshot.missions?.find(candidate => candidate.execution?.workspaces?.some(workspace => workspace.commitLock?.agentId === agentId));
    if (!mission) {
      if (expectedTurnId) return { released: true };
      throw new Error('You do not own a Mission commit lock.');
    }
    const alreadyReleased = Symbol('lock already released');
    const released = await this.ports.missions.changeAsync(mission.id, current => {
      const workspace = current.execution?.workspaces?.find(candidate => candidate.commitLock?.agentId === agentId && (!expectedTurnId || candidate.commitLock.turnId === expectedTurnId));
      if (!workspace) {
        if (expectedTurnId) throw alreadyReleased;
        throw new Error('You do not own a Mission commit lock.');
      }
      delete workspace.commitLock;
      return true;
    }).catch(error => {
      if (error === alreadyReleased) return false;
      throw error;
    });
    if (!released) return { released: true };
    await this.ports.publish();
    for (const wake of this.commitLockWaiters) wake();
    return { released: true };
  }
  developerInstructionsForAgent(agentId: string): string | undefined { return this.agentTools.developerInstructionsForAgent(agentId); }
  listArtifacts(agentId: string) { return this.agentTools.listArtifacts(agentId); }
  readArtifact(agentId: string, stage: MissionStage): Promise<MissionArtifactReadResult> { return this.agentTools.readArtifact(agentId, stage); }
  readArtifactForMission(missionId: string, stage: MissionStage): Promise<MissionArtifactReadResult> { return this.agentTools.readArtifactForMission(missionId, stage); }
  writeArtifact(agentId: string, input: MissionArtifactWriteInput): Promise<MissionArtifactReadResult> { return this.agentTools.writeArtifact(agentId, input); }
  reportReviewFinding(agentId: string, input: MissionReviewFindingInput): Promise<MissionReviewFinding> { return this.agentTools.reportReviewFinding(agentId, input); }
  updateReviewFinding(agentId: string, input: MissionReviewFindingUpdateInput): Promise<MissionReviewFinding> { return this.agentTools.updateReviewFinding(agentId, input); }
  upsertTicket(agentId: string, input: MissionTicketDraftInput): Promise<MissionTicketDraftResult> { return this.agentTools.upsertTicket(agentId, input); }
  setTitle(agentId: string, title: string): Promise<{ success: true; title: string }> { return this.agentTools.setTitle(agentId, title); }
  attachRepository(agentId: string, repoPath: string): Promise<{ success: true; repoPath: string }> { return this.agentTools.attachRepository(agentId, repoPath); }

  agentStarted(agentId: string, turnId: string): void { this.activeTurns.set(agentId, turnId); }

  async agentFinished(agentId: string, turnId?: string): Promise<void> {
    const activeTurn = this.activeTurns.get(agentId);
    if (turnId) {
      const completed = this.completedTurns.get(agentId) ?? new Set<string>();
      if (completed.has(turnId)) return;
      completed.add(turnId);
      // Keep recent completions across ticket handoffs without retaining the whole conversation.
      if (completed.size > 64) completed.delete(completed.values().next().value!);
      this.completedTurns.set(agentId, completed);
    }
    try {
      if (activeTurn && turnId && activeTurn !== turnId) {
        await this.releaseCommitLock(agentId, turnId);
        return;
      }
      await this.finishAgentTurn(agentId, turnId);
    } catch (error) {
      if (turnId) {
        this.completedTurns.get(agentId)?.delete(turnId);
        const key = JSON.stringify([agentId, turnId]);
        if (!this.completionRetries.has(key)) {
          const timer = setTimeout(() => {
            this.completionRetries.delete(key);
            void this.agentFinished(agentId, turnId).catch(() => undefined);
          }, 1000);
          timer.unref();
          this.completionRetries.set(key, timer);
        }
      }
      throw error;
    }
  }

  private async finishAgentTurn(agentId: string, turnId?: string): Promise<void> {
    if (turnId && this.ports.snapshot.missions?.some(mission => mission.execution?.workspaces?.some(workspace => workspace.commitLock?.agentId === agentId && workspace.commitLock.turnId === turnId))) {
      await this.releaseCommitLock(agentId, turnId);
    }
    if (turnId && this.activeTurns.get(agentId) === turnId) this.activeTurns.delete(agentId);
    for (const wake of this.commitLockWaiters) wake();
    const remediationTurn = this.remediationTurns.get(agentId);
    if (remediationTurn) {
      this.remediationTurns.delete(agentId);
      const mission = this.ports.snapshot.missions?.find(candidate => candidate.id === remediationTurn.missionId);
      const findingIds = new Set(remediationTurn.findingIds);
      const frozenFindingIds = new Set(remediationTurn.frozenFindingIds);
      if (mission?.artifacts.review.findings?.some(finding => findingIds.has(finding.id) && finding.remediation.state === 'fixing')) {
        await this.ports.missions.change(remediationTurn.missionId, current => {
          const updatedAt = new Date().toISOString();
          for (const finding of current.artifacts.review.findings ?? []) {
            if (!frozenFindingIds.has(finding.id) || !['fixing', 'skipped'].includes(finding.remediation.state)) continue;
            finding.remediation = { state: 'open' };
            finding.updatedAt = updatedAt;
          }
        });
        await this.ports.publish();
      }
      if (mission) {
        const current = this.requireMission(remediationTurn.missionId);
        const findings = (current.artifacts.review.findings ?? []).filter(finding => findingIds.has(finding.id));
        this.ports.sendMessage?.(agentId, remediationTurn.leadId, missionRemediationReport(current, findings));
      }
      return;
    }
    const postTurnLaunch = this.postTurnLaunches.get(agentId);
    if (postTurnLaunch) {
      this.postTurnLaunches.delete(agentId);
      for (const runId of postTurnLaunch.runIds) void this.startLaunch(postTurnLaunch.missionId, runId);
      return;
    }
    // A completed maintenance/compaction turn is not the end of the assignment
    // when the prompt manager still has work to deliver, including after resume.
    if (this.ports.snapshot.queuedPrompts?.some(prompt => prompt.agentId === agentId)) return;
    const mission = this.ports.snapshot.missions?.find(mission => mission.execution?.runs.some(run => run.workerId === agentId && run.status === 'running' && ['implementation', 'review'].includes(run.stage)));
    if (!mission) return;
    await this.ports.missions.change(mission.id, current => {
      const run = current.execution!.runs.find(run => run.workerId === agentId && run.status === 'running');
      if (!run) return;
      run.status = 'failed'; run.error = 'Agent finished without submitting a mission result. Inspect the conversation and rerun with feedback.'; run.finishedAt = new Date().toISOString();
    });
    await this.ports.publish();
  }

  async waitForLaunches(): Promise<void> { await Promise.all(this.launches.values()); }

  private async launch(id: string, runId: string): Promise<void> {
    const mission = this.requireMission(id);
    const run = mission.execution!.runs.find(run => run.id === runId)!;
    if (run.status === 'cancelled') return;
    const canLaunch = async () => {
      await this.cancellingRuns.get(runId);
      return this.ports.snapshot.missions?.some(current => current.id === id && current.stage === run.stage
        && current.execution?.runs.some(candidate => candidate.id === runId && ['preparing', 'running'].includes(candidate.status)));
    };
    const member = this.agent(run.memberId);
    if (!member) throw new Error('Assigned team member was removed.');
    const implementationModel = run.stage === 'implementation' && mission.execution?.implementationModel
      ? await this.validateImplementationModel(mission, mission.execution.implementationModel) : undefined;
    const missionHome = await this.ports.ensureMissionHome(mission.id);
    if (!await canLaunch()) return;
    const repositoryPath = run.repositoryPath ?? mission.artifacts.tickets[run.ticketIndex ?? -1]?.repositoryPath;
    const workspace = repositoryPath
      ? mission.execution!.workspaces?.find(candidate => candidate.repositoryPath === repositoryPath)
      : mission.execution!.workspaces?.[0] ?? mission.execution!.workspace;
    const workingFolder = workspace?.path ?? missionHome;
    let worker = this.agent(run.workerId);
    const reusedWorker = !!worker;
    if (!worker) {
      const leadRun = mission.execution!.runs.slice().reverse().find(candidate => (
        (candidate.stage === 'requirements' || candidate.stage === 'tickets') && candidate.workerId
      ));
      const lead = leadRun ? this.agent(leadRun.workerId) : member;
      if (!lead) throw new Error('The main Mission agent is unavailable.');
      const workerId = createEntityId('agent');
      createAgentInSnapshot(this.ports.snapshot, { name: `${member.name || 'Agent'} · ${mission.outcome} · ${run.stage}`, teamId: mission.execution!.teamId, folder: workingFolder, ...(implementationModel && implementationModel.backend !== lead.backend ? {} : { backendDefaults: structuredClone(lead.backendDefaults) }), avatar: member.avatar, selection: { backend: implementationModel?.backend ?? lead.backend } }, undefined, workerId, { select: false });
      worker = this.agent(workerId)!;
      await this.ports.missions.change(id, current => {
        current.execution!.runs.find(run => run.id === runId)!.workerId = worker!.id;
      });
    }
    if (implementationModel) {
      if (worker.backend !== implementationModel.backend) throw new Error('The implementation worker provider does not match the selected model.');
      applyExecutionSelection(worker, implementationModel);
    }
    await this.ports.refreshWorkspace(worker.id);
    if (!await canLaunch()) return;
    await this.ports.missions.change(id, current => {
      const currentRun = current.execution!.runs.find(run => run.id === runId)!;
      currentRun.workerId = worker.id;
      if (currentRun.status !== 'cancelled') currentRun.status = 'running';
      current.stageAgentIds[currentRun.stage] = worker.id;
    });
    await this.ports.publish();
    const skills = await this.ports.ensureStageSkills(mission.id, run.stage);
    if (!await canLaunch()) return;
    await this.ports.missions.change(id, current => {
      const currentRun = current.execution!.runs.find(candidate => candidate.id === runId)!;
      if (currentRun.status !== 'cancelled') currentRun.skills = skills;
    });
    await this.ports.publish();
    if (!await canLaunch()) return;
    if (reusedWorker && worker.backendSession) {
      await this.ports.refreshConversationContext(worker);
      if (!await canLaunch()) return;
    }
    if (await canLaunch() && run.stage !== 'requirements') await this.ports.continueStage(worker.id, stageKickoffPrompt(mission, run));
  }

  private async validateImplementationModel(mission: Mission, selection: ExecutionSelection): Promise<ExecutionSelection> {
    const leadRun = mission.execution!.runs.slice().reverse().find(run => (run.stage === 'requirements' || run.stage === 'tickets') && run.workerId);
    const lead = this.agent(leadRun?.workerId ?? mission.execution!.memberIds[0]);
    if (!lead || !selection) throw new Error('Choose an implementation model.');
    const backend = resolveAgentBackend(this.ports.snapshot, selection.backend);
    if (typeof selection.model !== 'string' || !selection.model.trim()) throw new Error('Choose an implementation model.');
    if (!this.ports.listModels) throw new Error('The implementation model catalog is unavailable.');
    const catalog = await this.ports.listModels({ ...lead, backend, backendSession: undefined, backendDefaults: undefined });
    const model = catalog.find(model => !model.hidden && model.model === selection.model);
    if (!model) throw new Error('The implementation model is unavailable or restricted on this host.');
    const effort = selection.reasoningEffort ?? model.defaultReasoningEffort ?? undefined;
    if (effort !== undefined && !model.supportedReasoningEfforts?.some(option => option.reasoningEffort === effort)) {
      throw new Error('Choose a supported reasoning effort for the implementation model.');
    }
    if (selection.serviceTier !== null && !model.serviceTiers?.some(tier => tier.id === selection.serviceTier)) {
      throw new Error('Choose a supported service tier for the implementation model.');
    }
    return { ...selection, backend, model: model.model, reasoningEffort: effort ?? null };
  }

  private requireMission(id: string): Mission {
    const mission = this.ports.snapshot.missions?.find(mission => mission.id === id);
    if (!mission) throw new Error('Mission not found.');
    return mission;
  }
  private enqueueRuns(mission: Mission, input: { memberId?: string; ticketIndex?: number; feedback?: string }): string[] {
    if (mission.stage === 'ship') return [];
    if (mission.stage !== 'implementation') return [this.enqueueRun(mission, input)];
    const execution = mission.execution;
    if (!execution) throw new Error('Configure the Mission team first.');
    const activeStatuses: MissionRun['status'][] = ['preparing', 'running', 'awaitingReview'];
    const busyRepositories = new Set(execution.runs
      .filter(run => run.stage === 'implementation' && activeStatuses.includes(run.status) && run.repositoryPath)
      .map(run => run.repositoryPath!));
    const activeTickets = new Set(execution.runs
      .filter(run => run.stage === 'implementation' && activeStatuses.includes(run.status) && run.ticketIndex !== undefined)
      .map(run => run.ticketIndex!));
    const candidates = input.ticketIndex === undefined
      ? mission.artifacts.tickets.map((_, index) => index)
      : [input.ticketIndex];
    const backlogRun = execution.runs.slice().reverse().find(run => run.stage === 'tickets' && run.status === 'accepted');
    const attempts = backlogRun ? execution.runs.slice(execution.runs.indexOf(backlogRun) + 1) : execution.runs;
    const runIds: string[] = [];
    for (const ticketIndex of candidates) {
      const ticket = mission.artifacts.tickets[ticketIndex];
      const repositoryPath = ticket?.repositoryPath;
      if (!ticket || !repositoryPath || !missionTicketReady(mission.artifacts.tickets, ticketIndex)
        || activeTickets.has(ticketIndex) || (!execution.parallelImplementation && busyRepositories.has(repositoryPath))) continue;
      const previous = attempts.slice().reverse().find(run => run.stage === 'implementation' && missionRunTicketIndex(mission, run) === ticketIndex);
      // A sibling's completion must not undo a user's Stop or silently retry a failure.
      if (input.ticketIndex === undefined && previous && ['failed', 'cancelled'].includes(previous.status)) continue;
      const runId = this.enqueueImplementationRun(mission, ticketIndex, repositoryPath, input);
      runIds.push(runId);
      busyRepositories.add(repositoryPath);
    }
    return runIds;
  }

  private enqueueRun(mission: Mission, input: { memberId?: string; ticketIndex?: number; feedback?: string }): string {
    const execution = mission.execution;
    if (!execution) throw new Error('Configure the Mission team first.');
    const previousOrchestratorRun = mission.stage === 'tickets' || mission.stage === 'review'
      ? execution.runs.slice().reverse().find(run => (run.stage === 'requirements' || run.stage === 'tickets') && run.workerId)
      : undefined;
    const memberId = input.memberId ?? previousOrchestratorRun?.memberId ?? execution.memberIds[0]!;
    const member = this.agent(memberId);
    if (!execution.memberIds.includes(memberId) || !member || member.teamId !== execution.teamId) throw new Error('The selected team member is unavailable.');
    if (input.feedback !== undefined && (typeof input.feedback !== 'string' || input.feedback.length > 20_000)) throw new Error('Invalid revision feedback.');
    const runId = createEntityId('mission-run');
    execution.runs.push({ id: runId, stage: mission.stage, memberId, ...(previousOrchestratorRun?.workerId ? { workerId: previousOrchestratorRun.workerId } : {}), status: 'preparing', skills: [], feedback: input.feedback?.trim() ?? '', startedAt: new Date().toISOString() });
    return runId;
  }

  private enqueueImplementationRun(
    mission: Mission,
    ticketIndex: number,
    repositoryPath: string,
    input: { memberId?: string; feedback?: string },
  ): string {
    const execution = mission.execution!;
    const repositoryWorker = execution.runs.slice().reverse().find(run => (
      run.stage === 'implementation' && run.repositoryPath === repositoryPath && run.workerId
    ));
    const memberId = input.memberId ?? repositoryWorker?.memberId ?? execution.memberIds[ticketIndex % execution.memberIds.length]!;
    const member = this.agent(memberId);
    if (!execution.memberIds.includes(memberId) || !member || member.teamId !== execution.teamId) throw new Error('The selected team member is unavailable.');
    if (input.feedback !== undefined && (typeof input.feedback !== 'string' || input.feedback.length > 20_000)) throw new Error('Invalid revision feedback.');
    const runId = createEntityId('mission-run');
    execution.runs.push({
      id: runId,
      stage: 'implementation',
      memberId,
      // Parallel assignments get their own conversation, including retries. No busy
      // or accepted-but-still-finishing repository worker can be reassigned.
      ...(!execution.parallelImplementation && repositoryWorker?.workerId ? { workerId: repositoryWorker.workerId } : {}),
      ticketIndex,
      ticketId: (mission.artifacts.tickets[ticketIndex]!.id ??= createEntityId('mission-ticket')),
      repositoryPath,
      status: 'preparing',
      skills: [],
      feedback: input.feedback?.trim() ?? '',
      startedAt: new Date().toISOString(),
    });
    return runId;
  }

  private acceptImplementationResult(mission: Mission, run: MissionRun): boolean {
    const index = missionRunTicketIndex(mission, run);
    const result = run.implementationResult;
    if (index === undefined || !mission.artifacts.tickets[index] || !result) throw new Error('Implementation evidence is incomplete.');
    const wasComplete = mission.artifacts.tickets.every(ticket => ticket.done);
    mission.artifacts.tickets[index]!.done = true;
    mission.artifacts.implementation = {
      changes: [mission.artifacts.implementation.changes, result.changes].filter(Boolean).join('\n\n'),
      tests: [mission.artifacts.implementation.tests, result.tests].filter(Boolean).join('\n\n'),
    };
    run.status = 'accepted';
    return !wasComplete && mission.artifacts.tickets.every(ticket => ticket.done);
  }

  private async notifyImplementationComplete(mission: Mission): Promise<void> {
    const leadId = missionLeadAgentId(mission);
    if (!leadId || !this.agent(leadId)) return;
    const report = [
      `Mission orchestrator update: all ${mission.artifacts.tickets.length} implementation tickets are complete.`,
      `Mission: ${mission.outcome} (${mission.id}).`,
      'Implementation evidence is saved. Read it with read-mission-artifact for stage="implementation".',
      'Give the user a concise completion update. The Mission remains in Implementation until the user chooses to continue to Review. This message does not authorize Review, stage advancement, push, merge or PR creation.',
    ].join('\n');
    await this.ports.continueStage(leadId, `<context>\n${report.replace(/<\/?context>/giu, tag => tag.replace('<', '&lt;'))}\n</context>`);
  }

  private async persistImplementationArtifact(mission: Mission): Promise<void> {
    const content = [
      '# Implementation evidence',
      '',
      '## Changes',
      '',
      mission.artifacts.implementation.changes,
      '',
      '## Verification',
      '',
      mission.artifacts.implementation.tests,
    ].join('\n');
    const stored = await this.ports.writeArtifact(mission.id, 'implementation', content);
    const currentRevision = mission.artifactFiles?.implementation?.revision ?? 0;
    (mission.artifactFiles ??= {}).implementation = {
      revision: currentRevision + 1,
      size: stored.size,
      updatedAt: new Date().toISOString(),
    };
  }

  private agent(id: string | undefined): Agent | undefined { return missionAgent(this.ports.snapshot, id); }
  private dispatchRuns(missionId: string, runIds: string[], submittingAgentId?: string): void {
    for (const runId of runIds) {
      const run = this.requireMission(missionId).execution!.runs.find(candidate => candidate.id === runId)!;
      const worker = this.agent(run.workerId);
      // Only the worker being reused must wait for its previous provider turn.
      if (worker && (worker.id === submittingAgentId || ['working', 'awaitingInput'].includes(worker.status.type))) {
        const pending = this.postTurnLaunches.get(worker.id)?.runIds ?? [];
        this.postTurnLaunches.set(worker.id, { missionId, runIds: [...new Set([...pending, runId])] });
      } else {
        void this.startLaunch(missionId, runId);
      }
    }
  }
  private requireNoActiveRun(mission: Mission): void {
    if (pendingMissionRun(mission)) throw new Error('Review or stop the existing run first.');
    if (mission.execution?.runs.some(run => { const worker = this.agent(run.workerId); return worker && ['working', 'awaitingInput'].includes(worker.status.type); })) throw new Error('A mission worker is still active. Stop it before starting another run.');
  }
  private async change(input: { id: string; revision: number }, mutate: (mission: Mission) => void, allowCompleted = false): Promise<void> {
    await this.ports.missions.change(input.id, mission => {
      if (mission.revision !== input.revision) throw new Error('This mission changed. Reload before continuing.');
      if (!allowCompleted && mission.status === 'completed') throw new Error('Reopen the completed mission before starting work.');
      mutate(mission);
    });
    await this.ports.publish();
  }

  private async changeAsync(input: { id: string; revision: number }, mutate: (mission: Mission) => Promise<void>, allowCompleted = false): Promise<void> {
    await this.ports.missions.changeAsync(input.id, async mission => {
      if (mission.revision !== input.revision) throw new Error('This mission changed. Reload before continuing.');
      if (!allowCompleted && mission.status === 'completed') throw new Error('Reopen the completed mission before starting work.');
      await mutate(mission);
    });
    await this.ports.publish();
  }
}

function missionFindingFixPrompt(mission: Mission, findings: MissionReviewFinding[]): string {
  const workspacePaths = new Map((mission.execution?.workspaces ?? []).map(workspace => [workspace.repositoryPath, workspace.path]));
  const context = [
    ...findings.flatMap(finding => [
      `${finding.id}: [${finding.priority.toUpperCase()}] ${finding.title}`,
      `Repository: ${finding.repositoryPath}`,
      `Mission worktree: ${workspacePaths.get(finding.repositoryPath) ?? 'unavailable'}`,
      ...(finding.location ? [`Location: ${finding.location.file}${finding.location.line ? `:${finding.location.line}` : ''}`] : []),
      finding.body,
      '',
    ]),
    'Load mission-review through read-skill for remediation. Fix only the selected findings in their mapped Mission worktrees; coherent local commits are authorized, not push, merge or PR creation. Record each verified committed fix with update-mission-review-finding; no new Review submission or round is authorized.',
    'Korus reports your recorded fixes and any unresolved findings to the Mission lead when this turn ends. Include verification and commit references in each finding’s evidence; leave blocked findings unresolved.',
  ].join('\n');
  return `<context>\n${context.replace(/<\/?context>/giu, tag => tag.replace('<', '&lt;'))}\n</context>\n\nFix the ${findings.length} finding${findings.length === 1 ? '' : 's'} I selected.`;
}

function missionRemediationReport(mission: Mission, findings: MissionReviewFinding[]): string {
  const report = [
    `Mission Review remediation report: ${mission.outcome} (${mission.id}).`,
    ...findings.flatMap(finding => [
      `Repository: ${finding.repositoryPath}`,
      `${finding.id}: ${finding.title} — ${finding.remediation.state === 'fixed' ? 'fixed' : 'unresolved'}`,
      ...(finding.remediation.state === 'fixed' && finding.remediation.evidence ? [`Verification: ${finding.remediation.evidence}`] : []),
    ]),
    'Give the user a concise status update. Other repositories may still be remediating. This report does not authorize a new Review round, stage advancement, push, merge or PR creation.',
  ].join('\n');
  return `<context>\n${report.replace(/<\/?context>/giu, tag => tag.replace('<', '&lt;'))}\n</context>`;
}
