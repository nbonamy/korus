import { computed, reactive } from 'vue';
import type { Agent, SidePanelMarkdownRequest } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import { missionAgentIds } from '@workspace/core/mission-attention';
import { localizedText } from '../i18n/errors';
import { translate } from '../i18n';

export type PendingMissionDocument = SidePanelMarkdownRequest & {
  missionId: string;
  agentId: string;
  title: string;
};

/** Requests belong to the Mission, independently of its selected conversation. */
export function useMissionDocuments(options: {
  missions: () => readonly Mission[];
  agents: () => readonly Agent[];
  activeMissionId: () => string | null;
  currentAgentId: () => string | undefined;
  open: (document: SidePanelMarkdownRequest) => void;
}) {
  const requests = reactive(new Map<string, PendingMissionDocument>());
  const pending = computed(() => requests.get(options.activeMissionId() ?? '') ?? null);

  function request(input: SidePanelMarkdownRequest): boolean {
    if (input.purpose === 'plan') return false;
    const agentId = input.agentId ?? options.currentAgentId();
    const agent = options.agents().find(agent => agent.id === agentId);
    if (!agent) return false;
    const missions = options.missions().filter(mission => missionAgentIds(mission).includes(agent.id));
    const mission = missions.find(mission => mission.id === options.activeMissionId()) ?? missions[0];
    if (!mission) return false;
    requests.set(mission.id, {
      ...input, missionId: mission.id, agentId: agent.id,
      title: (localizedText(input.title, translate) ?? input.path?.split(/[\\/]/u).at(-1)) || translate('surface.appShell.markdown'),
    });
    return true;
  }

  function dismiss(): void {
    const id = options.activeMissionId();
    if (id) requests.delete(id);
  }

  function confirm(): void {
    if (!pending.value) return;
    options.open(pending.value);
    dismiss();
  }

  return { pending, request, confirm, dismiss };
}
