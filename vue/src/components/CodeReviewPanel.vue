<template>
  <section class="code-review-panel" :aria-label="$t('surface.codeReviewPanel.codeReview')">
    <div v-if="!session" class="code-review-panel__empty">
      <template v-if="nothingToReview">
        <span class="code-review-panel__empty-icon"><IconCircleCheck aria-hidden="true" /></span>
        <h2>{{ $t('surface.codeReviewPanel.nothingToReview') }}</h2>
        <p>{{ $t('surface.codeReviewPanel.nothingToReviewDescription') }}</p>
      </template>
      <template v-else>
        <span class="code-review-panel__empty-icon"><IconChecklist aria-hidden="true" /></span>
        <h2>{{ $t('surface.codeReviewPanel.reviewThisBranch') }}</h2>
        <div class="code-review-panel__setup">
          <fieldset>
            <legend class="app-section-label">{{ $t('surface.codeReviewPanel.scope') }}</legend>
            <div class="code-review-panel__choices" role="radiogroup">
              <button
                class="code-review-panel__choice"
                :class="{ 'is-selected': scope === 'uncommitted' }"
                type="button"
                role="radio"
                :aria-checked="scope === 'uncommitted'"
                :disabled="!hasUncommittedChanges"
                @click="scope = 'uncommitted'"
              >
                <span class="code-review-panel__choice-content">
                  <FileDiffIcon class="code-review-panel__choice-icon" aria-hidden="true" />
                  <span class="code-review-panel__choice-copy">
                    <strong>{{ $t('surface.codeReviewPanel.uncommittedChanges') }}</strong>
                    <small>{{ uncommittedDescription }}</small>
                  </span>
                </span>
              </button>
              <button
                class="code-review-panel__choice"
                :class="{ 'is-selected': scope === 'branch' }"
                type="button"
                role="radio"
                :aria-checked="scope === 'branch'"
                :disabled="!hasBranchChanges"
                @click="scope = 'branch'"
              >
                <span class="code-review-panel__choice-content">
                  <GitBranchIcon class="code-review-panel__choice-icon" aria-hidden="true" />
                  <span class="code-review-panel__choice-copy">
                    <strong>{{ $t('surface.codeReviewPanel.currentBranch') }}</strong>
                    <small>{{ branchDescription }}</small>
                  </span>
                </span>
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend class="app-section-label">{{ $t('surface.codeReviewPanel.reviewerThread') }}</legend>
            <div class="code-review-panel__choices" role="radiogroup">
              <button
                class="code-review-panel__choice"
                :class="{ 'is-selected': threadMode === 'independent' }"
                type="button"
                role="radio"
                :aria-checked="threadMode === 'independent'"
                @click="threadMode = 'independent'"
              >
                <span class="code-review-panel__choice-content">
                  <RobotFaceIcon class="code-review-panel__choice-icon" aria-hidden="true" />
                  <span class="code-review-panel__choice-copy">
                    <strong>{{ $t('surface.codeReviewPanel.independentReviewer') }}</strong>
                    <small>{{ $t('surface.codeReviewPanel.independentReviewerDescription') }}</small>
                  </span>
                </span>
              </button>
              <button
                class="code-review-panel__choice"
                :class="{ 'is-selected': threadMode === 'current' }"
                type="button"
                role="radio"
                :aria-checked="threadMode === 'current'"
                :disabled="!currentThreadAvailable || automatic"
                @click="threadMode = 'current'"
              >
                <span class="code-review-panel__choice-content">
                  <MessageCircleIcon class="code-review-panel__choice-icon" aria-hidden="true" />
                  <span class="code-review-panel__choice-copy">
                    <strong>{{ $t('surface.codeReviewPanel.currentThread') }}</strong>
                    <small>{{ currentThreadDescription }}</small>
                  </span>
                </span>
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend class="app-section-label">{{ t('automaticReview.model') }}</legend>
            <BackendModelSelector
              :key="`${agent.id}:${modelReload}`"
              v-model:backend="reviewBackend"
              v-model:model="reviewModel"
              v-model:reasoning-effort="reviewEffort"
              v-model:service-tier="reviewTier"
              :agent-id="agent.id"
              :team-id="agent.teamId"
              :selections="selections"
              :disabled="busy || threadMode === 'current'"
              @loading="modelsLoading = $event"
              @error="modelsError = true"
            />
          </fieldset>
          <p v-if="modelsError" role="status">{{ t('automaticReview.modelError') }} <button type="button" class="app-button app-button--tertiary" @click="modelsError = false; modelReload++">{{ t('automaticReview.retry') }}</button></p>
          <fieldset v-if="instructions.trim()">
            <legend class="app-section-label">{{ t('surface.codeReviewPanel.additionalInstructions') }}</legend>
            <p class="code-review-panel__instructions" :title="instructions">{{ instructions.replace(/\s+/g, ' ').trim() }}</p>
          </fieldset>
          <div class="code-review-panel__automatic">
            <div class="code-review-panel__toggle">
              <span class="app-section-label">{{ t('automaticReview.title') }}</span>
              <button v-if="automatic" class="code-review-panel__configure" type="button" :disabled="busy" @click="automaticSettingsOpen = true">{{ t('automaticReview.configure') }}</button>
              <el-switch v-model="automatic" :aria-label="t('automaticReview.title')" :disabled="busy" />
            </div>
          </div>
        </div>
        <button
          class="app-button app-button--primary code-review-panel__start"
          type="button"
          :disabled="busy || modelsLoading"
          @click="startSelectedReview"
        >
          <IconSparkles aria-hidden="true" />
          {{ $t('surface.codeReviewPanel.startReview') }}
        </button>
      </template>
    </div>

    <template v-else>
      <header class="code-review-panel__header">
        <div>
          <span class="code-review-panel__eyebrow">{{ $t('surface.codeReviewPanel.codeReview') }}</span>
          <h2>{{ sessionTitle }}</h2>
        </div>
        <span class="code-review-panel__status" :data-status="session.status">{{
          sessionStatus
        }}</span>
      </header>
      <div v-if="session.automation || session.status !== 'finished'" class="code-review-panel__automation-status" role="status">
        <span v-if="!session.automation || session.automation.state === 'manual'">{{ t('automaticReview.manual') }}</span>
        <span v-else-if="session.automation.state === 'running'">{{ t('automaticReview.running', { round: session.rounds.length, max: session.automation.maxRounds }) }}</span>
        <span v-else>{{ session.automation.reason }}</span>
        <button v-if="session.automation?.state === 'running'" class="app-button app-button--secondary" type="button" :disabled="busy" @click="run(() => reviewSettings.switchToManual(agent.id, session!.id))">{{ t('automaticReview.switchToManual') }}</button>
        <button v-else-if="session.status !== 'finished'" class="app-button app-button--secondary" type="button" :disabled="busy || !canStopTurn" @click="run(() => reviewSettings.stop(agent.id))">{{ t('automaticReview.stopReview') }}</button>
      </div>

      <div
        class="code-review-panel__rounds"
        role="tablist"
        :aria-label="$t('surface.codeReviewPanel.reviewRounds')"
      >
        <button
          v-for="round in session.rounds"
          :key="round.id"
          type="button"
          role="tab"
          :aria-selected="selectedRoundId === round.id"
          :class="{ 'is-active': selectedRoundId === round.id }"
          @click="selectedRoundId = round.id"
        >
          {{ $t('surface.codeReviewPanel.roundNumber', { number: round.number }) }}
        </button>
      </div>

      <div
        v-if="session.status !== 'reviewing'"
        class="code-review-panel__progress"
        :aria-label="$t('surface.codeReviewPanel.cumulativeProgress')"
      >
        <span v-for="item in progressItems" :key="item.label"
          ><strong>{{ item.value }}</strong> {{ item.label }}</span
        >
      </div>

      <div
        v-if="selectedRound?.status === 'reviewing'"
        class="code-review-panel__working"
        :class="{ 'is-waiting': findings.length === 0 }"
        aria-live="polite"
      >
        <template v-if="findings.length === 0">
          <span class="app-spinner app-spinner--xl app-spinner--primary" aria-hidden="true" />
          <div class="code-review-panel__working-copy">
            <strong>{{ $t('surface.codeReviewPanel.reviewInProgress') }}</strong>
            <span>{{ reviewingScope }}</span>
          </div>
        </template>
        <template v-else>
          <span class="app-spinner app-spinner--lg app-spinner--primary" aria-hidden="true" />
          <strong>{{ reviewingScope }}</strong>
          <span class="code-review-panel__working-count">{{
            $t('surface.codeReviewPanel.findingsFound', { count: findings.length })
          }}</span>
        </template>
      </div>

      <p
        v-if="selectedRound?.status === 'failed'"
        class="code-review-panel__error"
        role="alert"
      >
        {{ selectedRound.error || $t('surface.codeReviewPanel.reviewRoundFailed') }}
      </p>

      <div
        v-if="selectedRound?.status !== 'reviewing' && selectedRound?.status !== 'failed' && findings.length === 0"
        class="code-review-panel__clear"
      >
        <IconCircleCheck aria-hidden="true" />
        <strong>{{ $t('surface.codeReviewPanel.noFindings') }}</strong>
        <span>{{ $t('surface.codeReviewPanel.noFindingsDescription') }}</span>
      </div>

      <ReviewFindingList
        v-else-if="findings.length"
        class="code-review-panel__findings"
        :findings="findingItems"
        :selectable="canArbitrate"
        :clarifiable="canArbitrate"
        :busy="busy"
        @select="setFindingSelected"
        @clarify="clarifyFinding"
        @open-file="emit('openFile', $event)"
      />

      <footer
        v-if="session.automation?.state !== 'running' && selectedRoundId === session.activeRoundId && session.status !== 'reviewing' && session.status !== 'fixing'"
        class="code-review-panel__footer"
      >
        <template v-if="session.status === 'ready'">
          <span>{{ footerMessage }}</span>
          <button
            class="app-button app-button--primary"
            type="button"
            :disabled="busy"
            @click="submitRound"
          >
            {{ selectedCount ? $t('surface.codeReviewPanel.remediateSelected') : $t('surface.codeReviewPanel.completeRound') }}
          </button>
        </template>
        <template v-else-if="session.status === 'readyToFinish'">
          <span v-if="committing">{{ $t('surface.codeReviewPanel.committingChanges') }}</span>
          <label v-else-if="commitAvailable" class="code-review-panel__commit-option">
            <el-switch v-model="commitFirst" size="small" :disabled="busy" :aria-label="$t('surface.codeReviewPanel.commitChanges')" />
            <span>{{ $t('surface.codeReviewPanel.commitChanges') }}</span>
          </label>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="busy"
            @click="complete(() => finishReview(agent.id, session!.id))"
          >
            {{ $t('surface.codeReviewPanel.finishReview') }}
          </button>
          <button
            class="app-button app-button--primary"
            type="button"
            :disabled="busy"
            @click="complete(() => reviewAgain(agent.id, session!.id))"
          >
            {{ $t('surface.codeReviewPanel.reviewAgain') }}
          </button>
        </template>
        <template v-else-if="session.status === 'finished'">
          <span>{{ $t('surface.codeReviewPanel.reviewFinished') }}</span>
          <button
            class="app-button app-button--primary"
            type="button"
            :disabled="busy"
            @click="retryReview"
          >
            {{ $t('surface.codeReviewPanel.startNewReview') }}
          </button>
        </template>
        <template v-else-if="session.status === 'failed'">
          <span>{{ $t('surface.codeReviewPanel.reviewStopped') }}</span>
          <button
            class="app-button app-button--primary"
            type="button"
            :disabled="busy"
            @click="retryReview"
          >
            {{ $t('surface.codeReviewPanel.retryReview') }}
          </button>
        </template>
      </footer>
    </template>
    <FormDialog v-if="!session" v-model="automaticSettingsOpen" :title="t('automaticReview.title')" width="440px" teleported>
      <div class="app-form-dialog">
        <FormField :label="t('automaticReview.priorities')">
          <el-select v-model="maxPriority" :aria-label="t('automaticReview.priorities')" :disabled="busy">
            <el-option value="p0" :label="t('automaticReview.critical')" />
            <el-option value="p1" :label="t('automaticReview.high')" />
            <el-option value="p2" :label="t('automaticReview.normal')" />
            <el-option value="p3" :label="t('automaticReview.all')" />
          </el-select>
        </FormField>
        <FormField :label="t('automaticReview.rounds')">
          <el-input-number v-model="maxRounds" :aria-label="t('automaticReview.rounds')" :min="1" :max="10" :step="1" :precision="0" :disabled="busy" />
        </FormField>
        <FormField :label="t('automaticReview.autoCommit')" :help="t(autoCommit ? 'automaticReview.commitConsent' : 'automaticReview.noCommit')">
          <el-switch v-model="autoCommit" :aria-label="t('automaticReview.autoCommit')" :disabled="busy" />
        </FormField>
        <p class="app-form-dialog__help">{{ t('automaticReview.independent') }} {{ t('automaticReview.noPublish') }}</p>
      </div>
      <template #footer>
        <button type="button" class="app-button app-button--primary" @click="automaticSettingsOpen = false">{{ t('automaticReview.done') }}</button>
      </template>
    </FormDialog>
    <p v-if="error" class="code-review-panel__error" role="alert">
      {{ error }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, provide, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  IconChecklist,
  IconCircleCheck,
  IconSparkles,
} from "@tabler/icons-vue";
import {
  FileDiffIcon,
  GitBranchIcon,
  MessageCircleIcon,
  RobotFaceIcon,
} from "../shared/icons/app-icons";
import {
  codeReviewProgress,
  type CodeReviewFinding,
  type CodeReviewStartInput,
  type CodeReviewThreadMode,
} from "@workspace/core/code-review";
import type { Agent, AgentGitStatus, AppSnapshot } from "@workspace/core/contracts";
import ReviewFindingList, { type ReviewFindingListItem } from './ReviewFindingList.vue';
import BackendModelSelector from './BackendModelSelector.vue';
import { backendModelCatalogKey } from './backend-model-catalog';
import { codeReviewUncommittedPreviewKey } from './code-review-preview';
import FormDialog from '../shared/dialog/FormDialog.vue';
import FormField from '../shared/form/FormField.vue';
import { useBackendChoices } from './backend-selection';
import { useCodeReviewSettings } from './code-review-settings';
import type { CodeReviewPriority } from '@workspace/core/code-review';
import { codeReviewAvailability, preferredReviewBackend } from '@workspace/core/code-review';

