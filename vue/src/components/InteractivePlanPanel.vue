<template>
  <section class="interactive-plan-panel" :aria-label="t('htmlPlan.review')">
    <iframe
      ref="frame"
      :key="identity"
      :title="plan.document.title"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :srcdoc="srcdoc"
    />
    <PlanReviewFooter
      :comments="[]"
      :disabled="locked || submitting || save.saving.value || Boolean(error) || nativeApprovalDisabled"
      :show-comment-help="false"
      :show-approval-actions="nativeApprovalAvailable === true"
      :confirm-label="t('htmlPlan.implement')"
      @confirm="emit('confirmPlan')"
      @cancel="emit('cancelPlan')"
    >
      <template #status>
        <span v-if="status" role="status">{{ status }}</span>
        <span v-if="error" role="alert">{{ error }}</span>
        <button
          v-if="save.error.value"
          class="app-button"
          type="button"
          @click="retrySave"
        >
          {{ t('htmlPlan.retry') }}
        </button>
      </template>
      <template #secondary-actions>
        <button
          class="app-button"
          :class="nativeApprovalAvailable ? 'app-button--secondary' : 'app-button--primary'"
          type="button"
          :disabled="locked || submitting || !respond"
          @click="submit"
        >
          {{ t('htmlPlan.submit') }}
        </button>
      </template>
    </PlanReviewFooter>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type InteractivePlan,
  type InteractivePlanResponse,
  type PlanAnswers,
} from '@workspace/core/interactive-plan';
import { useDebouncedSave } from '../shared/use-debounced-save';
import PlanReviewFooter from './PlanReviewFooter.vue';
import {
  interactivePlanFrame,
  planFrameAnswers,
  type PlanFrameTheme,
} from './interactive-plan-frame';
const props = defineProps<{
  plan: InteractivePlan;
  nativeApprovalAvailable?: boolean;
  nativeApprovalDisabled?: boolean;
  respond?: (response: InteractivePlanResponse) => Promise<InteractivePlan>;
}>();
const emit = defineEmits<{ confirmPlan: []; cancelPlan: [] }>();
const { t } = useI18n();
const frame = ref<HTMLIFrameElement>();
const submitting = ref(false);
const submitError = ref('');
const identity = computed(
  () =>
    JSON.stringify([props.plan.agentId, props.plan.conversationId, props.plan.id, props.plan.revision]),
);
const nonce = ref(crypto.randomUUID());
const answers = ref<PlanAnswers>(
  JSON.parse(JSON.stringify(props.plan.answers)),
);
const version = ref(props.plan.answerVersion);
const locked = ref(props.plan.submitted || props.plan.deliveryPending === true);
const theme = ref<PlanFrameTheme>({
  background: 'initial',
  foreground: 'initial',
  border: 'initial',
  primary: 'initial',
});
const srcdoc = ref('');
const error = computed(() => submitError.value || save.error.value);
const save = useDebouncedSave(
  async (edit: {
    identity: string;
    plan: InteractivePlan;
    answers: PlanAnswers;
  }) => {
    if (!props.respond) throw new Error(t('htmlPlan.unavailable'));
    const result = await props.respond({
      planId: edit.plan.id,
      revision: edit.plan.revision,
      answerVersion: version.value,
      action: 'save',
      answers: edit.answers,
    });
    if (identity.value === edit.identity) version.value = result.answerVersion;
  },
  350,
);
const status = computed(() =>
  submitting.value
    ? t('htmlPlan.submitting')
    : props.plan.deliveryPending
      ? t('htmlPlan.deliveryPending')
      : locked.value
        ? t('htmlPlan.submitted')
        : '',
);
function render() {
  srcdoc.value = interactivePlanFrame(
    { ...props.plan, answers: answers.value, submitted: locked.value },
    nonce.value,
    theme.value,
    {
      comment: t('htmlPlan.comment'),
      proposed: t('htmlPlan.proposed'),
      clear: t('htmlPlan.clear'),
    },
  );
}
watch(
  identity,
  () => {
    nonce.value = crypto.randomUUID();
    answers.value = JSON.parse(JSON.stringify(props.plan.answers));
    version.value = props.plan.answerVersion;
    locked.value = props.plan.submitted || props.plan.deliveryPending === true;
    submitError.value = '';
    render();
  },
  { immediate: true },
);
watch(
  () => props.plan,
  (plan) => {
    const next = plan.submitted || plan.deliveryPending === true;
    if (next !== locked.value) {
      locked.value = next;
      render();
    }
  },
);
function receive(event: MessageEvent) {
  if (locked.value || submitting.value) return;
  const next = planFrameAnswers(
    event,
    frame.value?.contentWindow ?? null,
    props.plan,
    nonce.value,
  );
  if (!next || JSON.stringify(next) === JSON.stringify(answers.value)) return;
  answers.value = next;
  submitError.value = '';
  save.schedule({
    identity: identity.value,
    plan: props.plan,
    answers: structuredClone(next),
  });
}
async function retrySave() {
  save.schedule({
    identity: identity.value,
    plan: props.plan,
    answers: JSON.parse(JSON.stringify(answers.value)),
  });
  await save.flush();
}
async function submit() {
  if (locked.value || submitting.value || !props.respond) return;
  submitting.value = true;
  submitError.value = '';
  const target = identity.value;
  const plan = props.plan;
  try {
    if (!(await save.flush()) || identity.value !== target) return;
    const result = await props.respond({
      planId: plan.id,
      revision: plan.revision,
      answerVersion: version.value,
      action: 'submit',
      answers: JSON.parse(JSON.stringify(answers.value)),
    });
    if (identity.value === target) {
      locked.value = result.submitted;
      version.value = result.answerVersion;
      render();
    }
  } catch (cause) {
    if (identity.value === target)
      submitError.value =
        cause instanceof Error ? cause.message : String(cause);
  } finally {
    submitting.value = false;
  }
}
let observer: MutationObserver | undefined;
onMounted(() => {
  window.addEventListener('message', receive);
  const updateTheme = () => {
    const css = getComputedStyle(document.documentElement);
    const nextTheme: PlanFrameTheme = {
      background: css.getPropertyValue('--color-surface-lowest').trim(),
      foreground: css.getPropertyValue('--color-text').trim(),
      border: css.getPropertyValue('--color-border').trim(),
      primary: css.getPropertyValue('--color-primary').trim(),
    };
    if (Object.keys(nextTheme).every(key => nextTheme[key as keyof PlanFrameTheme] === theme.value[key as keyof PlanFrameTheme])) return;
    theme.value = nextTheme;
    render();
  };
  updateTheme();
  observer = new MutationObserver(updateTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme'],
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('message', receive);
  observer?.disconnect();
});
</script>
<style scoped>
.interactive-plan-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-surface-lowest);
}
iframe {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
}
[role='alert'] {
  color: var(--color-error);
}
</style>
