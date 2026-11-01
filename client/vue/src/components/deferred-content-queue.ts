/** A thread opens with many cut rows at once: they are read a couple at a time rather than flooding the daemon connection. */
const limit = 2;
let active = 0;
const waiting: (() => void)[] = [];

export async function acquireContentRead(): Promise<void> {
  if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

export function releaseContentRead(): void {
  active--;
  waiting.shift()?.();
}
