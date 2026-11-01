/** Short, language-neutral age such as "5m", "3h" or "2d"; `justNow` covers the first minute. */
export function formatCompactAge(timestamp: string | undefined, now: number, justNow: string): string {
  const time = Date.parse(timestamp ?? '');
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return justNow;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** Elapsed time down to the second, such as "45s", "3m 12s" or "1h 5m", for a live timer. */
export function formatElapsed(timestamp: string | undefined, now: number): string {
  const time = Date.parse(timestamp ?? '');
  if (!Number.isFinite(time)) return '';
  const seconds = Math.floor(Math.max(0, now - time) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
