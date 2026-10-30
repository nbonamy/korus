import type { AgentBackend, AppSnapshot, BackendModelOption } from '@workspace/core/contracts';
import type { CompanionReviewSetup } from '@workspace/core/companion-review';
import { companionWorkspaceOf } from '@workspace/core/companion-projection';
import { companionTarget } from '@workspace/core/companion-protocol';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { CompanionBackendPort } from './manager';
import { activeReviewForAgent, codeReviewAvailability, preferredReviewBackend } from '@workspace/core/code-review';

export async function readReviewSetup(port: CompanionBackendPort, hostId: string, agentId: string, backend?: AgentBackend): Promise<CompanionReviewSetup> {
  const { snapshot } = await port.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet, { _clientId: 'companion-read' });
  const agent = snapshot.agents.find(agent => agent.id === agentId);
  const team = snapshot.teams.find(team => team.id === agent?.teamId);
  if (!agent || !team || !agent.folder) throw new Error('Review requires a workspace.');
  const backends = companionWorkspaceOf(snapshot).backends?.[team.id] ?? [];
  const preferences = snapshot.general.codeReviewDefaults;
  const selected = backend ?? preferredReviewBackend(agent.backend, backends, preferences?.backend);
  if (!selected || !backends.includes(selected)) throw new Error('Review engine unavailable.');
  const models = await port.request<BackendModelOption[]>(backendMethods.agentModelsList, { agentId, backend: selected, _clientId: 'companion-read' });
  const status = snapshot.agentGitStatuses[agentId];
  const catalog = status?.diffCatalog;
  const review = activeReviewForAgent(snapshot.agents, agent);
  return {
    target: companionTarget(hostId, team, agent), branch: status?.branch ?? null, baseRef: catalog?.branch?.baseRef ?? null,
    ...codeReviewAvailability(agent, status), activeReview: Boolean(review), reviewerAgentId: review?.reviewerAgentId ?? null,
    agentBackend: agent.backend, backend: selected, backends,
    models: models.filter(model => !model.hidden && model.model).map(model => ({ id: model.model!, name: model.displayName,
      efforts: (model.supportedReasoningEfforts ?? []).map(option => option.reasoningEffort),
      tiers: (model.serviceTiers ?? []).map(tier => ({ id: tier.id, name: tier.name })) })),
    ...(preferences ? { preferences } : {}),
  };
}

async function reviewContext(port: CompanionBackendPort, agentId: string) {
  const { snapshot } = await port.request<{ snapshot: AppSnapshot }>(backendMethods.snapshotGet, { _clientId: 'companion-read' });
  const agent = snapshot.agents.find(candidate => candidate.id === agentId);
  if (!agent) throw new Error('Review conversation unavailable.');
  // Failed sessions remain available for retry; initialization's active-review check intentionally excludes them.
  const candidates = snapshot.agents.filter(candidate => candidate.codeReview && candidate.codeReview.status !== 'finished'
    && (candidate.id === agentId || candidate.codeReview.targetAgentId === agentId));
  const reviewer = candidates.find(candidate => candidate.id === agentId)
    ?? candidates.find(candidate => candidate.codeReview?.status !== 'failed') ?? candidates.at(-1);
  return { snapshot, agent, reviewer, session: reviewer?.codeReview };
}

export async function readReviewSession(port: CompanionBackendPort, hostId: string, agentId: string): Promise<import('@workspace/core/companion-review').CompanionReviewDetails> {
  const { snapshot, agent, reviewer, session } = await reviewContext(port, agentId);
  const team = snapshot.teams.find(candidate => candidate.id === agent.teamId);
  if (!team) throw new Error('Review team unavailable.');
  return { target: companionTarget(hostId, team, agent), session: session ? {
    id: session.id, targetAgentId: session.targetAgentId, reviewerAgentId: session.reviewerAgentId,
    status: session.status, activeRoundId: session.activeRoundId, updatedAt: session.updatedAt,
    busy: reviewer?.status.type === 'working' || reviewer?.status.type === 'awaitingInput',
    ...(session.automation ? { automation: { state: session.automation.state, ...(session.automation.reason ? { reason: session.automation.reason } : {}) } } : {}),
    rounds: session.rounds.map(round => ({ id: round.id, number: round.number, status: round.status, startedAt: round.startedAt,
      ...(round.completedAt ? { completedAt: round.completedAt } : {}), ...(round.summary ? { summary: round.summary } : {}),
      ...(round.error ? { error: round.error } : {}),
      findings: round.findings.map(finding => ({ ...finding,
        ...(finding.location ? { location: { ...finding.location, file: finding.location.file.replace(/\\/gu, '/').split('/').filter(Boolean).slice(-2).join('/') } } : {}) })) })),
  } : null };
}

export async function actOnReview(port: CompanionBackendPort, agentId: string, input: import('@workspace/core/companion-review').CompanionReviewAction): Promise<void> {
  const { reviewer, session } = await reviewContext(port, agentId);
  if (!reviewer || !session || session.id !== input.sessionId || session.activeRoundId !== input.roundId || session.updatedAt !== input.updatedAt) {
    throw new Error('The review changed. Refresh before trying again.');
  }
  const round = session.rounds.find(candidate => candidate.id === input.roundId);
  if (!round) throw new Error('The review round changed.');
  if (input.action !== 'manual' && input.action !== 'discard') {
    if (session.automation?.state === 'running') throw new Error('Switch to manual before changing this review.');
    if (reviewer.status.type === 'working' || reviewer.status.type === 'awaitingInput') throw new Error('The reviewer is not ready.');
    const arbitration = ['decide', 'discuss', 'submit'].includes(input.action);
    if (arbitration ? session.status !== 'ready' || round.status !== 'ready'
      : input.action === 'again' ? !['readyToFinish', 'failed'].includes(session.status) : session.status !== 'readyToFinish') {
      throw new Error('The review is not ready for this action.');
    }
  }
  if (input.action === 'decide' || input.action === 'discuss') {
    if (!round.findings.some(finding => finding.id === input.findingId)) throw new Error('The finding is unavailable.');
    await port.request(input.action === 'decide' ? backendMethods.agentCodeReviewFindingDecide : backendMethods.agentCodeReviewFindingDiscuss, {
      agentId: reviewer.id, input: { sessionId: session.id, roundId: round.id, findingId: input.findingId,
        ...(input.action === 'decide' ? { decision: input.selected ? 'select' : 'reject' } : { question: input.question }) }, _clientId: 'companion-write',
    });
  } else {
    const method = { submit: backendMethods.agentCodeReviewRoundSubmit, again: backendMethods.agentCodeReviewAgain,
      finish: backendMethods.agentCodeReviewFinish, manual: backendMethods.agentCodeReviewManual, discard: backendMethods.agentCodeReviewDiscard }[input.action];
    await port.request(method, { agentId: reviewer.id, sessionId: session.id, _clientId: 'companion-write' });
  }
}
