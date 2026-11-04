<template>
  <div class="native-resource-gate">
    <slot v-if="granted && !elsewhere" />
    <div v-else-if="elsewhere || refused" class="native-resource-gate__elsewhere">
      <span>{{ $t(`surface.nativeResource.${resource}Elsewhere`) }}</span>
      <button class="app-button app-button--secondary" type="button" @click="takeOver">
        {{ $t('surface.nativeResource.moveHere') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { NativeResource } from '@workspace/core/windows';
import { appApi } from '../platform-api';
import { windowState } from '../window-state';

/**
 * A browser or simulator view exists once per agent, so only one window mounts it.
 * Every other window shows where it is open and can take it over.
 */
const props = defineProps<{ resource: NativeResource; agentId: string }>();

// The view mounts right away unless another window is already known to own it; a refused claim takes it back down.
const granted = ref(true);
const refused = ref(false);
const elsewhere = computed(() => !windowState.ownsNative(props.resource, props.agentId));
const pendingClaims = new Set<string>();
let disposed = false;
let acquired = false;

async function claim(agentId: string, takeOver = false): Promise<void> {
  if (disposed || pendingClaims.has(agentId)) return;
  pendingClaims.add(agentId);
  const api = appApi;
  const resource = props.resource;
  try {
    const result = api?.claimNativeResource ? await api.claimNativeResource(resource, agentId, takeOver) : true;
    if (disposed || agentId !== props.agentId) {
      if (result) void api?.releaseNativeResource?.(resource, agentId)?.catch(() => undefined);
      return;
    }
    acquired = result && !elsewhere.value;
    granted.value = acquired;
    refused.value = !result;
  } catch {
    if (!disposed && agentId === props.agentId) {
      granted.value = false;
      refused.value = true;
    }
  } finally {
    pendingClaims.delete(agentId);
  }
}

function release(agentId: string): void {
  if (acquired) void appApi?.releaseNativeResource?.(props.resource, agentId)?.catch(() => undefined);
  acquired = false;
  granted.value = false;
}

function takeOver(): void {
  void claim(props.agentId, true);
}

// Claimed during setup so the request reaches main before the view's own first call.
void claim(props.agentId);
onBeforeUnmount(() => { disposed = true; release(props.agentId); });
watch(() => props.agentId, (next, previous) => {
  release(previous);
  void claim(next);
});
// A window that lost the view to another one stops counting itself as the owner,
// and claims the view again once the other window lets go of it.
watch(elsewhere, (value) => {
  if (value) { acquired = false; granted.value = false; }
  else if (!granted.value) void claim(props.agentId);
});
</script>

<style scoped>
.native-resource-gate {
  display: contents;
}

.native-resource-gate__elsewhere {
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-8);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  text-align: center;
}
</style>
