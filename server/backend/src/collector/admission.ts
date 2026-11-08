import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";

export function normalizedAddress(value: string): string | null {
  const version = isIP(value);
  if (version === 4) return value;
  if (version === 6 && !value.includes("%")) {
    const address = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(address);
    if (mapped) {
      const high = parseInt(mapped[1]!, 16),
        low = parseInt(mapped[2]!, 16);
      return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return address;
  }
  return null;
}

type Window = { times: number[]; updated: number; tokens: number };
const CAPACITY = 4096;
/** Bounded, process-local keyed hashes only. No persistent rate-limit state,
 * exported metrics labels or logging; restart deliberately forgets it. */
export class CollectorAdmission {
  private readonly key = randomBytes(32);
  private readonly sources = new Map<string, Window>();
  private readonly installs = new Map<string, Window>();
  private active = 0;

  enter(): boolean {
    if (this.active >= 20) return false;
    this.active++;
    return true;
  }
  leave(): void {
    this.active--;
  }

  source(address: string, now: number): number {
    return this.limit(this.sources, address, now, 60_000, 60, true);
  }
  install(id: string, now: number): number {
    return this.limit(this.installs, id, now, 60_000, 30, false);
  }
  private limit(
    map: Map<string, Window>,
    value: string,
    now: number,
    duration: number,
    maximum: number,
    burst: boolean,
  ): number {
    const hash = createHmac("sha256", this.key).update(value).digest("hex");
    let state = map.get(hash);
    if (!state) {
      // Only reclaim expired entries. Evicting a live entry would reset its quota.
      for (const [key, entry] of map)
        if (now - entry.updated >= duration) map.delete(key);
      if (map.size >= CAPACITY) return Math.ceil(duration / 1000);
      state = { times: [], updated: now, tokens: 10 };
      map.set(hash, state);
    }
    state.times = state.times.filter((time) => time > now - duration);
    if (burst)
      state.tokens = Math.min(
        10,
        state.tokens + Math.max(0, now - state.updated) / 1000,
      );
    state.updated = now;
    if (state.times.length >= maximum)
      return Math.max(
        1,
        Math.min(
          duration / 1000,
          Math.ceil((state.times[0]! + duration - now) / 1000),
        ),
      );
    if (burst && state.tokens < 1)
      return Math.max(1, Math.ceil(1 - state.tokens));
    if (burst) state.tokens--;
    state.times.push(now);
    return 0;
  }
}
