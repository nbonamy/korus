<template>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <defs>
      <mask :id="arrowMaskId" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path :d="arrowPath" stroke="black" stroke-width="3" />
      </mask>
    </defs>
    <g :mask="`url(#${arrowMaskId})`">
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6" />
      <path d="M4 9h16" />
    </g>
    <path :d="arrowPath" />
  </svg>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const arrowMaskId = `feature-arrow-${useId()}`;
const arrowPath = 'M1 14.5h10.5m-3 3 3-3-3-3';
</script>
