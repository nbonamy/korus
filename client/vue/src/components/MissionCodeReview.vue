<template>
  <section class="mission-code-review" :aria-label="t('missions.codeReview')">
    <el-tabs v-model="activeTab" class="mission-code-review__tabs">
      <el-tab-pane name="review" :label="t('missions.reviewTab')">
        <MissionReviewFindings
          v-if="mission"
          :mission="mission"
          :execute-mission="executeMission"
          :read-only="readOnly"
          @chat-about-finding="emit('chat-about-finding', $event)"
        />
        <section v-if="reviewSummary" class="mission-code-review__summary" :aria-label="t('missions.reviewSummary')">
          <MarkdownPanel class="mission-code-review__summary-panel" :content="reviewSummary" />
        </section>
      </el-tab-pane>

      <el-tab-pane name="changes" :label="t('missions.changesTab')">
        <MissionReviewChanges
          :active="activeTab === 'changes'"
          :agent="agent"
          :agents="agents"
          :base-sha="baseSha"
          :git-status="gitStatus"
          :git-statuses="gitStatuses"
          :get-diff="getDiff"
          :mission="mission"
          :open-in-available="openInAvailable"
          :open-in-applications="openInApplications"
          :workspace-path="workspacePath"
          @open-worktree="emit('open-worktree', $event)"
        />
      </el-tab-pane>
    </el-tabs>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Agent, AgentGitDiff, AgentGitDiffTarget, AgentGitStatus, OpenInApplicationCatalog } from '@workspace/core/contracts';
import type { Mission, MissionReviewFinding } from '@workspace/core/missions';
import type { MissionExecutionInput } from '@workspace/core/mission-execution';
import MarkdownPanel from './MarkdownPanel.vue';
import MissionReviewChanges from './MissionReviewChanges.vue';
import MissionReviewFindings from './MissionReviewFindings.vue';
import type { MissionWorkspaceOpenRequest } from './MissionWorkspaceOpenIn.vue';
const props = withDefaults(defineProps<{
  agent: Agent;
  agents?: Agent[];
  baseSha?: string;
  gitStatus?: AgentGitStatus | null;
  gitStatuses?: Record<string, AgentGitStatus>;
  getDiff: (agentId: string, target?: AgentGitDiffTarget) => Promise<AgentGitDiff>;
  openInAvailable?: boolean;
  openInApplications?: OpenInApplicationCatalog;
  readOnly?: boolean;
  workspacePath?: string;
  mission?: Mission;
  executeMission?: (input: MissionExecutionInput) => Promise<void>;
  reviewSummary?: string;
}>(), {
  agents: () => [],
  gitStatuses: () => ({}),
  openInApplications: () => ({ defaultApplication: 'finder', applications: [] }),
});
const emit = defineEmits<{
  'chat-about-finding': [finding: MissionReviewFinding];
  'open-worktree': [request: MissionWorkspaceOpenRequest];
}>();
const { t } = useI18n();
const activeTab = ref<'review' | 'changes'>(props.mission ? 'review' : 'changes');
</script>
<style scoped>
.mission-code-review {
  display: flex;
  flex-direction: column;
  min-height: 240px;
  margin-bottom: var(--space-8);
}

.mission-code-review__tabs {
  min-height: 0;
}

.mission-code-review__summary {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-8);
}

.mission-code-review__summary-panel {
  padding-inline: 0;
}
</style>
