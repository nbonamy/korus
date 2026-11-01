<template>
  <el-select v-model="selected" :size="size" :aria-label="ariaLabel || t('remoteTarget.machine')" :disabled="disabled">
    <template #prefix>
      <component :is="selected === 'local' ? DeviceImacIcon : WorldIcon" class="host-selector__icon" aria-hidden="true" />
    </template>
    <el-option v-if="showThisComputer" value="local" :label="t('remoteTarget.thisComputer')">
      <span class="host-selector__option" :class="{ 'host-selector__option--small': size === 'small' }"><DeviceImacIcon aria-hidden="true" />{{ t('remoteTarget.thisComputer') }}</span>
    </el-option>
    <el-option v-for="host in hosts" :key="host.id" :value="host.id" :label="host.name" :disabled="disabledHostIds.includes(host.id)">
      <span class="host-selector__option" :class="{ 'host-selector__option--small': size === 'small' }"><WorldIcon aria-hidden="true" />{{ host.name }}</span>
    </el-option>
  </el-select>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { RemoteConnection } from '@workspace/core/contracts';
import { DeviceImacIcon, WorldIcon } from '../shared/icons/app-icons';

withDefaults(defineProps<{
  hosts: RemoteConnection[];
  showThisComputer?: boolean;
  size?: 'small' | 'default';
  ariaLabel?: string;
  disabled?: boolean;
  disabledHostIds?: string[];
}>(), { showThisComputer: true, disabledHostIds: () => [] });
const selected = defineModel<string>({ required: true });
const { t } = useI18n();
</script>

<style scoped>
.host-selector__icon,
.host-selector__option svg {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
}

.host-selector__option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.host-selector__option--small {
  font-size: var(--font-size-12);
}

</style>
