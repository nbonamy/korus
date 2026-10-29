import { createEntityId } from '@workspace/core/ids';
import type { AppSnapshot } from '@workspace/core/contracts';
import { isMissionArtifacts, sameMissionTicketWork, type Mission, type MissionReviewFinding, type MissionStage, type MissionTicket } from '@workspace/core/missions';
import { missionWorkflow } from '@workspace/core/mission-workflows';
import { missionRunTicketIndex, missionRunAssignment, missionDeveloperInstructions, type MissionArtifactReadResult, type MissionArtifactWriteInput, type MissionExecutionInput, type MissionReviewFindingInput, type MissionReviewFindingUpdateInput, type MissionTicketDraftInput, type MissionTicketDraftResult, type MissionToolContext } from '@workspace/core/mission-execution';
import type { MissionService } from './mission-service';
import { missionTeamRepositories } from './mission-execution-policy';

export type MissionAgentToolsPorts = {
  snapshot: AppSnapshot;
  missions: MissionService;
  publish(): Promise<unknown>;
  readArtifact(missionId: string, stage: MissionStage): Promise<string>;
  writeArtifact(missionId: string, stage: MissionStage, content: string): Promise<{ size: number }>;
  validateRepository(path: string): Promise<void>;
};

export class MissionAgentTools {
  constructor(
    private readonly ports: MissionAgentToolsPorts,
    private readonly executeMission: (input: MissionExecutionInput) => Promise<void>,
  ) {}

  contextForAgent(agentId: string): MissionToolContext | undefined {
    let historicalContext: MissionToolContext | undefined;
    for (const mission of this.ports.snapshot.missions ?? []) {
      // Membership outlives a turn or run. Mutation guards below still enforce ownership.
      const run = mission.execution?.runs.slice().reverse().find(run => run.workerId === agentId);
      if (run) {
        const assignment = missionRunAssignment(mission, run);
        const context = { missionId: mission.id, runId: run.id, stage: run.stage, ...(assignment ? { assignment } : {}) };
        if (run.stage === mission.stage) return context;
        historicalContext ??= context;
      }
      if (mission.stage !== 'review') continue;
      const remediationRepository = mission.artifacts.review.findings?.find(finding => (
        finding.remediation.state === 'fixing' && this.implementationWorkerId(mission, finding.repositoryPath) === agentId
      ))?.repositoryPath;
      if (!remediationRepository) continue;
      const reviewRun = mission.execution?.runs.slice().reverse().find(candidate => (
        candidate.stage === 'review' && ['running', 'awaitingReview'].includes(candidate.status)
      ));
      if (reviewRun) return { missionId: mission.id, runId: reviewRun.id, stage: 'review' };
    }
    return historicalContext;
  }

  ownsWritableRun(mission: Mission, runId: string, agentId: string): boolean {
    const runs = mission.execution?.runs ?? [];
    const index = runs.findIndex(run => run.id === runId);
    const run = runs[index];
    if (!run || run.workerId !== agentId || mission.status === 'completed' || run.stage !== mission.stage
      || !['running', 'awaitingReview', 'failed'].includes(run.status)) return false;
    if (run.stage === 'implementation' && missionRunTicketIndex(mission, run) === undefined) return false;
    // A failed assignment can recover, but cannot supersede a replacement or a newer ticket for this worker.
    return !runs.slice(index + 1).some(candidate => candidate.stage === run.stage
      && (run.stage !== 'implementation' || candidate.ticketIndex === run.ticketIndex || candidate.workerId === agentId));
  }

  developerInstructionsForAgent(agentId: string): string | undefined {
    const context = this.contextForAgent(agentId);
    if (!context) return undefined;
    const mission = this.requireMission(context.missionId);
    const run = mission.execution!.runs.find(candidate => candidate.id === context.runId)!;
    if (run.workerId === agentId && !this.ownsWritableRun(mission, run.id, agentId)) return undefined;
    return missionDeveloperInstructions(mission, run, missionTeamRepositories(this.ports.snapshot, mission));
  }

  listArtifacts(agentId: string) {
    const context = this.requireContext(agentId);
    const mission = this.requireMission(context.missionId);
    return missionWorkflow(mission.workflow.type).stages.flatMap(stage => {
      const file = mission.artifactFiles?.[stage];
      return file ? [{ stage, ...file }] : [];
    });
  }

  async readArtifact(agentId: string, stage: MissionStage): Promise<MissionArtifactReadResult> {
    const context = this.requireContext(agentId);
    return this.readArtifactForMission(context.missionId, stage);
  }

