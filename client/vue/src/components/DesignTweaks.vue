<template>
  <div class="design-tweaks">
    <p v-if="!displayedTweaks.length" class="design-tweaks__empty">{{ t('design.noTweaks') }}</p>
    <div v-for="tweak in displayedTweaks" :key="tweak.id" class="design-tweaks__field">
      <header class="design-tweaks__heading">
        <label :for="`design-tweak-${tweak.id}`">{{ tweak.label }}</label>
      </header>
      <div v-if="tweak.type === 'range'" class="design-tweaks__range">
        <input :id="`design-tweak-${tweak.id}`" type="range" :aria-label="tweak.label" :min="tweak.min" :max="tweak.max" :step="tweak.step" :value="value(tweak) ?? tweak.min" :style="{ '--tweak-progress': progress(tweak) }" :disabled="unavailable(tweak)" @input="preview(tweak, Number(($event.target as HTMLInputElement).value))" @change="commit(tweak, Number(($event.target as HTMLInputElement).value))" />
        <div class="design-tweaks__value">
          <input type="number" :aria-label="t('design.tweakValue', { name: tweak.label })" :min="tweak.min" :max="tweak.max" :step="tweak.step" :value="value(tweak) ?? ''" :disabled="unavailable(tweak)" @input="numberInput(tweak, $event, false)" @change="numberInput(tweak, $event, true)" />
          <span v-if="tweak.unit">{{ tweak.unit }}</span>
        </div>
      </div>
      <div v-else-if="tweak.type === 'color'" class="design-tweaks__color">
        <input :id="`design-tweak-${tweak.id}`" type="color" :aria-label="tweak.label" :value="value(tweak) ?? '#000000'" :disabled="unavailable(tweak)" @input="preview(tweak, ($event.target as HTMLInputElement).value)" @change="commit(tweak, ($event.target as HTMLInputElement).value)" />
        <input class="design-tweaks__hex" type="text" :aria-label="t('design.tweakHex', { name: tweak.label })" :value="value(tweak) ?? ''" :placeholder="display(tweak)" maxlength="7" spellcheck="false" :disabled="unavailable(tweak)" @input="colorInput(tweak, $event, false)" @change="colorInput(tweak, $event, true)" />
      </div>
      <select v-else-if="tweak.type === 'select'" :id="`design-tweak-${tweak.id}`" :aria-label="tweak.label" :value="value(tweak) ?? ''" :disabled="unavailable(tweak)" @change="commit(tweak, ($event.target as HTMLSelectElement).value)">
        <option v-if="value(tweak) === null" value="" disabled>{{ display(tweak) }}</option>
        <option v-for="option in tweak.options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <div v-else class="design-tweaks__toggle">
        <input :id="`design-tweak-${tweak.id}`" type="checkbox" :aria-label="tweak.label" :checked="value(tweak) === true" :disabled="unavailable(tweak)" @change="commit(tweak, ($event.target as HTMLInputElement).checked)" />
        <output v-if="value(tweak) === null">{{ display(tweak) }}</output>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DesignNode } from '@workspace/core/design';
