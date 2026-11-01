<template>
  <ol class="review-finding-list">
    <li
      v-for="finding in findings"
      :id="`finding-${finding.id}`"
      :key="finding.id"
      class="review-finding"
      :data-priority="finding.priority"
      :data-state="finding.state"
      :data-decision="finding.selected ? 'selected' : 'rejected'"
    >
      <div class="review-finding__title-row">
        <button
          class="review-finding__toggle"
          type="button"
          :aria-expanded="expandedFindingId === finding.id"
          :aria-controls="`finding-details-${finding.id}`"
          @click="toggleFinding(finding.id)"
        >
          <span class="review-finding__priority">{{ finding.priority.toUpperCase() }}</span>
          <span class="review-finding__title"><strong>{{ finding.title }}</strong></span>
          <span v-if="finding.stateLabel" class="review-finding__state">{{ finding.stateLabel }}</span>
          <IconChevronDown class="review-finding__chevron" aria-hidden="true" />
        </button>
        <div v-if="selectable || clarifiable" class="review-finding__quick-actions">
          <button
            v-if="clarifiable"
            class="app-button app-button--tertiary review-finding__quick-action"
            type="button"
            :aria-label="clarifyLabel || $t('surface.codeReviewPanel.clarify')"
            :title="clarifyLabel || $t('surface.codeReviewPanel.clarify')"
            :disabled="busy"
            @click="emit('clarify', finding.id)"
          >
            <IconMessageQuestion aria-hidden="true" />
          </button>
          <el-switch
            v-if="selectable && finding.selectable !== false"
            class="review-finding__selection"
            size="small"
            :model-value="finding.selected"
            :aria-label="$t('surface.codeReviewPanel.includeFinding')"
            :title="$t('surface.codeReviewPanel.includeFinding')"
            :disabled="busy"
            @click.stop
            @change="emit('select', finding.id, $event === true)"
          />
        </div>
      </div>
      <div v-if="expandedFindingId === finding.id" :id="`finding-details-${finding.id}`" class="review-finding__body">
        <span v-if="finding.repositoryPath" class="review-finding__repository">{{ finding.repositoryPath }}</span>
        <button v-if="finding.location && finding.locationInteractive !== false" class="review-finding__location" type="button" @click="emit('openFile', finding.location.file)">
          {{ locationLabel(finding.location) }}
        </button>
        <span v-else-if="finding.location" class="review-finding__location review-finding__location--text">
          {{ locationLabel(finding.location) }}
        </span>
        <div class="review-finding__description" v-html="renderMarkdown(finding.body)" />
        <blockquote v-if="finding.decisionReason" class="review-finding__decision">
          <strong>{{ $t('surface.codeReviewPanel.stateRejected') }}</strong>
          {{ finding.decisionReason }}
        </blockquote>
        <div v-if="finding.evidence" class="review-finding__evidence">
          <strong>{{ $t('surface.codeReviewPanel.fixedEvidence') }}</strong>
          <span>{{ finding.evidence }}</span>
        </div>
      </div>
    </li>
  </ol>
</template>

<script lang="ts">
import type { CodeReviewLocation, CodeReviewPriority } from '@workspace/core/code-review';
export type ReviewFindingListItem = {
  id: string;
  priority: CodeReviewPriority;
  title: string;
  body: string;
  location?: CodeReviewLocation;
  locationInteractive?: boolean;
  repositoryPath?: string;
  selected: boolean;
  selectable?: boolean;
  state: string;
  stateLabel?: string;
  decisionReason?: string;
  evidence?: string;
};
</script>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { IconChevronDown, IconMessageQuestion } from '@tabler/icons-vue';
import { renderMarkdown } from '@codex-app-sdk/vue';

defineProps<{ findings: ReviewFindingListItem[]; selectable?: boolean; clarifiable?: boolean; clarifyLabel?: string; busy?: boolean }>();
const emit = defineEmits<{ select: [findingId: string, selected: boolean]; clarify: [findingId: string]; openFile: [path: string] }>();
const expandedFindingId = ref<string | null>(null);