const props = defineProps<{
  agent: Agent;
  gitStatus?: AgentGitStatus | null;
  startReview: (agentId: string, input: CodeReviewStartInput) => Promise<AppSnapshot>;
  decideFinding: (
    agentId: string,
    input: import("@workspace/core/code-review").CodeReviewDecisionInput,
  ) => Promise<AppSnapshot>;
  submitReviewRound: (
    agentId: string,
    sessionId: string,
  ) => Promise<AppSnapshot>;
  finishReview: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  reviewAgain: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
  commitReview: (agentId: string, sessionId: string) => Promise<AppSnapshot>;
}>();

const { t } = useI18n();
const emit = defineEmits<{
  clarifyFinding: [payload: {
    sessionId: string;
    roundId: string;
    finding: CodeReviewFinding;
  }];
  openFile: [path: string];
}>();
const instructions = defineModel<string>('instructions', { default: '' });
const busy = ref(false);
const error = ref<string | null>(null);
const scope = ref<CodeReviewStartInput["scope"]["type"]>("uncommitted");
const threadMode = ref<CodeReviewThreadMode>("independent");
const reviewSettings = useCodeReviewSettings();
provide(backendModelCatalogKey, { listModels: reviewSettings.listModels });
const remembered = reviewSettings.preferences();
const connectedBackends = useBackendChoices(() => props.agent.teamId);
const reviewBackend = ref<Agent['backend'] | undefined>(preferredReviewBackend(props.agent.backend, connectedBackends.value, remembered?.backend));
const automatic = ref(remembered?.automation.enabled ?? false);
const automaticSettingsOpen = ref(false);
const maxPriority = ref<CodeReviewPriority>(remembered?.automation.maxPriority ?? 'p2');
const maxRounds = ref(remembered?.automation.maxRounds ?? 3);
const autoCommit = ref(remembered?.automation.autoCommit ?? false);
const reviewModel = ref('');
const reviewEffort = ref('');
const reviewTier = ref('');
const modelsLoading = ref(false);
const modelsError = ref(false);
const modelReload = ref(0);
const effectiveBackend = computed(() => threadMode.value === 'current' ? props.agent.backend : reviewBackend.value);
const selections = { ...remembered?.providers };
watch(automatic, enabled => { if (enabled) threadMode.value = 'independent'; });
watch([effectiveBackend, () => props.agent.id, () => Boolean(props.agent.codeReview)], ([backend], previous) => {
  const sameSetup = previous?.[1] === props.agent.id && !previous?.[2] && !props.agent.codeReview;
  if (previous?.[0] && sameSetup && !modelsLoading.value) selections[previous[0]] = { model: reviewModel.value, reasoningEffort: reviewEffort.value, serviceTier: reviewTier.value || null };
  else if (!sameSetup) Object.assign(selections, reviewSettings.preferences()?.providers);
  reviewModel.value = backend ? selections[backend]?.model ?? '' : '';
  reviewEffort.value = backend ? selections[backend]?.reasoningEffort ?? '' : '';
  reviewTier.value = backend ? selections[backend]?.serviceTier ?? '' : '';
  modelsError.value = false;
}, { immediate: true, flush: 'sync' });
watch(() => props.agent.id, () => {
  automaticSettingsOpen.value = false;
  const latest = reviewSettings.preferences();
  reviewBackend.value = preferredReviewBackend(props.agent.backend, connectedBackends.value, latest?.backend);
  automatic.value = latest?.automation.enabled ?? false;
  maxPriority.value = latest?.automation.maxPriority ?? 'p2';
  maxRounds.value = latest?.automation.maxRounds ?? 3;
  autoCommit.value = latest?.automation.autoCommit ?? false;
});
const selectedRoundId = ref("");
const session = computed(() => props.agent.codeReview ?? null);
const canStopTurn = computed(() => session.value?.status === 'reviewing' || session.value?.status === 'fixing'
  || props.agent.status.type === 'working' || props.agent.status.type === 'awaitingInput');