import { designTweakCss, readDesignTweak, type DesignTweak, type DesignTweakValue } from '@workspace/core/design-tweaks';
import { translate as t } from '../i18n';
const props = defineProps<{ tweaks: DesignTweak[]; nodes: DesignNode[]; draft: { tweakId: string; value: DesignTweakValue; definition: DesignTweak } | null; disabled: boolean }>();
const emit = defineEmits<{ preview: [tweak: DesignTweak, value: DesignTweakValue]; commit: [tweak: DesignTweak, value: DesignTweakValue] }>();
const displayedTweaks = computed(() => {
  const draft = props.draft;
  return props.tweaks.map(tweak => draft?.tweakId === tweak.id ? draft.definition : tweak);
});
const node = (tweak: DesignTweak) => props.nodes.find(item => item.id === tweak.nodeId);
function value(tweak: DesignTweak) { return props.draft?.tweakId === tweak.id ? props.draft.value : node(tweak) ? readDesignTweak(tweak, node(tweak)!) : null; }
function display(tweak: DesignTweak) { return props.draft?.tweakId === tweak.id ? designTweakCss(tweak, props.draft.value) : node(tweak)?.styles?.[tweak.property] ?? t('design.fromStyles'); }
function unavailable(tweak: DesignTweak) { return props.disabled || !!props.draft && props.draft.tweakId !== tweak.id; }
function preview(tweak: DesignTweak, next: DesignTweakValue) { emit('preview', tweak, next); }
function commit(tweak: DesignTweak, next: DesignTweakValue) { emit('commit', tweak, next); }
function progress(tweak: Extract<DesignTweak, { type: 'range' }>) { return `${Math.max(0, Math.min(100, (Number(value(tweak) ?? tweak.min) - tweak.min) / (tweak.max - tweak.min) * 100))}%`; }
function numberInput(tweak: Extract<DesignTweak, { type: 'range' }>, event: Event, save: boolean) {
  const input = event.target as HTMLInputElement;
  if (input.value && input.validity.valid && Number.isFinite(input.valueAsNumber)) { if (save) commit(tweak, input.valueAsNumber); else preview(tweak, input.valueAsNumber); }
  else if (save) input.value = String(value(tweak) ?? '');
}
function colorInput(tweak: DesignTweak, event: Event, save: boolean) {
  const input = event.target as HTMLInputElement;
  if (/^#[a-f\d]{6}$/i.test(input.value)) { if (save) commit(tweak, input.value); else preview(tweak, input.value); }
  else if (save) input.value = String(value(tweak) ?? '');
}
</script>

<style scoped>
.design-tweaks {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  padding: var(--space-6) var(--space-8);
}
.design-tweaks__field { display: flex; flex-direction: column; gap: var(--space-6); padding-block: var(--space-4); }
.design-tweaks__heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8); }
.design-tweaks__heading label { color: var(--color-text); font-size: var(--font-size-13); font-weight: var(--font-weight-medium); }
.design-tweaks__range { display: flex; align-items: center; gap: var(--space-8); width: 100%; min-width: 0; }
.design-tweaks__value { display: flex; align-items: center; gap: var(--space-2); flex: 0 0 76px; height: 36px; padding-inline: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.design-tweaks__value input { width: 100%; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--color-text); font: inherit; font-size: var(--font-size-13); font-variant-numeric: tabular-nums; }
.design-tweaks__value span { color: var(--color-text-muted); font-size: var(--font-size-12); }
.design-tweaks__value input::-webkit-inner-spin-button { appearance: none; }
.design-tweaks__empty {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.5;
}
.design-tweaks output {
  font-size: var(--font-size-13);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.design-tweaks input[type="range"] {
  --tweak-progress: 0%;

  flex: 1;
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0;
  border: 0;
  margin: 0;
  appearance: none;
  background: transparent;
  accent-color: var(--color-primary);
}
.design-tweaks input[type="range"]::-webkit-slider-runnable-track { height: 4px; border-radius: var(--radius-full); background: linear-gradient(to right, var(--color-primary) var(--tweak-progress), var(--color-border) var(--tweak-progress)); }
.design-tweaks input[type="range"]::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -5px; border-radius: var(--radius-full); appearance: none; background: var(--color-primary); }
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
  gap: var(--space-6);
}
.design-tweaks__color { height: 40px; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-lowest); }
.design-tweaks__color:focus-within,
.design-tweaks__value:focus-within { border-color: var(--color-primary); }
.design-tweaks__hex { flex: 1; width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--color-text); font: inherit; font-size: var(--font-size-13); }
.design-tweaks .design-tweaks__color .design-tweaks__hex:focus-visible,
.design-tweaks .design-tweaks__value input:focus-visible { outline: none; }
.design-tweaks input[type="color"] {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
}
.design-tweaks input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
.design-tweaks input[type="color"]::-webkit-color-swatch { border: 0; border-radius: var(--radius-sm); }
.design-tweaks select {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-12);
}
</style>
