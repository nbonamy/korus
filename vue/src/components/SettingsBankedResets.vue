<template>
  <FormSection :title="$t('bankedResets.title')" title-id="settings-banked-resets-title">
    <template #actions>
      <el-button size="small" :disabled="loading || pendingReset !== null || !eligible || unavailable || !transportConnected" :aria-label="$t('bankedResets.refresh')" @click="refresh">{{ $t('bankedResets.refresh') }}</el-button>
    </template>
    <FormRow :title="summary ? $t('bankedResets.available', { count: summary.availableCount }) : statusText">
      <template #copy>
        <span v-if="loading && summary" role="status">{{ $t('bankedResets.loading') }}</span>
        <span v-if="failed" class="banked-resets__error" role="alert">{{ $t('bankedResets.failed') }}</span>
        <span v-if="redemptionFailed" class="banked-resets__error" role="alert">{{ $t('bankedResets.uncertain') }}</span>
        <span v-if="outcome" role="status">{{ $t(`bankedResets.outcomes.${outcome}`) }}</span>
        <span v-if="summary?.credits === null">{{ $t('bankedResets.countOnly') }}</span>
        <span v-else-if="summary?.credits.length === 0 && summary.availableCount !== '0'">{{ $t('bankedResets.emptyDetails') }}</span>
        <span v-else-if="partialDetails">{{ $t('bankedResets.partial') }}</span>
        <span v-if="summary?.detailCount && summary.detailCount > summary.credits!.length">{{ $t('bankedResets.bounded', { count: summary.credits!.length }) }}</span>
      </template>
    </FormRow>
    <div v-if="summary?.credits?.length" class="banked-resets__details" role="region" :aria-label="$t('bankedResets.details')" tabindex="0">
      <FormRow v-for="(credit, index) in summary.credits" :key="credit.redemptionToken ?? index" :title="credit.title ?? $t('bankedResets.reset')">
        <template #copy>
          <span v-if="credit.expiresAt !== null">{{ $t('bankedResets.expires') }} <time :datetime="iso(credit.expiresAt)">{{ date(credit.expiresAt) }}</time></span>
        </template>
        <template v-if="credit.redemptionToken && appApi?.useBankedReset" #control>
          <el-button size="small" :disabled="loading || pendingReset !== null || usedTokens.has(credit.redemptionToken)" @click="useReset(credit.redemptionToken)">{{ $t('bankedResets.useReset') }}</el-button>
        </template>
      </FormRow>
    </div>
  </FormSection>
  <FormSection :title="$t('bankedResets.creditsTitle')" title-id="settings-codex-credits-title">
    <FormRow :title="creditBalance" :description="accountCredits ? $t('bankedResets.currentBalance') : undefined" />
  </FormSection>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessageBox } from 'element-plus';
import { isBankedResets, isBankedResetResult, type BankedResets, type BankedResetResult } from '@workspace/core/contracts/banked-resets';
import { appApi } from '../platform-api';
import FormSection from '../shared/form/FormSection.vue';
import FormRow from '../shared/form/FormRow.vue';

const props = defineProps<{ eligible: boolean; accountKey: string; unavailable?: boolean; remoteConnectionId?: string }>();
const { t } = useI18n();
const result = ref<BankedResets>();
const loading = ref(false);
const transportConnected = ref(true);
const failed = ref(false);
const pendingReset = ref<string | null>(null);
const redemptionFailed = ref(false);
const outcome = ref<BankedResetResult['outcome']>();
const usedTokens = ref(new Set<string>());
const attemptKeys = new Map<string, string>();
const redemptionCancellations = new Set<() => void>();
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const summary = computed(() => result.value?.status === 'ready' ? result.value.summary : null);
const accountCredits = computed(() => result.value?.status === 'ready' ? result.value.accountCredits : null);
const creditBalance = computed(() => loading.value ? t('bankedResets.unknown') : accountCredits.value?.unlimited ? t('bankedResets.unlimitedCredits')
  : accountCredits.value?.balance !== null && accountCredits.value?.balance !== undefined
    ? t('bankedResets.creditBalance', { balance: formatBalance(accountCredits.value.balance) }) : t('bankedResets.unknown'));
