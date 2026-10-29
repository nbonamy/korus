import { isExecutionSelection } from './execution-selection';
import { missionImplementationBusy, pendingMissionRun } from './mission-execution';
import type { AppSnapshot } from './contracts';
import { createEntityId } from './ids';
import type { Mission, MissionArtifacts, MissionExecution, MissionReviewFinding, MissionStage, MissionTicket } from './mission-types';
import { featureStages, findMissionWorkflow, missionWorkflow } from './mission-workflows';

export { featureStages } from './mission-workflows';
export type { CreateMissionInput, DeleteMissionInput, Mission, MissionArtifactFile, MissionArtifacts, MissionReviewDebugState, MissionReviewFinding, MissionStage, MissionTicket, UpdateMissionInput } from './mission-types';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 100_000;
export function isMissionArtifacts(v: unknown): v is MissionArtifacts {
  return record(v) && record(v.requirements) && text(v.requirements.problem) && text(v.requirements.acceptance)
    && Array.isArray(v.tickets) && v.tickets.length <= 200 && v.tickets.every(t => record(t) && (t.id === undefined || (text(t.id) && /^mission-ticket-[a-zA-Z0-9-]+$/.test(t.id))) && (t.revision === undefined || (Number.isInteger(t.revision) && (t.revision as number) >= 0)) && text(t.title) && (t.body === undefined || text(t.body)) && (t.repositoryPath === undefined || (text(t.repositoryPath) && !!t.repositoryPath.trim())) && typeof t.done === 'boolean' && (t.reference === undefined || (text(t.reference) && !!t.reference.trim())) && (t.dependsOn === undefined || (Array.isArray(t.dependsOn) && t.dependsOn.every(n => Number.isInteger(n) && n >= 0)))) && validTicketDependencies(v.tickets as MissionTicket[])
    && record(v.implementation) && text(v.implementation.changes) && text(v.implementation.tests)
    && record(v.review) && text(v.review.summary) && text(v.review.pullRequestUrl)
    && (v.review.findings === undefined || (Array.isArray(v.review.findings) && v.review.findings.length <= 500 && v.review.findings.every(isMissionReviewFinding)))
    && (!v.review.pullRequestUrl || /^https?:\/\//.test(v.review.pullRequestUrl));
}
function isMissionReviewFinding(v: unknown): v is MissionReviewFinding {
  return record(v) && text(v.id) && !!v.id.trim()
    && ['p0', 'p1', 'p2', 'p3'].includes(v.priority as string)
    && text(v.title) && !!v.title.trim() && v.title.length <= 80
    && text(v.body) && !!v.body.trim()
    && text(v.repositoryPath) && !!v.repositoryPath.trim()
    && (v.location === undefined || (record(v.location) && text(v.location.file) && !!v.location.file.trim()
      && (v.location.line === undefined || (Number.isInteger(v.location.line) && (v.location.line as number) > 0))
      && (v.location.endLine === undefined || (Number.isInteger(v.location.endLine) && (v.location.endLine as number) > 0))))
    && typeof v.selected === 'boolean'
    && record(v.remediation) && ['open', 'skipped', 'fixing', 'fixed'].includes(v.remediation.state as string)
    && (v.remediation.state !== 'skipped' || text(v.remediation.startedAt))
    && (v.remediation.state !== 'fixing' || text(v.remediation.startedAt))
    && (v.remediation.state !== 'fixed' || (text(v.remediation.completedAt) && (v.remediation.evidence === undefined || text(v.remediation.evidence))))
    && text(v.createdAt) && text(v.updatedAt);
}
function validTicketDependencies(tickets: MissionTicket[]): boolean {
  const visited = new Set<number>();
  const visiting = new Set<number>();
  const visit = (index: number): boolean => {
    if (visiting.has(index) || !tickets[index]) return false;
    if (visited.has(index)) return true;
    visiting.add(index);
    if (!(tickets[index]!.dependsOn ?? []).every(visit)) return false;
    visiting.delete(index); visited.add(index); return true;
  };
  return tickets.every((_, index) => visit(index));
}
export function missionTicketReady(tickets: MissionTicket[], index: number): boolean {
  const ticket = tickets[index];
  return !!ticket && !ticket.done && (ticket.dependsOn ?? []).every(blocker => tickets[blocker]?.done);
}
/** Compare authored work, independently of completion and execution history. */
export function sameMissionTicketWork(a: MissionTicket, b: MissionTicket): boolean {
  return a.title === b.title && (a.body ?? '') === (b.body ?? '')
    && a.repositoryPath === b.repositoryPath && (a.reference ?? '') === (b.reference ?? '')
    && JSON.stringify([...(a.dependsOn ?? [])].sort((x, y) => x - y)) === JSON.stringify([...(b.dependsOn ?? [])].sort((x, y) => x - y));
}

function isStageAgents(v: unknown): v is Mission['stageAgentIds'] {
  return record(v) && Object.entries(v).every(([k, id]) => featureStages.includes(k as MissionStage) && typeof id === 'string');
}
function isArtifactFiles(v: unknown): v is Mission['artifactFiles'] {
  return record(v) && Object.entries(v).every(([stage, file]) => featureStages.includes(stage as MissionStage)
    && record(file) && Number.isInteger(file.revision) && (file.revision as number) > 0
    && Number.isInteger(file.size) && (file.size as number) >= 0 && text(file.updatedAt));
}
export function isMission(v: unknown): v is Mission {
  const workflowValue = record(v) && record(v.workflow) ? v.workflow : undefined;
  const workflow = findMissionWorkflow(workflowValue?.type);
  return record(v) && text(v.id) && text(v.teamId) && text(v.outcome) && !!v.outcome.trim() && v.outcome.length <= 200
    && !!workflow && workflowValue?.version === workflow.version
    && workflow.stages.includes(v.stage as MissionStage) && ['active', 'completed'].includes(v.status as string)
    && (v.status !== 'completed' || v.stage === 'review' || v.stage === 'ship') && isMissionArtifacts(v.artifacts)
    && (v.artifactFiles === undefined || isArtifactFiles(v.artifactFiles)) && isStageAgents(v.stageAgentIds)
    && (v.execution === undefined || isMissionExecution(v.execution))
    && Number.isInteger(v.revision) && (v.revision as number) >= 0 && text(v.createdAt) && text(v.updatedAt);
}
export function missionStageReady(stage: MissionStage, a: MissionArtifacts): boolean {
  return missionWorkflow('shapeAndShipFeature').stageReady(stage, a);
}
export function createMission(snapshot: AppSnapshot, input: unknown): Mission {
  if (!record(input) || typeof input.outcome !== 'string' || !input.outcome.trim() || input.outcome.trim().length > 200 || !findMissionWorkflow(input.workflowType)
    || typeof input.teamId !== 'string' || typeof input.orchestratorMemberId !== 'string') throw new Error('Invalid mission outcome or workflow.');
  const team = snapshot.teams.find(team => team.id === input.teamId && !team.remoteConnectionId);
  const orchestrator = snapshot.agents.find(agent => agent.id === input.orchestratorMemberId && agent.teamId === team?.id);
  if (!team || !orchestrator) throw new Error('Choose a local team and one of its agents to orchestrate the mission.');
  const now = new Date().toISOString();
  const workflow = findMissionWorkflow(input.workflowType)!;
  const mission: Mission = {
    id: createEntityId('mission'), teamId: team.id, outcome: input.outcome.trim(), workflow: { type: workflow.type, version: workflow.version },
    stage: workflow.stages[0]!, status: 'active', revision: 0, createdAt: now, updatedAt: now,
    artifacts: workflow.createArtifacts(),
    artifactFiles: {},
    stageAgentIds: {},
    execution: { teamId: team.id, memberIds: [...team.agentIds], workspaces: [], runs: [] },
  };
  (snapshot.missions ??= []).push(mission);
  return mission;
}
export function deleteMission(snapshot: AppSnapshot, input: unknown): Mission {
  if (!record(input) || typeof input.id !== 'string' || !Number.isInteger(input.revision)
    || typeof input.deleteWorktrees !== 'boolean' || input.confirmed !== true) throw new Error('Invalid mission deletion.');
  const mission = snapshot.missions?.find(mission => mission.id === input.id);
  if (!mission) throw new Error('Mission not found.');
  if (mission.revision !== input.revision) throw new Error('This mission changed. Reload before deleting it.');
  snapshot.missions = snapshot.missions!.filter(candidate => candidate.id !== mission.id);
  return mission;
}
export function updateMission(snapshot: AppSnapshot, input: unknown): Mission {
  if (!record(input) || !isMissionArtifacts(input.artifacts) || !isStageAgents(input.stageAgentIds) || !['save', 'advance'].includes(input.action as string)) throw new Error('Invalid mission update.');
  const mission = snapshot.missions?.find(m => m.id === input.id);
  if (!mission) throw new Error('Mission not found.');
  if (mission.revision !== input.revision) throw new Error('This mission changed. Reopen it before saving.');
  if (mission.status === 'completed') throw new Error('This mission is completed.');
  if (pendingMissionRun(mission)) throw new Error('Review or stop the current mission run before editing artifacts or advancing.');
  if (missionImplementationBusy(mission, snapshot.agents)) throw new Error('Wait for the implementation worker to stop before editing artifacts or advancing.');
  if (Object.values(input.stageAgentIds).some(id => !snapshot.agents.some(a => a.id === id))) throw new Error('Supporting agent not found.');
  if (input.action === 'advance' && mission.stage === 'ship') throw new Error('Complete delivery from the Ship stage.');
  const artifacts = structuredClone(input.artifacts);
  artifacts.tickets = artifacts.tickets.map((ticket, index) => {
    const previous = ticket.id ? mission.artifacts.tickets.find(candidate => candidate.id === ticket.id)
      : mission.artifacts.tickets[index];
    if (!previous) return ticket;
    if (!sameMissionTicketWork(previous, ticket)) return { ...ticket, done: false, revision: (previous.revision ?? 0) + 1 };
    // A stale artifact form cannot restore completion for a revised ticket.
    return previous.revision === undefined ? ticket : { ...ticket, done: previous.done, revision: previous.revision };
  });
  // Earlier gates remain true even when revising their artifacts in later stages.
  const workflow = missionWorkflow(mission.workflow.type);
  const stageIndex = workflow.stages.indexOf(mission.stage);
  const requiredStages = workflow.stages.slice(0, stageIndex + (input.action === 'advance' ? 1 : 0));
  if (requiredStages.some(stage => !workflow.stageReady(stage, artifacts))) throw new Error('Complete the required stage artifacts before continuing.');
  const updated = { ...mission, artifacts, stageAgentIds: { ...input.stageAgentIds }, revision: mission.revision + 1, updatedAt: new Date().toISOString() };
  if (input.action === 'advance') {
    updated.stage = workflow.stages[stageIndex + 1]!;
  }
  Object.assign(mission, updated);
  return mission;
}

function isMissionExecution(v: unknown): v is MissionExecution {
  return record(v) && text(v.teamId) && (v.repoPath === undefined || text(v.repoPath)) && Array.isArray(v.memberIds) && v.memberIds.every(text)
    && (v.debugFixture === undefined || v.debugFixture === true)
    && (v.parallelImplementation === undefined || typeof v.parallelImplementation === 'boolean')
    && (v.implementationModel === undefined || isExecutionSelection(v.implementationModel))
    && (v.workspaceName === undefined || (text(v.workspaceName) && !!v.workspaceName.trim()))
    && (v.workspaces === undefined || (Array.isArray(v.workspaces) && v.workspaces.every(workspace => record(workspace)
      && (workspace.commitLock === undefined || (record(workspace.commitLock) && text(workspace.commitLock.agentId) && text(workspace.commitLock.runId) && text(workspace.commitLock.turnId)))
      && text(workspace.repositoryPath) && !!workspace.repositoryPath.trim()
      && text(workspace.path) && !!workspace.path.trim() && text(workspace.branch) && !!workspace.branch.trim()
      && (workspace.deleted === undefined || workspace.deleted === true)
      && (workspace.baseSha === undefined || (typeof workspace.baseSha === 'string' && /^[a-f0-9]{40,64}$/.test(workspace.baseSha))))))
    && (v.workspace === undefined || (record(v.workspace) && text(v.workspace.path) && text(v.workspace.branch) && (v.workspace.deleted === undefined || v.workspace.deleted === true) && (v.workspace.baseSha === undefined || (typeof v.workspace.baseSha === 'string' && /^[a-f0-9]{40,64}$/.test(v.workspace.baseSha)))))
    && (v.deliveries === undefined || (Array.isArray(v.deliveries) && v.deliveries.every(isMissionDelivery)
      && new Set(v.deliveries.map(delivery => record(delivery) ? delivery.repositoryPath : undefined)).size === v.deliveries.length))
    && Array.isArray(v.runs) && v.runs.every(run => record(run) && text(run.id) && text(run.memberId)
      && featureStages.includes(run.stage as MissionStage)
      && ['preparing', 'running', 'awaitingReview', 'accepted', 'cancelled', 'failed'].includes(run.status as string)
      && (run.workerId === undefined || text(run.workerId))
      && (run.ticketId === undefined || (text(run.ticketId) && /^mission-ticket-[a-zA-Z0-9-]+$/.test(run.ticketId)))
      && (run.ticketIndex === undefined || (Number.isInteger(run.ticketIndex) && (run.ticketIndex as number) >= 0))
      && (run.ticketRevision === undefined || (Number.isInteger(run.ticketRevision) && (run.ticketRevision as number) >= 0))
      && (run.repositoryPath === undefined || (text(run.repositoryPath) && !!run.repositoryPath.trim()))
      && (run.implementationResult === undefined || (record(run.implementationResult) && text(run.implementationResult.changes) && text(run.implementationResult.tests)))
      && Array.isArray(run.skills) && run.skills.every(skill => record(skill) && text(skill.name) && (skill.path === undefined || text(skill.path)))
      && text(run.feedback) && text(run.startedAt)
      && (run.finishedAt === undefined || text(run.finishedAt))
      && (run.summary === undefined || text(run.summary)) && (run.error === undefined || text(run.error))
      && (run.proposal === undefined || isMissionArtifacts(run.proposal))
      && (run.draftTicketsBaseHash === undefined || (typeof run.draftTicketsBaseHash === 'string' && /^[a-f0-9]{64}$/.test(run.draftTicketsBaseHash)))
      && (run.draftTickets === undefined || isMissionArtifacts({ requirements: { problem: '', acceptance: '' }, tickets: run.draftTickets, implementation: { changes: '', tests: '' }, review: { summary: '', pullRequestUrl: '' } })));
}

function isMissionDelivery(v: unknown): boolean {
  if (!record(v) || !text(v.repositoryPath) || !v.repositoryPath.trim() || !text(v.agentId) || !v.agentId.trim()
    || !['pending', 'pullRequestCreated', 'merged'].includes(v.status as string)
    || (v.mergePendingPush !== undefined && v.mergePendingPush !== true)) return false;
  if (v.status !== 'pullRequestCreated') return v.pullRequest === undefined;
  return record(v.pullRequest) && Number.isInteger(v.pullRequest.number) && (v.pullRequest.number as number) > 0
    && text(v.pullRequest.url) && /^https?:\/\//.test(v.pullRequest.url as string);
}
