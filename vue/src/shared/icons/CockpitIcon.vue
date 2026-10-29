<template>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <g v-for="row in 5" :key="row">
      <circle v-for="column in 5" :key="column" :cx="4 + (column - 1) * 4" :cy="4 + (row - 1) * 4" r="1.2" />
    </g>
  </svg>
</template>
