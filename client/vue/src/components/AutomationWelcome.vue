<template>
  <section class="automation-welcome" :aria-label="$t('surface.automationWelcome.automationsWelcome')">
    <div class="automation-welcome__icon" aria-hidden="true">
      <ClockHour8Icon />
    </div>
    <div class="automation-welcome__copy">
      <h3>{{ $t('surface.automationWelcome.noAutomationsYet') }}</h3>
      <p>{{ $t('surface.automationWelcome.automationsWatchForMatchingWork') }}</p>
    </div>
    <el-button
      type="primary"
      class="automation-welcome__button"
      @click="emit('create')"
    > {{ $t('surface.automationWelcome.createAutomation') }} </el-button>
  </section>
</template>

<script setup lang="ts">
import { ClockHour8Icon } from '../shared/icons/app-icons';

const emit = defineEmits<{
  create: [];
}>();
</script>

<style scoped>
.automation-welcome {
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-16);
  padding: var(--space-32);
  text-align: center;
}

.automation-welcome__icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--color-text-muted);
}

.automation-welcome__icon svg {
  width: 32px;
  height: 32px;
  stroke-width: 1.4;
}

.automation-welcome__copy {
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.automation-welcome__copy h3,
.automation-welcome__copy p {
  margin: 0;
}

.automation-welcome__copy h3 {
  color: var(--color-text);
  font-size: var(--font-size-18);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-28);
}

.automation-welcome__copy p {
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.automation-welcome__button {
  min-width: 128px;
}
</style>