const branchScope = computed(() => props.gitStatus?.diffCatalog?.branch);
const scopeCatalogReady = computed(() => Boolean(props.gitStatus?.diffCatalog) && props.gitStatus?.state !== "unknown");
const availability = computed(() => codeReviewAvailability(props.agent, props.gitStatus));
const hasUncommittedChanges = computed(() => availability.value.uncommitted);
const hasBranchChanges = computed(() => availability.value.branchChanges);
const nothingToReview = computed(() => scopeCatalogReady.value
  && !hasUncommittedChanges.value
  && !hasBranchChanges.value);
const currentThreadAvailable = computed(() => availability.value.currentThread);
const uncommittedDescription = computed(() => hasUncommittedChanges.value
  ? t("surface.codeReviewPanel.uncommittedDescription")
  : t("surface.codeReviewPanel.uncommittedUnavailable"));
const branchDescription = computed(() => hasBranchChanges.value && branchScope.value
  ? t("surface.codeReviewPanel.branchDescription", {
      branch: props.gitStatus?.branch ?? t("surface.codeReviewPanel.currentBranchFallback"),
      base: branchScope.value.baseRef,
    })
  : t("surface.codeReviewPanel.branchUnavailable"));
const currentThreadDescription = computed(() => automatic.value
  ? t('automaticReview.currentThreadUnavailable')
  : currentThreadAvailable.value
    ? t("surface.codeReviewPanel.currentThreadDescription")
    : t("surface.codeReviewPanel.currentThreadUnavailable"));
