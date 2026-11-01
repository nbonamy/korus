import { isIP } from 'node:net';

/**
 * Fixed-window counters with a bounded key set. Windows share one length, so insertion order is
 * expiry order. When full, the oldest window is evicted: flooding keys can reset counters but can
 * never lock honest clients out.
 */
export class WindowBudget {
  private readonly windows = new Map<string, { until: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys: number, private readonly now = Date.now) {}
  take(key: string): boolean {
    const now = this.now();
    for (const [expired, window] of this.windows) { if (window.until > now) break; this.windows.delete(expired); }
    let window = this.windows.get(key);
    // Expired windows can sit behind live ones after the wall clock steps back, which also
    // leaves windows reaching further ahead than their length.
    if (!window || window.until <= now || window.until - now > this.windowMs) {
      this.windows.delete(key);
      if (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value!);
      window = { until: now + this.windowMs, count: 0 };
      this.windows.set(key, window);
    }
    return ++window.count <= this.limit;
  }
}

/**
 * The scarce identity on an accountless relay. Peer identities cost nothing; an IPv4 address or
 * an IPv6 /64, the smallest prefix providers commonly assign one subscriber, does.
 */
export function sourceNetwork(ip: string): string | undefined {
  const address = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const version = isIP(address);
  if (version !== 6) return version === 4 ? address : undefined;
  // Rewrite an embedded IPv4 suffix as two hex groups so every address expands to eight.
  const hex = address.toLowerCase().replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_match, a, b, c, d) => `${(Number(a) * 256 + Number(b)).toString(16)}:${(Number(c) * 256 + Number(d)).toString(16)}`);
  const [head = '', tail] = hex.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = (tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right])
    .map((group) => Number.parseInt(group, 16));
  if (groups.slice(0, 6).join(':') === '0:0:0:0:0:65535') return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join('.');
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}
