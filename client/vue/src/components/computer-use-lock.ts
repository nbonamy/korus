import type { ComputerUseLockHold } from '@workspace/core/contracts';
import type { ComputedRef, InjectionKey } from 'vue';

/** What the sidebar's lock control needs: whether it applies, and the current on-demand hold. */
export type ComputerUseLock = {
  state: ComputedRef<{ visible: boolean; hold: ComputerUseLockHold }>;
  setHold(hold: ComputerUseLockHold): Promise<void>;
};

export const computerUseLockKey: InjectionKey<ComputerUseLock> = Symbol('computerUseLock');

const hourMs = 60 * 60_000;
const morningHour = 9;

/** The next morning, local time. Before 5 AM it is still the same night, so the same day's 9:00 counts. */
export function nextMorning(now: Date): number {
  const morning = new Date(now);
  morning.setHours(morningHour, 0, 0, 0);
  if (now.getHours() >= 5) morning.setDate(morning.getDate() + 1);
  return morning.getTime();
}

export function holdExpiries(now: Date): { hour: number; morning: number } {
  return { hour: now.getTime() + hourMs, morning: nextMorning(now) };
}

export function isHoldActive(hold: ComputerUseLockHold, now: number): hold is { until: number | null } {
  return hold !== false && (hold.until === null || hold.until > now);
}

export function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}
