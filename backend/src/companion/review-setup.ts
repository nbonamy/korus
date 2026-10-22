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
    models: models.filter(model => !model.hidden && model.model).map(model => ({ id: model.model!, name: model.displayName, efforts: (model.supportedReasoningEfforts ?? []).map(option => option.reasoningEffort) })),
    ...(preferences ? { preferences } : {}),
  };
}
