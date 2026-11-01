<template>
  <ol class="work-authorization-steps">
    <li class="work-authorization-steps__step">
      <div class="work-authorization-steps__copy-row">
        <div class="work-authorization-steps__text">
          <strong>{{ $t('surface.settingsIntegrationsPanel.step1CopyTheCode') }}</strong>
          <span>{{ $t('surface.settingsIntegrationsPanel.clickTheCodeToCopyIt') }}</span>
        </div>
        <button
          class="work-authorization-steps__code"
          type="button"
          :aria-label="$t('workAuthorization.copyCode', { provider: providerLabel, code: authorization.userCode })"
          @click="copyAuthorizationCode"
        >
          <span>{{ authorization.userCode }}</span>
          <component
            :is="copyIconConfirmed ? CheckIcon : CopyIcon"
            aria-hidden="true"
            size="16"
          />
        </button>
      </div>
    </li>
    <li class="work-authorization-steps__step">
      <div class="work-authorization-steps__text">
        <strong>{{ $t('workAuthorization.step2', { provider: providerLabel }) }}</strong>
        <span>{{ $t('workAuthorization.pasteCode', { provider: providerLabel }) }}</span>
      </div>
      <el-button
        :type="codeCopied ? 'primary' : undefined"
        @click="emit('open')"
      >{{ $t('workAuthorization.open', { provider: providerLabel }) }}</el-button>
    </li>
    <li class="work-authorization-steps__step">
      <div class="work-authorization-steps__text">
        <strong>{{ $t('surface.settingsIntegrationsPanel.step3ComeBackHere') }}</strong>
        <span>{{ $t('workAuthorization.finish', { provider: providerLabel }) }}</span>
      </div>
      <span
        class="work-authorization-steps__waiting"
        :aria-label="$t('workAuthorization.waiting', { provider: providerLabel })"
      >{{ $t('surface.settingsIntegrationsPanel.waiting') }}</span>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { workProviderLabel } from '@workspace/core/work-item-prompts';
import { computed, ref, watch } from 'vue';
import type { WorkProviderAuthorization } from '@workspace/core/contracts';
import { CheckIcon, CopyIcon } from '../shared/icons/app-icons';

const props = defineProps<{
  authorization: WorkProviderAuthorization;
}>();

const emit = defineEmits<{
  open: [];
}>();

const providerLabel = computed(() => workProviderLabel(props.authorization.provider));
const copyIconConfirmed = ref(false);
const codeCopied = ref(false);

watch(() => props.authorization.userCode, () => {
  copyIconConfirmed.value = false;
  codeCopied.value = false;
});

async function copyAuthorizationCode(): Promise<void> {
  try {
    if (!props.authorization.userCode) return;
    await navigator.clipboard.writeText(props.authorization.userCode);
    copyIconConfirmed.value = true;
    codeCopied.value = true;
    window.setTimeout(() => {
      copyIconConfirmed.value = false;
    }, 1_400);
  } catch {
    copyIconConfirmed.value = false;
    codeCopied.value = false;
  }
}
</script>

<style scoped>
.work-authorization-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

.work-authorization-steps__step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  min-height: 68px;
  padding: var(--space-12) 0;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.work-authorization-steps__step:first-child {
  border-top: 0;
}

.work-authorization-steps__text {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
}

.work-authorization-steps__text strong {
  color: var(--color-text);
  font-weight: var(--font-weight-semibold);
}

.work-authorization-steps__text span {
  color: var(--color-text-muted);
}

.work-authorization-steps__copy-row {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
}

.work-authorization-steps__code {
  min-width: 128px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-3) 0;
  border: 0;
  color: var(--color-text);
  background: transparent;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-semibold);
  text-align: center;
  cursor: pointer;
}

.work-authorization-steps__code:hover {
  color: var(--color-primary);
}

.work-authorization-steps__waiting {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
}
</style>
