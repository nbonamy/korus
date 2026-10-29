<template>
  <QuickOpenDialog
    :dialog-label="t('surface.agentQuickOpen.openAgent')"
    :empty-label="t('surface.agentQuickOpen.noMatchingAgents')"
    :input-aria-label="t('surface.agentQuickOpen.searchAgents')"
    :items="items"
    :placeholder="t('surface.agentQuickOpen.placeholder')"
    @close="emit('close')"
    @select="select"
  >
    <template #item="{ item }">
      <span
        class="agent-quick-open__unread"
        :class="{ 'agent-quick-open__unread--visible': unreadAgentIdSet.has(item.id) }"
        aria-hidden="true"
      />
      <AgentQuickOpenIcon
        :agent="agentById.get(item.id)"
        :name="item.label"
        :repository-icons="repositoryIcons ?? {}"
      />
      <span class="agent-quick-open__copy">
        <span class="agent-quick-open__identity">
          <strong>{{ item.label }}</strong>
          <span
            v-if="repositoryByAgentId.get(item.id)"
            class="agent-quick-open__repository"
          >
            @ {{ repositoryByAgentId.get(item.id) }}
          </span>
        </span>
        <small class="agent-quick-open__team">{{ item.detail }}</small>
      </span>
    </template>
  </QuickOpenDialog>
</template>

<script setup lang="ts">
import type { Agent, Team } from '@workspace/core/contracts';
import { agentDisplayName } from '@workspace/core/agent-display';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import QuickOpenDialog, { type QuickOpenItem } from '../shared/QuickOpenDialog.vue';
import AgentQuickOpenIcon from './AgentQuickOpenIcon.vue';

const props = defineProps<{
  agents: Agent[];
  teams: Team[];
  unreadAgentIds: string[];
  repositoryIcons?: Record<string, string>;
}>();
const emit = defineEmits<{
  close: [];
  select: [payload: { agentId: string; teamId: string }];
}>();
const { t } = useI18n();
const unreadAgentIdSet = computed(() => new Set(props.unreadAgentIds));
const agentById = computed(() => new Map(props.agents.map((agent) => [agent.id, agent])));
const repositoryByAgentId = computed(() => new Map(props.agents.flatMap((agent) => (
  agent.workspace?.kind === 'git'
    ? [[agent.id, agent.workspace.repositoryName] as const]
    : []
))));
const teamByAgentId = computed(() => {
  const result = new Map<string, Team>();
  for (const team of props.teams) {
    for (const agentId of team.agentIds) result.set(agentId, team);
  }
  return result;
});
const items = computed<QuickOpenItem[]>(() => props.agents
  .map((agent, index) => {
    const team = agent.teamId
      ? props.teams.find((candidate) => candidate.id === agent.teamId) ?? teamByAgentId.value.get(agent.id)
      : teamByAgentId.value.get(agent.id);
    const label = agentDisplayName(agent);
    const teamName = team?.name ?? t('surface.agentQuickOpen.noTeam');
    return {
      id: agent.id,
      label,
      detail: teamName,
      searchText: `${label} ${teamName} ${agent.workspace?.kind === 'git' ? `${agent.workspace.repositoryName} ${agent.workspace.branch ?? ''}` : ''}`,
      unread: unreadAgentIdSet.value.has(agent.id),
      lastActivityAt: Date.parse(agent.lastActivityAt ?? agent.updatedAt),
      index,
    };
  })
  .sort((left, right) => (
    Number(right.unread) - Number(left.unread)
    || (Number.isFinite(right.lastActivityAt) && Number.isFinite(left.lastActivityAt)
      ? right.lastActivityAt - left.lastActivityAt
      : 0)
    || left.index - right.index
  )));

function select(agentId: string): void {
  const agent = agentById.value.get(agentId);
  const team = agent?.teamId
    ? props.teams.find((candidate) => candidate.id === agent.teamId) ?? teamByAgentId.value.get(agentId)
    : teamByAgentId.value.get(agentId);
  if (!agent || !team) return;
  emit('select', { agentId, teamId: team.id });
}
</script>

<style scoped>
:deep(.quick-open-dialog__item) {
  display: grid;
  grid-template-columns: 6px var(--space-8) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-4);
}

.agent-quick-open__unread {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: transparent;
}

.agent-quick-open__unread--visible {
  background: var(--color-primary);
}

.agent-quick-open__copy {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--space-4);
}

.agent-quick-open__identity {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.agent-quick-open__identity strong,
.agent-quick-open__repository,
.agent-quick-open__team {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-quick-open__identity strong {
  flex: 0 1 auto;
  min-width: 0;
  font-weight: var(--font-weight-medium);
}

.agent-quick-open__repository,
.agent-quick-open__team {
  color: var(--color-text-muted);
}

.agent-quick-open__repository {
  flex: 1 1 auto;
  min-width: 0;
  color: color-mix(in srgb, var(--color-text-muted) 80%, transparent);
  font-weight: 250;
}

.agent-quick-open__team {
  text-align: right;
}
</style>