const partialDetails = computed(() => summary.value?.credits && BigInt(summary.value.availableCount) > BigInt(summary.value.credits.filter(credit => credit.status === 'available').length));
const statusText = computed(() => props.unavailable ? t('bankedResets.unsupported')
  : !transportConnected.value ? t('bankedResets.disconnected')
  : !props.eligible || result.value?.status === 'signedOut' ? t('bankedResets.signedOut')
    : loading.value ? t('bankedResets.loading') : result.value?.status === 'unsupported' ? t('bankedResets.unsupported') : t('bankedResets.unknown'));
function iso(seconds: number): string { return new Date(seconds * 1000).toISOString(); }
function date(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
function formatBalance(balance: string): string {
  const match = /^(\d+)(\.\d+)?$/.exec(balance);
  const fraction = (match?.[2] ?? '').replace(/0+$/, '').replace(/\.$/, '');
  return match ? match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fraction : balance;
}

async function refresh() {
  if (loading.value || pendingReset.value !== null || !props.eligible || props.unavailable || !transportConnected.value) return;
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
async function useReset(redemptionToken: string) {
  const api = appApi;
  if (!api?.useBankedReset) return;
  if (loading.value || pendingReset.value !== null || !props.eligible || props.unavailable || !transportConnected.value || usedTokens.value.has(redemptionToken)) return;
  const expected = revision;
  const accountKey = props.accountKey;
  const owner = props.remoteConnectionId;
  pendingReset.value = redemptionToken; redemptionFailed.value = false; outcome.value = undefined;
  try {
    try {
      await ElMessageBox.confirm(t('bankedResets.confirmMessage'), t('bankedResets.confirmTitle'), {
        confirmButtonText: t('bankedResets.useReset'), cancelButtonText: t('common.cancel'), type: 'warning',
      });
    } catch { return; }
    if (disposed || revision !== expected || accountKey !== props.accountKey || owner !== props.remoteConnectionId || !props.eligible || !transportConnected.value) return;
    const idempotencyKey = attemptKeys.get(redemptionToken) ?? crypto.randomUUID();
    attemptKeys.set(redemptionToken, idempotencyKey);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const next = await Promise.race([
        api.useBankedReset({ redemptionToken, idempotencyKey, confirmed: true }, owner),
        new Promise<never>((_resolve, reject) => {
          cancel = () => { clearTimeout(timeout); reject(new Error('Reset context changed')); };
          redemptionCancellations.add(cancel);
          timeout = setTimeout(() => reject(new Error('Uncertain reset outcome')), 20_000);
        }),
      ]);
      if (disposed || revision !== expected || accountKey !== props.accountKey || owner !== props.remoteConnectionId) return;
      if (!isBankedResetResult(next)) throw new Error('Invalid reset outcome');
      outcome.value = next.outcome;
      attemptKeys.delete(redemptionToken);
      if (next.outcome === 'reset' || next.outcome === 'alreadyRedeemed') usedTokens.value.add(redemptionToken);
      pendingReset.value = null;
      await refresh();
    } catch { if (!disposed && revision === expected) redemptionFailed.value = true; }
    finally { clearTimeout(timeout); if (cancel) redemptionCancellations.delete(cancel); }
  } finally { if (!disposed && revision === expected) pendingReset.value = null; }
}
function invalidate() {
  ++revision; clearTimeout(timer); loading.value = false; result.value = undefined; failed.value = false;
  for (const cancel of redemptionCancellations) cancel();
  pendingReset.value = null; redemptionFailed.value = false; outcome.value = undefined; usedTokens.value.clear();
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
onScopeDispose(() => { disposed = true; invalidate(); attemptKeys.clear(); unsubscribe?.(); });
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
