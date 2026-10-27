<template>
  <section class="mission-ship" :aria-label="t('missions.shipBoard')">
    <header class="mission-ship__summary">
      <p>{{ t('missions.shipRepositoryCount', { complete: completedCount, total: deliveries.length }) }}</p>
      <div role="progressbar" :aria-label="t('missions.shipRepositoryCount', { complete: completedCount, total: deliveries.length })" :aria-valuenow="completedCount" aria-valuemin="0" :aria-valuemax="deliveries.length">
        <span :style="{ width: `${progressPercent}%` }" />
      </div>
    </header>

    <div class="mission-ship__grid">
      <article v-for="delivery in deliveries" :key="delivery.repositoryPath" class="mission-ship__card" :data-status="delivery.status">
        <header class="mission-ship__card-header">
          <button class="mission-ship__repository" type="button" :disabled="!agent(delivery.agentId)" :aria-label="t('missions.shipOpenConversation', { repository: repositoryName(delivery.repositoryPath) })" @click="emit('open-conversation', delivery.agentId)">
            <GitForkIcon aria-hidden="true" />
            <span><strong>{{ repositoryName(delivery.repositoryPath) }}</strong><small>{{ workspaceBranch(delivery.repositoryPath) }}</small></span>
            <ArrowRightIcon aria-hidden="true" />
          </button>
          <div class="mission-ship__status" :data-status="delivery.status">
            <CheckIcon v-if="delivery.status !== 'pending'" aria-hidden="true" />
            {{ statusLabel(delivery) }}
          </div>
        </header>
        <template v-if="delivery.status === 'pending'">
          <p>{{ t(isGitLab(delivery) ? 'missions.shipMergeActionsHint' : 'missions.shipActionsHint') }}</p>
          <p v-if="mission.execution?.debugFixture" class="mission-ship__debug">{{ t('missions.shipDebugFixture') }}</p>
          <div v-else-if="agent(delivery.agentId)" class="mission-ship__actions">
            <MissionWorkspaceOpenIn
              v-if="openInApplications && workspacePath(delivery.repositoryPath)"
              :agent="agent(delivery.agentId)!"
              :available="openInAvailable"
              :catalog="openInApplications"
              :workspace-path="workspacePath(delivery.repositoryPath)!"
              @open="emit('open-worktree', $event)"
            />
            <GitWorkflowControl
              :agent="agent(delivery.agentId)!"
              presentation="delivery"
              :git-status="gitStatuses[delivery.agentId]"
              :get-workflow="getWorkflow"
              :generate-message="generateMessage"
              :commit-changes="commitChanges"
              :push-branch="pushBranch"
              :create-pull-request="createPullRequest"
              :merge-branch="mergeBranch"
              :report-back-agents="reportRecipients(delivery.agentId)"
              :update-from-base="updateFromBase"
              @delivery-complete="recordDelivery(delivery.repositoryPath, $event)"
            />
          </div>
          <p v-else class="mission-ship__error" role="alert">{{ t('missions.shipAgentUnavailable') }}</p>
          <p v-if="errors[delivery.repositoryPath]" class="mission-ship__error" role="alert">{{ errors[delivery.repositoryPath] }}</p>
        </template>
        <a v-else-if="delivery.pullRequest" class="mission-ship__pull-request" :href="delivery.pullRequest.url" target="_blank" rel="noreferrer">
          {{ t(isGitLab(delivery) ? 'missions.shipMergeRequest' : 'missions.shipPullRequest', { number: delivery.pullRequest.number }) }} <ArrowRightIcon aria-hidden="true" />
        </a>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, AgentGitCommitInput, AgentGitMergeInput, AgentGitMessageGenerationInput, AgentGitMessageGenerationResult, AgentGitPullRequestInput, AgentGitPushInput, AgentGitStatus, AgentGitUpdateFromBaseInput, AgentGitUpdateFromBaseResult, AgentGitWorkflow, OpenInApplicationCatalog, Team } from '@workspace/core/contracts';
import { repositoryPeersForAgent } from '@workspace/core/agent-folder';
import { agentDisplayName } from '@workspace/core/agent-display';
import type { Mission } from '@workspace/core/missions';
import type { MissionDelivery, MissionExecutionInput } from '@workspace/core/mission-execution';
import { ArrowRightIcon, CheckIcon, GitForkIcon } from '../shared/icons/app-icons';
import GitWorkflowControl from './GitWorkflowControl.vue';
import MissionWorkspaceOpenIn, { type MissionWorkspaceOpenRequest } from './MissionWorkspaceOpenIn.vue';