const selectedRound = computed(
  () =>
    session.value?.rounds.find((round) => round.id === selectedRoundId.value) ??
    session.value?.rounds.at(-1),
);
const findings = computed(() =>
  [...(selectedRound.value?.findings ?? [])].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
  ),
);
const findingItems = computed<ReviewFindingListItem[]>(() => findings.value.map(finding => ({
  id: finding.id,
  priority: finding.priority,
  title: finding.title,
  body: finding.body,
  ...(finding.location ? { location: finding.location } : {}),
  selected: finding.decision.state !== 'rejected',
  state: finding.remediation.state,
  stateLabel: findingStateLabel(finding),
  ...(finding.decision.state === 'rejected' && finding.decision.reason ? { decisionReason: finding.decision.reason } : {}),
  ...(finding.remediation.state === 'fixed' && finding.remediation.evidence ? { evidence: finding.remediation.evidence } : {}),
})));
const progress = computed(() =>
  session.value
    ? codeReviewProgress(session.value)
    : {
        total: 0,
        undecided: 0,
        selected: 0,
        rejected: 0,
        skipped: 0,
        pending: 0,
        fixing: 0,
        fixed: 0,
      },
);
const progressItems = computed(() =>
  session.value?.status === "ready"
    ? [
        { value: selectedCount.value, label: t("surface.codeReviewPanel.selected") },
        { value: progress.value.rejected, label: t("surface.codeReviewPanel.unselected") },
        { value: progress.value.fixed, label: t("surface.codeReviewPanel.fixed") },
      ]
    : [
        { value: progress.value.skipped, label: t("surface.codeReviewPanel.skipped") },
        { value: progress.value.pending, label: t("surface.codeReviewPanel.pending") },
        { value: progress.value.fixing, label: t("surface.codeReviewPanel.fixing") },
        { value: progress.value.fixed, label: t("surface.codeReviewPanel.fixed") },
      ],
);
const canArbitrate = computed(
  () =>
    session.value?.status === "ready" &&
    session.value?.automation?.state !== 'running' &&
    selectedRoundId.value === session.value.activeRoundId,
);
const selectedCount = computed(
  () =>
    selectedRound.value?.findings.filter(
      (finding) => finding.decision.state !== "rejected",
    ).length ?? 0,
);
const sessionTitle = computed(
  () => props.gitStatus?.branch?.trim() || t("surface.codeReviewPanel.codeReview"),
);
const sessionStatus = computed(
  () =>
    ({
      reviewing: t("surface.codeReviewPanel.statusReviewing"),
      ready: t("surface.codeReviewPanel.statusReady"),
      fixing: t("surface.codeReviewPanel.statusFixing"),
      readyToFinish: t("surface.codeReviewPanel.statusReadyToFinish"),
      finished: t("surface.codeReviewPanel.statusFinished"),
      failed: t("surface.codeReviewPanel.statusFailed"),
    })[session.value?.status ?? "reviewing"],
);
const reviewingScope = computed(() => {
  const reviewScope = session.value?.scope;
  if (reviewScope?.type === "branch") {
    return t("surface.codeReviewPanel.inspectingBranch", {
      branch: props.gitStatus?.branch ?? t("surface.codeReviewPanel.currentBranchFallback"),
      base: reviewScope.baseRef,
    });
  }
  return t("surface.codeReviewPanel.inspectingUncommitted");
});
const footerMessage = computed(() =>
  t("surface.codeReviewPanel.findingsSelected", {
    count: selectedCount.value,
    total: selectedRound.value?.findings.length ?? 0,
  }),
);

