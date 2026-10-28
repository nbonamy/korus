import { computed, ref } from 'vue';
import type { CelebrationKind } from '@workspace/core/contracts';

export type ConfettiPiece = {
  id: string;
  color: string;
  delayMs: number;
  durationMs: number;
  leftPercent: number;
  rotationDeg: number;
  sizePx: number;
  variant: number;
};

export type ConfettiBurst = {
  id: string;
  kind: CelebrationKind;
  pieces: ConfettiPiece[];
};

type ConfettiOptions = {
  count?: number;
  durationMs?: number;
  kind?: CelebrationKind;
};

const confettiColors = [
  'var(--color-primary)',
  'var(--color-secondary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
];

const bursts = ref<ConfettiBurst[]>([]);
let sequence = 0;

export function useConfetti() {
  return {
    bursts: computed(() => bursts.value),
    celebrate,
    clear: clearConfetti,
  };
}

export function celebrate(options: ConfettiOptions = {}): string {
  const id = `confetti-${++sequence}`;
  const count = options.count ?? 44;
  const durationMs = options.durationMs ?? 2400;
  const kind = options.kind ?? 'confetti';

  bursts.value = [
    ...bursts.value,
    {
      id,
      kind,
      pieces: Array.from({ length: count }, (_, index) => confettiPiece(id, index, durationMs)),
    },
  ];

  globalThis.setTimeout(() => {
    bursts.value = bursts.value.filter((burst) => burst.id !== id);
  }, durationMs + 400);

  return id;
}

export function clearConfetti(): void {
  bursts.value = [];
}

function confettiPiece(burstId: string, index: number, durationMs: number): ConfettiPiece {
  return {
    id: `${burstId}-piece-${index}`,
    color: confettiColors[index % confettiColors.length] ?? 'var(--color-primary)',
    delayMs: Math.round(Math.random() * 260),
    durationMs: durationMs + Math.round(Math.random() * 420),
    leftPercent: 30 + Math.random() * 40,
    rotationDeg: Math.round(Math.random() * 720 - 360),
    sizePx: 6 + Math.round(Math.random() * 6),
    variant: index % 6,
  };
}
