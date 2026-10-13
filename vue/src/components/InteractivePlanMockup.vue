<template>
  <div class="mockup-screen">
    <div class="mockup-window">
      <div class="mockup-titlebar">
        <span class="window-dots" aria-hidden="true"><i /><i /><i /></span>
        <span>{{ screen.title }}</span>
      </div>
      <div class="mockup-body">
        <div v-if="screen.navigation" class="mockup-nav">
          <div v-for="(item, index) in screen.navigation" :key="index" :class="{ active: item === screen.activeItem }"><RectangleIcon aria-hidden="true" /><span>{{ item }}</span></div>
        </div>
        <div class="mockup-content">
          <template v-if="screen.content"><p v-for="(line, index) in screen.content" :key="index">{{ line }}</p></template>
          <div v-else-if="!screen.fields && !screen.items" aria-hidden="true"><i v-for="index in 4" :key="index" class="skeleton" /></div>
          <div v-if="screen.fields" class="mockup-fields">
            <div v-for="(field, index) in screen.fields" :key="index" class="mockup-field"><span>{{ field.label }}</span><div>{{ field.value }}</div></div>
          </div>
          <div v-if="screen.items" class="mockup-list">
            <div v-for="(item, index) in screen.items" :key="index" class="mockup-item"><strong>{{ item.title }}</strong><span v-if="item.detail">{{ item.detail }}</span></div>
          </div>
          <div v-if="screen.actions" class="mockup-actions"><span v-for="(action, index) in screen.actions" :key="index" class="mockup-action">{{ action }}</span></div>
        </div>
      </div>
    </div>
    <div class="mockup-label">{{ screen.label }}</div>
  </div>
</template>

<script setup lang="ts">
import type { PlanMockupScreen } from '@workspace/core/interactive-plan';
import { RectangleIcon } from '../shared/icons/app-icons';
defineProps<{ screen: PlanMockupScreen }>();
</script>

<style scoped>
.mockup-screen {
  min-width: 0;
}
.mockup-window {
  border: 1px solid var(--color-border);
  border-radius: 7px;
  overflow: hidden;
  background: var(--color-surface-lowest);
  box-shadow: 0 3px 10px color-mix(in srgb, var(--color-text) 4%, transparent);
}
.mockup-titlebar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 9px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
  background: color-mix(in srgb, var(--color-text) 3%, var(--color-surface-lowest));
  font-size: 12px;
  font-weight: 600;
}
.window-dots {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.window-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-border);
}
.mockup-body {
  display: flex;
  min-height: 122px;
  font-size: 11px;
  line-height: 1.4;
}
.mockup-nav {
  padding: 8px 6px;
  min-width: 72px;
  max-width: 48%;
  border-right: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
  background: color-mix(in srgb, var(--color-text) 3%, var(--color-surface-lowest));
}
.mockup-nav div {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 4px;
}
.mockup-nav svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.mockup-nav .active {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-lowest));
}
.mockup-content {
  flex: 1;
  min-width: 0;
  padding: 16px 12px;
}
.mockup-content p {
  white-space: pre-wrap;
  margin-top: 0;
  color: var(--color-text);
  margin-bottom: 10px;
}
.skeleton {
  display: block;
  height: 7px;
  margin: 7px 0 12px;
  background: color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
  border-radius: 2px;
}
.skeleton:nth-child(2) {
  width: 65%;
}
.skeleton:nth-child(4) {
  width: 80%;
}
.mockup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.mockup-action {
  padding: 4px 7px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
}
.mockup-action:first-child {
  color: var(--color-primary);
  border-color: transparent;
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-lowest));
}
.mockup-label {
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
  font-size: 12px;
  margin-top: 7px;
}

.mockup-fields {
  display: grid;
  gap: 12px;
  margin-bottom: 14px;
}
.mockup-field > span {
  display: block;
  margin-bottom: 5px;
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
}
.mockup-field > div {
  padding: 7px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
}
.mockup-list {
  margin: -8px 0 12px;
}
.mockup-item {
  display: grid;
  gap: 3px;
  padding: 9px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-surface-lowest));
}
.mockup-item:last-child {
  border: 0;
}
.mockup-item strong {
  font-weight: 500;
}
.mockup-item span {
  color: color-mix(in srgb, var(--color-text) 62%, var(--color-surface-lowest));
}
</style>