watch(
  () => session.value?.activeRoundId,
  (roundId) => {
    if (roundId) selectedRoundId.value = roundId;
  },
  { immediate: true },
);

watch(
  [hasUncommittedChanges, hasBranchChanges],
  ([uncommitted, branch]) => {
    if (scope.value === "uncommitted" && !uncommitted && branch) scope.value = "branch";
    if (scope.value === "branch" && !branch && uncommitted) scope.value = "uncommitted";
  },
  { immediate: true },
);

const simulateUncommitted = inject(codeReviewUncommittedPreviewKey, ref(false));
// Automatic reviews may already have committed everything; only offer a commit while changes remain.
const commitAvailable = computed(() => simulateUncommitted.value || (props.gitStatus?.changedFiles ?? 0) > 0);
const commitFirst = ref(false);
const committing = ref(false);

// The review agent commits first; if that fails the chosen action never runs and the review stays as it was.
function complete(action: () => Promise<unknown>): void {
  const sessionId = session.value!.id;
  void run(async () => {
    if (commitFirst.value && commitAvailable.value) {
      committing.value = true;
      try { await props.commitReview(props.agent.id, sessionId); }
      finally { committing.value = false; }
    }
    await action();
  });
}

async function run(action: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await action();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    busy.value = false;
  }
}

