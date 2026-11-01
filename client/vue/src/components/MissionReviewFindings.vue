<template>
  <section class="mission-review-findings" :aria-label="t('missions.reviewFindings')">
    <header>
      <div>
        <h2>{{ t('missions.reviewFindings') }}</h2>
        <span>{{ t('missions.reviewFindingCount', { count: findings.length }) }}</span>
      </div>
      <button
        v-if="openSelectedCount && canRemediate"
        class="app-button app-button--primary"
        type="button"
        :disabled="busy"
        @click="fixSelected"
      >
        {{ t('missions.fixSelected', { count: openSelectedCount }) }}
      </button>
      <button
        v-else-if="canRerunReview"
        class="app-button app-button--primary"
        type="button"
        :disabled="busy"
        @click="rerunReview"
      >
        {{ t('missions.rerunReview') }}
      </button>
    </header>

    <p v-if="error" class="mission-review-findings__error" role="alert">{{ error }}</p>
    <p v-if="!findings.length" class="mission-review-findings__empty">{{ t('missions.noReviewFindings') }}</p>

    <ReviewFindingList
      v-else
      :findings="findingItems"
      :selectable="canArbitrate"
      :clarifiable="canArbitrate"
      :clarify-label="t('missions.chatAboutReviewFinding')"
      :busy="busy"
      @select="selectFinding"
      @clarify="chatAboutFinding"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Mission, MissionReviewFinding } from '@workspace/core/missions';
import type { MissionExecutionInput } from '@workspace/core/mission-execution';
import ReviewFindingList, { type ReviewFindingListItem } from './ReviewFindingList.vue';

const props = defineProps<{
  mission: Mission;
  executeMission?: (input: MissionExecutionInput) => Promise<void>;
  readOnly?: boolean;
}>();
const emit = defineEmits<{ 'chat-about-finding': [finding: MissionReviewFinding] }>();
const { t } = useI18n();
const busy = ref(false);
const error = ref('');
const findings = computed(() => [...(props.mission.artifacts.review.findings ?? [])].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)));
const openSelectedCount = computed(() => findings.value.filter(finding => finding.selected && finding.remediation.state === 'open').length);
const canArbitrate = computed(() => !props.readOnly && props.mission.stage === 'review' && Boolean(
  props.mission.execution?.runs.slice().reverse().find(run => run.stage === 'review' && run.status === 'awaitingReview' && run.proposal),
) && findings.value.some(finding => finding.remediation.state === 'open')
  && !findings.value.some(finding => finding.remediation.state === 'fixing'));
const canRemediate = computed(() => canArbitrate.value);
const canRerunReview = computed(() => !props.readOnly && props.mission.stage === 'review' && findings.value.length > 0 && findings.value.every(finding => (
  finding.remediation.state === 'fixed' || finding.remediation.state === 'skipped'
)));
const findingItems = computed<ReviewFindingListItem[]>(() => findings.value.map(finding => ({
  id: finding.id,
  priority: finding.priority,
  title: finding.title,
  body: finding.body,
  repositoryPath: finding.repositoryPath,
  ...(finding.location ? { location: finding.location, locationInteractive: false } : {}),
  selected: finding.selected,
  selectable: finding.remediation.state === 'open',
  state: finding.remediation.state,
  stateLabel: finding.remediation.state === 'open' ? '' : t(`missions.reviewFindingState.${finding.remediation.state}`),
  ...(finding.remediation.state === 'fixed' ? { evidence: finding.remediation.evidence || t('missions.fixedWithoutEvidence') } : {}),
})));
function priorityRank(priority: MissionReviewFinding['priority']): number {
  return { p0: 0, p1: 1, p2: 2, p3: 3 }[priority];
}
async function run(input: MissionExecutionInput): Promise<void> {
  if (!props.executeMission) return;
  busy.value = true;
  error.value = '';
  try { await props.executeMission(input); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { busy.value = false; }
}
function selectFinding(findingId: string, selected: boolean): void {
  void run({ id: props.mission.id, revision: props.mission.revision, action: 'selectReviewFinding', findingId, selected });
}
function fixSelected(): void {
  void run({ id: props.mission.id, revision: props.mission.revision, action: 'fixSelectedReviewFindings' });
}
function rerunReview(): void {
  void run({ id: props.mission.id, revision: props.mission.revision, action: 'rerunReview' });
}
function chatAboutFinding(findingId: string): void {
  const finding = findings.value.find(candidate => candidate.id === findingId);
  if (finding) emit('chat-about-finding', finding);
}
</script>

<style scoped>
.mission-review-findings { display: grid; gap: var(--space-4); margin-bottom: var(--space-8); }
header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
header > div { display: grid; gap: var(--space-1); }
h2 { margin: 0; font-size: var(--font-size-16); }
header span, .mission-review-findings__empty { color: var(--color-text-muted); font-size: var(--font-size-12); }
.mission-review-findings__error { margin: 0; color: var(--color-error); }
</style>