function toggleFinding(findingId: string): void {
  expandedFindingId.value = expandedFindingId.value === findingId ? null : findingId;
  if (expandedFindingId.value) void nextTick(() => document.getElementById(`finding-${findingId}`)?.scrollIntoView?.({ block: 'nearest' }));
}
function locationLabel(location: CodeReviewLocation): string {
  if (!location.line) return location.file;
  return `${location.file}:${location.line}${location.endLine && location.endLine !== location.line ? `–${location.endLine}` : ''}`;
}
</script>

<style>
.review-finding-list { display: grid; grid-auto-rows: max-content; align-content: start; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.review-finding { display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface); }
.review-finding[data-state="skipped"] { opacity: .74; }
.review-finding__title-row { display: flex; align-items: stretch; min-width: 0; }
.review-finding__toggle { flex: 1; min-width: 0; min-height: 46px; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.review-finding__toggle:hover, .review-finding__toggle:focus-visible { background: var(--color-surface-low); }
.review-finding__title { flex: 1; min-width: 0; }
.review-finding__title strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-13); line-height: var(--line-height-18); }
.review-finding__priority { padding: 2px 6px; border-radius: var(--radius-sm); background-color: var(--color-error-container); color: var(--color-error); font-weight: 700; font-size: var(--font-size-11); }
.review-finding[data-priority="p0"] .review-finding__priority { background-color: var(--color-error); color: var(--color-on-error); }
.review-finding[data-priority="p2"] .review-finding__priority { background-color: var(--color-warning-container); color: var(--color-warning); }
.review-finding[data-priority="p3"] .review-finding__priority { background-color: var(--color-surface-high); color: var(--color-text-muted); }
.review-finding[data-decision="rejected"] .review-finding__title { color: var(--color-text-muted); }
.review-finding[data-decision="rejected"] .review-finding__priority { opacity: .55; }
.review-finding__state { padding: 3px 8px; border-radius: 999px; background: var(--color-surface-low); color: var(--color-text-muted); font-size: var(--font-size-11); white-space: nowrap; }
.review-finding__chevron { width: var(--icon-sm); height: var(--icon-sm); color: var(--color-text-muted); transition: transform 120ms ease; }
.review-finding__toggle[aria-expanded="true"] .review-finding__chevron { transform: rotate(180deg); }
.review-finding__quick-actions { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3) var(--space-2) 0; }
.review-finding__quick-action { width: 28px; min-height: 28px; padding: 0; }
.review-finding__quick-action svg { width: var(--icon-sm); height: var(--icon-sm); }
.review-finding__selection { flex: 0 0 auto; }
.review-finding__repository { color: var(--color-text-muted); font-family: var(--font-family-mono); font-size: var(--font-size-12); }
.review-finding__location { justify-self: start; max-width: 100%; padding: 0; border: 0; color: var(--color-primary); background: transparent; font-family: var(--font-family-mono); font-size: var(--font-size-12); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.review-finding__location--text { cursor: default; }
.review-finding__body { display: grid; gap: var(--space-4); padding: var(--space-4) var(--space-6); border-top: 1px solid var(--color-border); }
.review-finding__description p { margin: 0; font-size: var(--font-size-13); line-height: var(--line-height-20); }
.review-finding__decision { margin: 0; padding: var(--space-3); border-left: 3px solid var(--color-text-muted); background: var(--color-surface-low); }
.review-finding__decision strong { display: block; margin-bottom: var(--space-1); }
.review-finding__evidence { display: grid; gap: var(--space-1); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--color-success-container); font-size: var(--font-size-12); }
.review-finding[data-state="skipped"] .review-finding__state { color: var(--color-text-muted); background-color: var(--color-surface-high); }
.review-finding[data-state="fixing"] .review-finding__state { color: var(--color-primary); background-color: var(--color-primary-container); }
.review-finding[data-state="fixed"] .review-finding__state { color: var(--color-success); background-color: var(--color-success-container); }
</style>
