const baseMs = 1_000;
const capMs = 5_000;
const maxDoublings = 5;

/** Delays between reconnection attempts: 1 s doubling to a 5 s cap, jittered so phones do not retry in step. A person is waiting, and a refused dial is cheap. */
export function createBackoff(random: () => number = Math.random) {
  let attempts = 0;
  return {
    next: () => Math.min(capMs, baseMs * 2 ** Math.min(attempts++, maxDoublings)) * (0.8 + random() * 0.4),
    reset: () => { attempts = 0; },
  };
}