function setFindingSelected(findingId: string, selected: boolean): void {
  const round = selectedRound.value;
  if (!session.value || !round) return;
  error.value = null;
  void props.decideFinding(props.agent.id, {
    sessionId: session.value!.id,
    roundId: round.id,
    findingId,
    decision: selected ? "select" : "reject",
  })
    .catch((caught) => {
      error.value = caught instanceof Error ? caught.message : String(caught);
    });
}

function clarifyFinding(findingId: string): void {
  const round = selectedRound.value;
  const finding = findings.value.find(candidate => candidate.id === findingId);
  if (!session.value || !round || !finding) return;
  emit("clarifyFinding", {
    sessionId: session.value.id,
    roundId: round.id,
    finding,
  });
}

function submitRound(): void {
  if (!session.value) return;
  void run(() => props.submitReviewRound(props.agent.id, session.value!.id));
}

function startSelectedReview(): void {
  if (nothingToReview.value || modelsLoading.value) return;
  if (!connectedBackends.value.includes(threadMode.value === 'current' ? props.agent.backend : reviewBackend.value!)) {
    error.value = t('engineConnection.required');
    return;
  }
  const reviewScope: CodeReviewStartInput["scope"] = scope.value === "branch" && branchScope.value
    ? { type: "branch", baseRef: branchScope.value.baseRef }
    : { type: "uncommitted" };
  void run(() => props.startReview(props.agent.id, {
    scope: reviewScope, threadMode: threadMode.value,
    ...(instructions.value.trim() ? { instructions: instructions.value.trim() } : {}),
    ...(threadMode.value === 'independent' ? { backend: reviewBackend.value } : {}),
    ...(threadMode.value === 'independent' && reviewModel.value ? { model: reviewModel.value } : {}),
    ...(threadMode.value === 'independent' && reviewEffort.value ? { reasoningEffort: reviewEffort.value } : {}),
    ...(threadMode.value === 'independent' ? { serviceTier: reviewTier.value || null } : {}),
    automation: { enabled: automatic.value, maxPriority: maxPriority.value, maxRounds: maxRounds.value ?? 3, autoCommit: autoCommit.value },
  }));
}

