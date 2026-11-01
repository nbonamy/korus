<template>
  <Teleport to="body">
    <div
      v-if="confettiBursts.length"
      class="confetti-overlay"
      aria-hidden="true"
    >
      <div
        v-for="burst in confettiBursts"
        :key="burst.id"
        class="confetti-overlay__burst"
      >
        <i
          v-for="piece in burst.pieces"
          :key="piece.id"
          :class="['confetti-overlay__piece', `confetti-overlay__piece--${piece.variant}`]"
          :style="pieceStyle(piece)"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { launchCanvasCelebration } from './canvas-celebration';
import { useConfetti, type ConfettiPiece } from './use-confetti';

const { bursts } = useConfetti();
const confettiBursts = computed(() => bursts.value.filter((burst) => burst.kind === 'confetti'));
const handledCanvasBursts = new Set<string>();

watch(bursts, (nextBursts) => {
  const activeIds = new Set(nextBursts.map((burst) => burst.id));
  for (const id of handledCanvasBursts) {
    if (!activeIds.has(id)) handledCanvasBursts.delete(id);
  }
  for (const burst of nextBursts) {
    if (handledCanvasBursts.has(burst.id)) continue;
    handledCanvasBursts.add(burst.id);
    const durationMs = burst.pieces[0]?.durationMs ?? 2_400;
    launchCanvasCelebration(burst.kind, durationMs);
  }
}, { immediate: true });

function pieceStyle(piece: ConfettiPiece): Record<string, string> {
  return {
    animationDelay: `${piece.delayMs}ms`,
    animationDuration: `${piece.durationMs}ms`,
    background: piece.color,
    height: `${piece.sizePx * 1.7}px`,
    left: `${piece.leftPercent}%`,
    rotate: `${piece.rotationDeg}deg`,
    width: `${piece.sizePx}px`,
  };
}
</script>

<style scoped>
.confetti-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  overflow: hidden;
  pointer-events: none;
}

.confetti-overlay__burst {
  position: absolute;
  inset: 0;
}

.confetti-overlay__piece {
  position: absolute;
  top: 10%;
  border-radius: var(--radius-xs);
  opacity: 0;
  transform: translate3d(0, 0, 0) rotate(0deg);
  animation-name: confetti-fall-0;
  animation-timing-function: cubic-bezier(0.18, 0.72, 0.38, 1);
  animation-fill-mode: forwards;
}

.confetti-overlay__piece--1 {
  animation-name: confetti-fall-1;
}

.confetti-overlay__piece--2 {
  animation-name: confetti-fall-2;
}

.confetti-overlay__piece--3 {
  animation-name: confetti-fall-3;
}

.confetti-overlay__piece--4 {
  animation-name: confetti-fall-4;
}

.confetti-overlay__piece--5 {
  animation-name: confetti-fall-5;
}

@keyframes confetti-fall-0 {
  0% {
    opacity: 0;
    transform: translate3d(0, -24px, 0) rotate(0deg);
  }

  12% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate3d(-160px, 72vh, 0) rotate(420deg);
  }
}

@keyframes confetti-fall-1 {
  0% {
    opacity: 0;
    transform: translate3d(0, -24px, 0) rotate(0deg);
  }

  12% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate3d(-92px, 76vh, 0) rotate(-380deg);
  }
}

@keyframes confetti-fall-2 {
  0% {
    opacity: 0;
    transform: translate3d(0, -24px, 0) rotate(0deg);
  }

  12% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate3d(-36px, 70vh, 0) rotate(520deg);
  }
}

@keyframes confetti-fall-3 {
  0% {
    opacity: 0;
    transform: translate3d(0, -24px, 0) rotate(0deg);
  }

  12% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate3d(48px, 74vh, 0) rotate(-460deg);
  }
}

@keyframes confetti-fall-4 {
  0% {
    opacity: 0;
    transform: translate3d(0, -24px, 0) rotate(0deg);
  }

  12% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate3d(116px, 78vh, 0) rotate(360deg);
  }
}

@keyframes confetti-fall-5 {
  0% {
    opacity: 0;
    transform: translate3d(0, -24px, 0) rotate(0deg);
  }

  12% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translate3d(178px, 72vh, 0) rotate(-560deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .confetti-overlay__piece {
    animation-duration: 320ms;
  }
}
</style>
