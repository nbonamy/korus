<template>
  <AgentAvatar :avatar="icon" :name="name" size="xs" shape="square" />
</template>

<script setup lang="ts">
import AgentAvatar from './AgentAvatar.vue';

defineProps<{ icon?: string; name: string }>();
</script>
