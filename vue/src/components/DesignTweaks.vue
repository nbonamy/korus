<template>
  <div class="design-tweaks">
    <p v-if="!tweaks.length" class="design-tweaks__empty">{{ t('design.noTweaks') }}</p>
    <FormField v-for="tweak in tweaks" :key="tweak.id" density="compact" :label="tweak.label">
      <template v-if="tweak.type === 'range'">
        <output>{{ display(tweak) }}</output>
        <input type="range" :aria-label="tweak.label" :min="tweak.min" :max="tweak.max" :step="tweak.step" :value="value(tweak) ?? tweak.min" :disabled="unavailable(tweak)" @input="preview(tweak, Number(($event.target as HTMLInputElement).value))" @change="commit(tweak, Number(($event.target as HTMLInputElement).value))" />
      </template>
      <div v-else-if="tweak.type === 'color'" class="design-tweaks__color">
        <input type="color" :aria-label="tweak.label" :value="value(tweak) ?? '#000000'" :disabled="unavailable(tweak)" @input="preview(tweak, ($event.target as HTMLInputElement).value)" @change="commit(tweak, ($event.target as HTMLInputElement).value)" />
        <output>{{ display(tweak) }}</output>
      </div>
      <select v-else-if="tweak.type === 'select'" :aria-label="tweak.label" :value="value(tweak) ?? ''" :disabled="unavailable(tweak)" @change="commit(tweak, ($event.target as HTMLSelectElement).value)">
        <option v-if="value(tweak) === null" value="" disabled>{{ display(tweak) }}</option>
        <option v-for="option in tweak.options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <div v-else class="design-tweaks__toggle">
        <input type="checkbox" :aria-label="tweak.label" :checked="value(tweak) === true" :disabled="unavailable(tweak)" @change="commit(tweak, ($event.target as HTMLInputElement).checked)" />
        <output v-if="value(tweak) === null">{{ display(tweak) }}</output>
      </div>
    </FormField>
  </div>
</template>

<script setup lang="ts">
import type { DesignNode } from '@workspace/core/design';
import { designTweakCss, readDesignTweak, type DesignTweak, type DesignTweakValue } from '@workspace/core/design-tweaks';
import FormField from '../shared/form/FormField.vue';
import { translate as t } from '../i18n';
const props = defineProps<{ tweaks: DesignTweak[]; nodes: DesignNode[]; draft: { tweakId: string; value: DesignTweakValue } | null; disabled: boolean }>();
const emit = defineEmits<{ preview: [tweak: DesignTweak, value: DesignTweakValue]; commit: [tweak: DesignTweak, value: DesignTweakValue] }>();
const node = (tweak: DesignTweak) => props.nodes.find(item => item.id === tweak.nodeId);
function value(tweak: DesignTweak) { return props.draft?.tweakId === tweak.id ? props.draft.value : node(tweak) ? readDesignTweak(tweak, node(tweak)!) : null; }
function display(tweak: DesignTweak) { return props.draft?.tweakId === tweak.id ? designTweakCss(tweak, props.draft.value) : node(tweak)?.styles?.[tweak.property] ?? t('design.fromStyles'); }
function unavailable(tweak: DesignTweak) { return props.disabled || !!props.draft && props.draft.tweakId !== tweak.id; }
function preview(tweak: DesignTweak, next: DesignTweakValue) { emit('preview', tweak, next); }
function commit(tweak: DesignTweak, next: DesignTweakValue) { emit('commit', tweak, next); }
</script>

<style scoped>
.design-tweaks {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.design-tweaks__empty {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.5;
}
.design-tweaks output {
  font-size: var(--font-size-12);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.design-tweaks input[type="range"] {
  width: 100%;
  margin: var(--space-2) 0 0;
  accent-color: var(--color-primary);
}
.design-tweaks input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--color-primary);
}
.design-tweaks__color,
.design-tweaks__toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.design-tweaks input[type="color"] {
  width: 40px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--color-border);
  background: transparent;
}
.design-tweaks select {
  width: 100%;
  min-width: 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
</style>