function retryReview(): void {
  const review = session.value;
  if (!review) return;
  const reviewScope: CodeReviewStartInput["scope"] = review.scope.type === "branch"
    ? { type: "branch", baseRef: review.scope.baseRef }
    : { type: "uncommitted" };
  const { automation } = review;
  // The failed reviewer keeps its backend and model; only the automatic setup must be carried over.
  void run(() => props.startReview(props.agent.id, {
    scope: automation?.baseRef ? { type: 'branch', baseRef: automation.baseRef } : reviewScope,
    threadMode: review.threadMode,
    ...(review.instructions ? { instructions: review.instructions } : {}),
    ...(automation ? { automation: { enabled: automation.enabled, maxPriority: automation.maxPriority, maxRounds: automation.maxRounds, autoCommit: automation.autoCommit ?? false } } : {}),
  }));
}

function findingState(finding: CodeReviewFinding): string {
  return finding.remediation.state;
}

function findingStateLabel(finding: CodeReviewFinding): string {
  const state = findingState(finding);
  return (
    (
      {
        notStarted: "",
        skipped: t("surface.codeReviewPanel.stateSkipped"),
        pending: t("surface.codeReviewPanel.statePending"),
        fixing: t("surface.codeReviewPanel.stateFixing"),
        fixed: t("surface.codeReviewPanel.stateFixed"),
      } as Record<string, string>
    )[state] ?? state
  );
}

function priorityRank(priority: CodeReviewFinding["priority"]): number {
  return { p0: 0, p1: 1, p2: 2, p3: 3 }[priority];
}
</script>

<style scoped>
.code-review-panel__automatic {
  display: grid;
  gap: var(--space-4);
  text-align: left;
}

.code-review-panel__toggle > span {
  margin-right: auto;
}

.code-review-panel__configure {
  padding: 0;
  border: 0;
  color: var(--color-primary);
  background: transparent;
  font-size: var(--font-size-12);
  cursor: pointer;
}

.code-review-panel__configure:hover {
  text-decoration: underline;
}

.code-review-panel__toggle,
.code-review-panel__automation-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.code-review-panel__automation-status {
  padding: var(--space-4);
  font-size: var(--font-size-12);
}

.code-review-panel {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--color-surface), var(--color-shell-main) 80%);
  color: var(--color-text);
}

.code-review-panel__empty {
  margin: auto;
  width: min(720px, 100%);
  box-sizing: border-box;
  display: grid;
  justify-items: center;
  gap: var(--space-6);
  padding: var(--space-16);
  text-align: center;
}

.code-review-panel__setup {
  width: 100%;
  display: grid;
  gap: var(--space-10);
  text-align: left;
}

.code-review-panel__start {
  margin-left: auto;
  margin-top: var(--space-6);
}

.code-review-panel__setup fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.code-review-panel__setup legend {
  margin-bottom: var(--space-4);
}