  async readArtifactForMission(missionId: string, stage: MissionStage): Promise<MissionArtifactReadResult> {
    const mission = this.requireMission(missionId);
    if (!missionWorkflow(mission.workflow.type).stages.includes(stage)) throw new Error('Invalid mission artifact stage.');
    const file = mission.artifactFiles?.[stage];
    if (!file) throw new Error('Mission artifact not found.');
    return { stage, content: await this.ports.readArtifact(mission.id, stage), revision: file.revision, updatedAt: file.updatedAt };
  }

  async writeArtifact(agentId: string, input: MissionArtifactWriteInput): Promise<MissionArtifactReadResult> {
    const context = this.requireContext(agentId);
    const mission = this.requireMission(context.missionId);
    if (!input || !missionWorkflow(mission.workflow.type).stages.includes(input.stage) || typeof input.content !== 'string') throw new Error('Invalid mission artifact.');
    if (input.stage !== context.stage) throw new Error('This agent can write only its assigned stage artifact.');
    if (input.stage === 'implementation') throw new Error('Submit implementation evidence with the assigned ticket result.');
    const result = await this.ports.missions.changeAsync(context.missionId, async current => {
      const run = current.execution?.runs.find(run => run.id === context.runId);
      if (!run || !this.ownsWritableRun(current, run.id, agentId) || run.stage !== input.stage) {
        throw new Error('This agent is not working on the active mission stage.');
      }
      const currentRevision = current.artifactFiles?.[input.stage]?.revision ?? 0;
      if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
        throw new Error('This mission artifact changed. Read it again before writing.');
      }
      const stored = await this.ports.writeArtifact(current.id, input.stage, input.content);
      const updatedAt = new Date().toISOString();
      (current.artifactFiles ??= {})[input.stage] = { revision: currentRevision + 1, size: stored.size, updatedAt };
      return { stage: input.stage, content: input.content, revision: currentRevision + 1, updatedAt };
    });
    await this.ports.publish();
    return result;
  }

  async upsertTicket(agentId: string, input: MissionTicketDraftInput): Promise<MissionTicketDraftResult> {
    const context = this.requireContext(agentId);
    if (context.stage !== 'tickets' || !input || typeof input.title !== 'string' || typeof input.body !== 'string'
      || typeof input.repositoryPath !== 'string'
      || (input.expectedRevision !== undefined && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0))
      || (input.ticketId !== undefined && typeof input.ticketId !== 'string')
      || (input.reference !== undefined && typeof input.reference !== 'string')
      || (input.blockedByTicketIds !== undefined && (!Array.isArray(input.blockedByTicketIds) || input.blockedByTicketIds.some(id => typeof id !== 'string')))) {
      throw new Error('Invalid Mission ticket draft.');
    }
    const title = input.title.trim();
    const body = input.body.trim();
    const repositoryPath = input.repositoryPath.trim();
    const reference = input.reference?.trim();
    const mission = this.requireMission(context.missionId);
    if (!title || title.length > 500 || /[\r\n]/.test(title) || !body || body.length > 100_000 || !repositoryPath || (reference !== undefined && (!reference || reference.length > 100_000))) {
      throw new Error('Mission ticket title, body, repository, or reference is invalid.');
    }
    if (!missionTeamRepositories(this.ports.snapshot, mission).includes(repositoryPath)) throw new Error('Choose a repository represented in this Mission team.');
    await this.ports.validateRepository(repositoryPath);
    const result = await this.ports.missions.changeAsync(context.missionId, async mission => {
      const run = mission.execution?.runs.find(candidate => candidate.id === context.runId);
      if (!run || !this.ownsWritableRun(mission, run.id, agentId) || run.stage !== 'tickets') {
        throw new Error('This agent is not working on the active Tickets stage.');
      }
      const currentRevision = mission.artifactFiles?.tickets?.revision ?? 0;
      if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) throw new Error('This mission artifact changed. Read it again before writing.');
      const drafts = structuredClone(run.draftTickets ?? []);
      const index = input.ticketId === undefined ? drafts.length : drafts.findIndex(ticket => ticket.id === input.ticketId);
      if (input.ticketId !== undefined && index < 0) throw new Error('Mission ticket draft not found.');
      const ticketId = input.ticketId ?? createEntityId('mission-ticket');
      const blockerIds = [...new Set(input.blockedByTicketIds ?? [])];
      if (blockerIds.includes(ticketId)) throw new Error('A Mission ticket cannot block itself.');
      const dependsOn = blockerIds.map(blockerId => {
        const blockerIndex = drafts.findIndex(ticket => ticket.id === blockerId);
        if (blockerIndex < 0) throw new Error(`Blocking Mission ticket '${blockerId}' was not found.`);
        return blockerIndex;
      });
      const ticket: MissionTicket = {
        id: ticketId,
        title,
        body,
        repositoryPath,
        done: false,
        ...(reference ? { reference } : {}),
        ...(dependsOn.length ? { dependsOn } : {}),
      };
      if (input.ticketId === undefined) {
        const duplicateIndex = drafts.findIndex(existing => sameMissionTicketWork(existing, ticket));
        const duplicate = drafts[duplicateIndex];
        if (duplicate?.id) return { success: true as const, ticketId: duplicate.id, index: duplicateIndex, artifactRevision: currentRevision };
      }
      const previous = drafts[index];
      if (previous && sameMissionTicketWork(previous, ticket)) {
        return { success: true as const, ticketId, index, artifactRevision: currentRevision };
      }
      if (previous) ticket.revision = (previous.revision ?? 0) + 1;
      if (index === drafts.length) drafts.push(ticket);
      else drafts[index] = ticket;
      if (!isMissionArtifacts({ ...mission.artifacts, tickets: drafts })) throw new Error('Mission ticket dependencies must be acyclic and reference existing tickets.');
      const content = missionTicketsMarkdown(drafts);
      const stored = await this.ports.writeArtifact(mission.id, 'tickets', content);
      const updatedAt = new Date().toISOString();
      const artifactRevision = (mission.artifactFiles?.tickets?.revision ?? 0) + 1;
      (mission.artifactFiles ??= {}).tickets = { revision: artifactRevision, size: stored.size, updatedAt };
      run.draftTickets = drafts;
      // A changed draft must be resubmitted before the user can approve it.
      delete run.proposal;
      delete run.finishedAt;
      run.status = 'running';
      return { success: true as const, ticketId, index, artifactRevision };
    });
    await this.ports.publish();
    return result;
  }

  async setTitle(agentId: string, title: string): Promise<{ success: true; title: string }> {
    const normalized = title.trim();
    if (!normalized || normalized.length > 200) throw new Error('Mission title must be between 1 and 200 characters.');
    const context = this.contextForAgent(agentId);
    if (!context) throw new Error('This agent is not working on an active mission run.');
    await this.ports.missions.change(context.missionId, mission => {
      const run = mission.execution?.runs.find(run => run.id === context.runId);
      if (!run || !this.ownsWritableRun(mission, run.id, agentId)) {
        throw new Error('This agent is not working on an active mission run.');
      }
      mission.outcome = normalized;
    });
    await this.ports.publish();
    return { success: true, title: normalized };
  }

  async attachRepository(agentId: string, repoPath: string): Promise<{ success: true; repoPath: string }> {
    const context = this.requireContext(agentId);
    const normalized = repoPath.trim();
    const mission = this.requireMission(context.missionId);
    if (!this.ownsWritableRun(mission, context.runId, agentId)) throw new Error('This agent is not working on an active mission run.');
    await this.executeMission({ id: mission.id, revision: mission.revision, action: 'attachRepository', repoPath: normalized });
    return { success: true, repoPath: normalized };
  }

  async reportReviewFinding(agentId: string, input: MissionReviewFindingInput): Promise<MissionReviewFinding> {
    const context = this.requireReviewContext(agentId);
    const title = input.title.trim();
    const body = input.body.trim();
    const repositoryPath = input.repositoryPath.trim();
    if (!title || title.length > 80 || !body || !repositoryPath) throw new Error('Mission review finding is invalid.');
    const mission = this.requireMission(context.missionId);
    if (!mission.execution?.workspaces?.some(workspace => workspace.repositoryPath === repositoryPath)) {
      throw new Error('Choose a repository represented in this Mission.');
    }
    let finding!: MissionReviewFinding;
    await this.ports.missions.change(context.missionId, current => {
      this.requireOwnedReviewRun(current, context.runId, agentId);
      const now = new Date().toISOString();
      finding = {
        id: createEntityId('mission-finding'),
        priority: input.priority,
        title,
        body,
        repositoryPath,
        ...(input.location ? { location: { ...input.location } } : {}),
        selected: true,
        remediation: { state: 'open' },
        createdAt: now,
        updatedAt: now,
      };
      (current.artifacts.review.findings ??= []).push(finding);
    });
    await this.ports.publish();
    return structuredClone(finding);
  }

  async updateReviewFinding(agentId: string, input: MissionReviewFindingUpdateInput): Promise<MissionReviewFinding> {
    const context = this.requireReviewContext(agentId);
    const repositoryPath = input.repositoryPath?.trim();
    if (input.repositoryPath !== undefined && !repositoryPath) throw new Error('Mission review finding repository is invalid.');
    let updated!: MissionReviewFinding;
    await this.ports.missions.change(context.missionId, current => {
      const finding = current.artifacts.review.findings?.find(candidate => candidate.id === input.findingId);
      if (!finding) throw new Error('Mission review finding was not found.');
      const ownsReview = this.ownsReviewRun(current, context.runId, agentId);
      const ownsRemediation = current.stage === 'review' && finding.remediation.state === 'fixing'
        && this.implementationWorkerId(current, finding.repositoryPath) === agentId;
      if (!ownsReview && !ownsRemediation) throw new Error('This agent cannot update this Mission Review finding.');
      if (ownsRemediation && !ownsReview && (input.status !== 'fixed' || input.priority !== undefined || input.title !== undefined
        || input.body !== undefined || input.repositoryPath !== undefined || input.location !== undefined)) {
        throw new Error('A remediation worker can only mark its assigned finding fixed with evidence.');
      }
      if (input.status === 'fixed' && finding.remediation.state !== 'fixing') throw new Error('Only a finding being remediated can be marked fixed.');
      if (repositoryPath && !current.execution?.workspaces?.some(workspace => workspace.repositoryPath === repositoryPath)) {
        throw new Error('Choose a repository represented in this Mission.');
      }
      if (input.priority) finding.priority = input.priority;
      if (input.title?.trim()) finding.title = input.title.trim();
      if (input.body?.trim()) finding.body = input.body.trim();
      if (repositoryPath) finding.repositoryPath = repositoryPath;
      if (input.location) finding.location = { ...input.location };
      const now = new Date().toISOString();
      if (input.status === 'fixed') finding.remediation = { state: 'fixed', completedAt: now, ...(input.evidence?.trim() ? { evidence: input.evidence.trim() } : {}) };
      finding.updatedAt = now;
      updated = structuredClone(finding);
    });
    await this.ports.publish();
    return updated;
  }


  private requireContext(agentId: string): MissionToolContext {
    const context = this.contextForAgent(agentId);
    if (!context) throw new Error('This agent is not working on an active mission run.');
    return context;
  }

  private requireReviewContext(agentId: string): MissionToolContext {
    const context = this.requireContext(agentId);
    if (context.stage !== 'review') throw new Error('Mission review finding tools are available only during Review.');
    return context;
  }

  private requireOwnedReviewRun(mission: Mission, runId: string, agentId: string): void {
    if (!this.ownsReviewRun(mission, runId, agentId)) {
      throw new Error('This agent is not working on the active Mission Review stage.');
    }
  }

  private ownsReviewRun(mission: Mission, runId: string, agentId: string): boolean {
    const run = mission.execution?.runs.find(candidate => candidate.id === runId);
    return !!run && run.stage === 'review' && this.ownsWritableRun(mission, runId, agentId);
  }

  private implementationWorkerId(mission: Mission, repositoryPath: string): string | undefined {
    return mission.execution?.runs.slice().reverse().find(run => (
      run.stage === 'implementation' && run.repositoryPath === repositoryPath && run.status === 'accepted' && run.workerId
    ))?.workerId;
  }

  private requireMission(id: string): Mission {
    const mission = this.ports.snapshot.missions?.find(mission => mission.id === id);
    if (!mission) throw new Error('Mission not found.');
    return mission;
  }
}

export function missionTicketsMarkdown(tickets: MissionTicket[]): string {
  return tickets.map((ticket, index) => [
    `# ${String(index + 1).padStart(2, '0')}: ${ticket.title}`,
    `**Ticket ID:** ${ticket.id}`,
    ticket.body,
    `**Repository:** ${ticket.repositoryPath ?? 'Not assigned'}`,
    `**Blocked by:** ${ticket.dependsOn?.length ? ticket.dependsOn.map(blocker => `${String(blocker + 1).padStart(2, '0')}: ${tickets[blocker]?.title ?? 'Unknown ticket'}`).join(', ') : 'None (can start immediately)'}`,
    `**Status:** ${ticket.done ? 'completed' : 'ready-for-agent'}`,
    ticket.reference ? `**External reference:** ${ticket.reference}` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n---\n\n');
}
