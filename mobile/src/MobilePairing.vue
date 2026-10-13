<template>
  <section class="mobile-pairing">
    <div class="mobile-pairing__hero">
      <ProductMarkIcon class="mobile-pairing__mark" aria-hidden="true" />
      <h1>{{ t('mobile.title') }}</h1>
      <p>{{ t('mobile.pairingHint') }}</p>
    </div>

    <div v-if="showStatus" class="mobile-pairing__status" role="status">{{ t(`mobile.connection.${status}`) }}</div>
    <p v-if="failure" class="mobile-pairing__error" role="alert">{{ t(failure) }}</p>

    <ul v-if="laptops.length && !connecting" class="mobile-pairing__laptops">
      <li v-for="laptop in laptops" :key="laptop.id">
        <button type="button" @click="emit('open', laptop.id)">
          <span>{{ laptop.name }}</span>
          <ChevronRightIcon aria-hidden="true" />
        </button>
      </li>
    </ul>
    <div v-if="status === 'error' && laptops.length" class="mobile-pairing__actions">
      <button class="app-button app-button--tertiary" type="button" @click="emit('forget')">{{ t('mobile.forget') }}</button>
    </div>

    <form v-if="connector.pair && !connecting" class="mobile-pairing__pair" @submit.prevent="pair">
      <p v-if="connector.relayConfigured === false" class="mobile-pairing__error" role="alert">{{ t('mobile.errors.noRelay') }}</p>
      <template v-else>
        <input
          v-model="code"
          class="mobile-pairing__code"
          :aria-label="t('mobile.code')"
          placeholder="XXXX-XXXX"
          maxlength="9"
          autocapitalize="characters"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="go"
          :disabled="busy"
        >
        <p v-if="waiting" class="mobile-pairing__waiting" role="status">{{ t('mobile.approveOnLaptop') }}</p>
        <button class="app-button app-button--secondary mobile-pairing__scan" type="button" :disabled="busy" @click="scan">
          <ScanIcon aria-hidden="true" />{{ t('mobile.scan') }}
        </button>
      </template>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatPairingCode, normalizePairingCode } from '@workspace/core/companion-pairing';
import { ChevronRightIcon, ProductMarkIcon, ScanIcon } from '@workspace/vue/shared/icons/app-icons';
import { PairingError, type CompanionConnector } from './companion-port';
import type { MobileHost } from './mobile-host';

const props = defineProps<{
  connector: CompanionConnector;
  host: MobileHost;
  laptops: readonly { id: string; name: string }[];
  status: string;
  error: string;
}>();
const emit = defineEmits<{ open: [id: string]; paired: [id: string]; forget: [] }>();
const { t } = useI18n();

const connecting = computed(() => ['connecting', 'reconnecting'].includes(props.status));
const showStatus = computed(() => ['connecting', 'reconnecting', 'error', 'revoked'].includes(props.status));
const code = ref('');
const busy = ref(false);
const waiting = ref(false);
const pairError = ref('');
const failure = computed(() => pairError.value || props.error);
let disposed = false;
const deviceName = props.host.platform === 'ios' ? 'iPhone' : props.host.platform === 'android' ? 'Android phone' : 'Phone';

// A complete code is the whole form: pair as soon as the last character lands.
watch(code, (value) => {
  const formatted = formatPairingCode(value);
  if (formatted !== value) code.value = formatted;
  else if (normalizePairingCode(formatted) && !busy.value) void pair();
});

async function scan() {
  pairError.value = '';
  try { code.value = await props.host.scanPairingCode?.() ?? ''; }
  catch { pairError.value = 'mobile.errors.pairing'; }
}
async function pair() {
  const normalized = normalizePairingCode(code.value);
  if (!props.connector.pair || busy.value || !normalized) return;
  busy.value = true; pairError.value = '';
  try {
    const id = await props.connector.pair(normalized, deviceName, () => { waiting.value = true; });
    if (!disposed) { code.value = ''; emit('paired', id); }
  } catch (cause) {
    if (!disposed) { pairError.value = cause instanceof PairingError ? cause.message : 'mobile.errors.pairing'; code.value = ''; }
  } finally { busy.value = false; waiting.value = false; }
}
onBeforeUnmount(() => { disposed = true; code.value = ''; });
</script>

<style scoped>
.mobile-pairing {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-12);
  min-height: 0;
  padding: var(--space-24) var(--space-10) var(--space-12);
  overflow-y: auto;
}

.mobile-pairing__hero { display: grid; justify-items: center; gap: var(--space-6); text-align: center; }
.mobile-pairing__mark { width: 44px; height: 40px; color: var(--color-primary); }
.mobile-pairing__hero h1 { margin: var(--space-4) 0 0; font-size: var(--font-size-24); font-weight: var(--font-weight-bold); }
.mobile-pairing__hero p { max-width: 30ch; margin: 0; color: var(--color-text-muted); font-size: var(--font-size-15); line-height: var(--line-height-22); }
.mobile-pairing__status { text-align: center; color: var(--color-text-muted); }

.mobile-pairing__laptops { display: grid; gap: var(--space-4); margin: 0; padding: 0; list-style: none; }
.mobile-pairing__laptops button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 56px;
  padding: 0 var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  color: var(--color-text);
  background: var(--color-surface-lowest);
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-semibold);
}
.mobile-pairing__laptops svg { width: var(--icon-lg); height: var(--icon-lg); color: var(--color-text-muted); }

.mobile-pairing__actions { display: flex; justify-content: center; }
.mobile-pairing__pair { display: grid; gap: var(--space-8); margin-top: auto; }
.mobile-pairing__code {
  box-sizing: border-box;
  width: 100%;
  min-height: 64px;
  padding: 0 var(--space-8);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  color: var(--color-text);
  background: var(--color-surface-low);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-24);
  letter-spacing: 0.12em;
  text-align: center;
  text-transform: uppercase;
}
.mobile-pairing__code::placeholder { color: var(--color-text-muted); opacity: 0.5; }
.mobile-pairing__scan { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-4); min-height: 52px; border-radius: var(--radius-xl); font-size: var(--font-size-16); }
.mobile-pairing__scan svg { width: var(--icon-lg); height: var(--icon-lg); }
.mobile-pairing__waiting,
.mobile-pairing__error { margin: 0; text-align: center; font-size: var(--font-size-14); }
.mobile-pairing__waiting { color: var(--color-text-muted); }
.mobile-pairing__error { color: var(--color-error); }
</style>