.code-review-panel__instructions {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-review-panel__choices {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.code-review-panel__choice {
  min-width: 0;
  min-height: 132px;
  box-sizing: border-box;
  width: 100%;
  height: auto;
  margin: 0;
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.code-review-panel__choice:hover:not(:disabled):not(.is-selected) {
  border-color: var(--color-outline);
  background: var(--color-surface-low);
}

.code-review-panel__choice.is-selected {
  border-color: var(--color-primary);
  background: var(--color-primary-container);
}

.code-review-panel__choice:disabled {
  opacity: 0.45;
  cursor: default;
}

.code-review-panel__choice:focus-visible {
  border-color: var(--color-primary);
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.code-review-panel__choice-content {
  display: grid;
  justify-items: center;
  gap: var(--space-4);
  text-align: center;
}

.code-review-panel__choice-icon {
  width: var(--icon-xl);
  height: var(--icon-xl);
  color: var(--color-primary);
  stroke-width: 1.7;
}

.code-review-panel__choice-copy {
  display: grid;
  gap: var(--space-1);
}

.code-review-panel__choice-copy strong {
  color: var(--color-text);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-semibold);
}

.code-review-panel__choice-copy small {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-18);
}

.code-review-panel__empty h2,
.code-review-panel__header h2 {
  margin: 0;
  font-size: var(--font-size-18);
}

.code-review-panel__empty p {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
  line-height: 1.5;
}

.code-review-panel__empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.code-review-panel__empty-icon svg {
  width: 26px;
  height: 26px;
}

.code-review-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-6);
  border-bottom: 1px solid var(--color-border);
}

.code-review-panel__header > div {
  min-width: 0;
}

.code-review-panel__header h2 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-review-panel__eyebrow {
  display: block;
  margin-bottom: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.code-review-panel__status {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-surface-low);
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
  white-space: nowrap;
}

.code-review-panel__status[data-status="ready"],
.code-review-panel__status[data-status="readyToFinish"] {
  color: var(--color-primary);
  background: var(--color-primary-container);
}

.code-review-panel__rounds {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6) 0;
  margin-bottom: var(--space-6);
  overflow-x: auto;
}

.code-review-panel__rounds button {
  border: 0;
  border-bottom: 2px solid transparent;
  padding: var(--space-2) var(--space-1);
  color: var(--color-text-muted);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.code-review-panel__rounds button.is-active {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.code-review-panel__progress {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 1px;
  margin: var(--space-4) var(--space-6);
  margin-top: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-border);
}

.code-review-panel__progress span {
  display: grid;
  gap: 2px;
  padding: var(--space-3);
  background: var(--color-surface-low);
  color: var(--color-text-muted);
  font-size: var(--font-size-11);
}

.code-review-panel__progress strong {
  color: var(--color-text);
  font-size: var(--font-size-16);
}

.code-review-panel__working {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-4) var(--space-6);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
}

.code-review-panel__working strong {
  color: var(--color-text);
  font-weight: var(--font-weight-medium);
}

.code-review-panel__working.is-waiting {
  grid-template-columns: 1fr;
  justify-items: center;
  margin: auto;
  padding: var(--space-8);
  border-bottom: 0;
  text-align: center;
}

.code-review-panel__working.is-waiting .app-spinner {
  margin-bottom: var(--space-8);
}

.code-review-panel__working-copy {
  display: grid;
  gap: var(--space-1);
  justify-items: center;
  line-height: 1.4;
  font-size: var(--font-size-14);
}

.code-review-panel__working-count {
  padding: 2px var(--space-2);
  border-radius: 999px;
  background: var(--color-surface-low);
  font-size: var(--font-size-11);
}

.code-review-panel__clear {
  margin: auto;
  color: var(--color-text-muted);
  line-height: 1.4;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-8);
}

.code-review-panel__clear span {
  display: block;
}

.code-review-panel__clear strong,
.code-review-panel__clear span {
  grid-column: 2;
}

.code-review-panel__clear svg {
  color: var(--color-success);
}

.code-review-panel__findings {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-auto-rows: max-content;
  align-content: start;
  gap: var(--space-3);
  margin: 0;
  padding: 0 var(--space-6) var(--space-6);
  list-style: none;
}

.code-review-panel__footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-border);
  background: var(--color-shell-main);
}

.code-review-panel__footer > span {
  margin-right: auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.code-review-panel__commit-option {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-right: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  font-weight: normal;
}

.code-review-panel__error {
  margin: var(--space-4) var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-md);
  color: var(--color-error);
  background: var(--color-error-container);
  font-size: var(--font-size-13);
}
</style>
