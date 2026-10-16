<template>
  <section class="usage-tiles"><slot /></section>
</template>
<style scoped>
.usage-tiles {
  display: grid;
  grid-template-columns: repeat(var(--usage-tile-columns, 3), minmax(0, 1fr));
  gap: var(--space-8);
}
@media (max-width: 1100px) {
  .usage-tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 720px) {
  .usage-tiles {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