const props = defineProps<{
  agents: Agent[];
  teams?: Team[];
  executeMission?: (input: MissionExecutionInput) => Promise<void>;
  gitStatuses: Record<string, AgentGitStatus | null | undefined>;
  mission: Mission;
  getWorkflow?: (agentId: string) => Promise<AgentGitWorkflow>;
  generateMessage?: (agentId: string, input: AgentGitMessageGenerationInput) => Promise<AgentGitMessageGenerationResult>;
  commitChanges?: (agentId: string, input: AgentGitCommitInput) => Promise<AgentGitWorkflow>;
  pushBranch?: (agentId: string, input: AgentGitPushInput) => Promise<AgentGitWorkflow>;
  createPullRequest?: (agentId: string, input: AgentGitPullRequestInput) => Promise<AgentGitWorkflow>;
  mergeBranch?: (agentId: string, input: AgentGitMergeInput) => Promise<AgentGitWorkflow>;
  updateFromBase?: (agentId: string, input: AgentGitUpdateFromBaseInput) => Promise<AgentGitUpdateFromBaseResult>;
  openInAvailable?: boolean;
  openInApplications?: OpenInApplicationCatalog;
}>();
const emit = defineEmits<{
  'open-conversation': [agentId: string];
  'open-worktree': [request: MissionWorkspaceOpenRequest];
}>();
const { t } = useI18n();
const errors = reactive<Record<string, string>>({});
const deliveries = computed(() => props.mission.execution?.deliveries ?? []);
const completedCount = computed(() => deliveries.value.filter(delivery => delivery.status !== 'pending').length);
const progressPercent = computed(() => deliveries.value.length ? Math.round(completedCount.value / deliveries.value.length * 100) : 0);

function agent(agentId: string): Agent | undefined { return props.agents.find(candidate => candidate.id === agentId); }
function reportRecipients(agentId: string) {
  const source = agent(agentId);
  return source ? repositoryPeersForAgent(source, { agents: props.agents, teams: props.teams ?? [] })
    .map(candidate => ({ id: candidate.id, name: agentDisplayName(candidate) })) : [];
}
function repositoryName(path: string): string { return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path; }
function workspacePath(repositoryPath: string): string | undefined { return props.mission.execution?.workspaces?.find(workspace => workspace.repositoryPath === repositoryPath)?.path; }
function workspaceBranch(repositoryPath: string): string { return props.mission.execution?.workspaces?.find(workspace => workspace.repositoryPath === repositoryPath)?.branch ?? repositoryPath; }
function isGitLab(delivery: MissionDelivery): boolean {
  return delivery.pullRequest?.url.startsWith('https://gitlab.com/') ?? (props.gitStatuses[delivery.agentId]?.repositoryProvider === 'gitlab');
}
function statusLabel(delivery: MissionDelivery): string {
  if (delivery.status === 'pullRequestCreated') return t(isGitLab(delivery) ? 'missions.shipMergeRequestCreated' : 'missions.shipPullRequestCreated');
  if (delivery.status === 'merged') return t('missions.shipMerged');
  return t('missions.shipPending');
}
async function recordDelivery(repositoryPath: string, result: { kind: 'pullRequest'; number: number; url: string } | { kind: 'merge' }): Promise<void> {
  // Merges are recorded by the backend before cleanup can unmount this control.
  if (result.kind === 'merge') return;
  errors[repositoryPath] = '';
  try {
    if (!props.executeMission) throw new Error('Mission delivery is unavailable.');
    await props.executeMission({ id: props.mission.id, revision: props.mission.revision, action: 'recordDelivery', repositoryPath, result });
  } catch (cause) {
    errors[repositoryPath] = cause instanceof Error ? cause.message : String(cause);
  }
}
</script>

<style scoped>
.mission-ship {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.mission-ship__summary {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.mission-ship__summary p,
.mission-ship__card p {
  margin: 0;
}

.mission-ship__summary p,
.mission-ship__repository small,
.mission-ship__card > p {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.mission-ship__summary [role="progressbar"] {
  width: 140px;
  height: 4px;
  flex: 0 1 140px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--color-surface-high);
}

.mission-ship__summary [role="progressbar"] span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
  transition: width 180ms ease;
}

.mission-ship__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-6);
}

.mission-ship__card {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
}

.mission-ship__card[data-status="pullRequestCreated"],
.mission-ship__card[data-status="merged"] {
  border-color: var(--color-success);
}

.mission-ship__card-header {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-6);
}

.mission-ship__repository {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.mission-ship__repository > svg {
  width: var(--icon-md);
  height: var(--icon-md);
  color: var(--color-text-muted);
}

.mission-ship__repository span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
}

.mission-ship__repository strong,
.mission-ship__repository small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mission-ship__status {
  display: inline-flex;
  width: fit-content;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  color: var(--color-on-primary-container);
  background: var(--color-primary-container);
  font-size: var(--font-size-12);
}

.mission-ship__status[data-status="pullRequestCreated"],
.mission-ship__status[data-status="merged"] {
  color: var(--color-on-success-container);
  background: var(--color-success-container);
}

.mission-ship__status svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.mission-ship__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  justify-content: flex-start;
}

.mission-ship__pull-request {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-primary);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
}

.mission-ship__pull-request svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.mission-ship__error {
  color: var(--color-error) !important;
}

.mission-ship__debug {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}
</style>
