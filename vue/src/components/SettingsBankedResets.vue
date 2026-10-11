<template>
  <FormSection :title="$t('bankedResets.title')" title-id="settings-banked-resets-title" density="compact">
    <template #actions>
      <el-button size="small" :disabled="loading || !eligible || unavailable || !transportConnected" :aria-label="$t('bankedResets.refresh')" @click="refresh">{{ $t('bankedResets.refresh') }}</el-button>
    </template>
    <FormRow :title="summary ? $t('bankedResets.available', { count: summary.availableCount }) : statusText">
      <template #copy>
        <span v-if="loading && summary" role="status">{{ $t('bankedResets.loading') }}</span>
        <span v-if="failed" class="banked-resets__error" role="alert">{{ $t('bankedResets.failed') }}</span>
        <span v-if="summary?.credits === null">{{ $t('bankedResets.countOnly') }}</span>
        <span v-else-if="summary?.credits.length === 0 && summary.availableCount !== '0'">{{ $t('bankedResets.emptyDetails') }}</span>
        <span v-else-if="partialDetails">{{ $t('bankedResets.partial') }}</span>
        <span v-if="summary?.detailCount && summary.detailCount > summary.credits!.length">{{ $t('bankedResets.bounded', { count: summary.credits!.length }) }}</span>
      </template>
    </FormRow>
    <div v-if="summary?.credits?.length" class="banked-resets__details" role="region" :aria-label="$t('bankedResets.details')" tabindex="0">
      <FormRow v-for="(credit, index) in summary.credits" :key="index" :title="credit.title ?? $t('bankedResets.reset')" :description="credit.description ?? undefined">
        <template #copy>
          <span>{{ credit.resetType }} · {{ credit.status }}</span>
          <span>{{ $t('bankedResets.granted') }} <time :datetime="iso(credit.grantedAt)">{{ date(credit.grantedAt) }}</time></span>
          <span v-if="credit.expiresAt !== null">{{ $t('bankedResets.expires') }} <time :datetime="iso(credit.expiresAt)">{{ date(credit.expiresAt) }}</time></span>
        </template>
      </FormRow>
    </div>
  </FormSection>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { isBankedResets, type BankedResets } from '@workspace/core/contracts/banked-resets';
import { appApi } from '../platform-api';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';

const props = defineProps<{ eligible: boolean; accountKey: string; unavailable?: boolean; remoteConnectionId?: string }>();
const { t } = useI18n();
const result = ref<BankedResets>();
const loading = ref(false);
const transportConnected = ref(true);
const failed = ref(false);
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const summary = computed(() => result.value?.status === 'ready' ? result.value.summary : null);
const partialDetails = computed(() => summary.value?.credits && BigInt(summary.value.availableCount) > BigInt(summary.value.credits.filter(credit => credit.status === 'available').length));
const statusText = computed(() => props.unavailable ? t('bankedResets.unsupported')
  : !transportConnected.value ? t('bankedResets.disconnected')
  : !props.eligible || result.value?.status === 'signedOut' ? t('bankedResets.signedOut')
    : loading.value ? t('bankedResets.loading') : result.value?.status === 'unsupported' ? t('bankedResets.unsupported') : t('bankedResets.unknown'));
function iso(seconds: number): string { return new Date(seconds * 1000).toISOString(); }
function date(seconds: number): string { return new Date(seconds * 1000).toLocaleString(); }

async function refresh() {
  if (loading.value || !props.eligible || props.unavailable || !transportConnected.value) return;
  const expected = ++revision;
  loading.value = true; failed.value = false;
  timer = setTimeout(() => {
    if (revision !== expected) return;
    ++revision; loading.value = false; failed.value = true;
  }, 20_000);
  try {
    if (!appApi?.getBankedResets) { result.value = { status: 'unsupported' }; return; }
    const next = await appApi.getBankedResets(props.remoteConnectionId);
    if (revision !== expected) return;
    if (!isBankedResets(next)) throw new Error('Invalid banked reset response');
    result.value = next;
  } catch { if (revision === expected) failed.value = true; }
  finally { if (revision === expected) { clearTimeout(timer); loading.value = false; } }
}
function invalidate() {
  ++revision; clearTimeout(timer); loading.value = false; result.value = undefined; failed.value = false;
}
watch(() => [props.accountKey, props.remoteConnectionId, props.eligible, props.unavailable, transportConnected.value], () => {
  invalidate(); void refresh();
}, { immediate: true });
const unsubscribe = appApi?.onEvent?.(event => {
  if (event.type === 'client.connectionChanged') {
    transportConnected.value = event.payload.status === 'connected';
    if (!transportConnected.value) invalidate();
  } else if (event.type === 'provider.authenticationChanged' && event.payload.kind === 'codex' && !props.remoteConnectionId) {
    invalidate(); queueMicrotask(() => { if (!disposed) void refresh(); });
  }
});
let disposed = false;
onScopeDispose(() => { disposed = true; invalidate(); unsubscribe?.(); });
</script>

<style scoped>
.banked-resets__details {
  max-height: 240px;
  overflow: auto;
  border-top: 1px solid var(--color-border);
  overflow-wrap: anywhere;
}
.banked-resets__error {
  color: var(--color-error);
}
</style>
