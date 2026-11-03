import type { DiagramIconImage } from '@workspace/core/diagram-icon';

// TypeScript port of caru-ini/stack-diagram/scripts/fetch_icons.py (MIT).
// Copyright (c) 2026 caru-ini. Full upstream license: ../bundled-skills/korus-stack-diagram/SKILL.md.
export type ResolvedDiagramIcon = { name: string; asset: DiagramIconImage; darkAsset?: DiagramIconImage };
type Source = { source: DiagramIconImage['source']; url: string; darkUrl?: string };
const maxImage = 2 * 1024 * 1024;
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export class DiagramIconResolver {
  constructor(private readonly options: { fetch?: typeof fetch } = {}) {}

  async fetchIcon(spec: string): Promise<ResolvedDiagramIcon | null> {
    return this.resolve(parseSpec(spec));
  }

  private async resolve(parsed: ReturnType<typeof parseSpec>): Promise<ResolvedDiagramIcon | null> {
    let result: ResolvedDiagramIcon | null = null;
    const sources: Source[] = parsed.url
      ? [{ source: 'explicit', url: parsed.url }]
      : parsed.slug.startsWith('lucide/')
        ? [{ source: 'lucide', url: `https://cdn.jsdelivr.net/npm/lucide-static/icons/${parsed.slug.slice(7)}.svg` }]
        : [
            ...(await this.svgl(parsed.slug)),
            {
              source: 'devicon',
              url: `https://raw.githubusercontent.com/devicons/devicon/master/icons/${parsed.slug}/${parsed.slug}-original.svg`,
            },
            ...[`${parsed.slug}-icon`, parsed.slug].map((name) => ({
              source: 'gilbarbara' as const,
              url: `https://cdn.jsdelivr.net/gh/gilbarbara/logos/logos/${name}.svg`,
            })),
          ];
    for (const candidate of sources) {
      try {
        let bytes = await this.get(candidate.url);
        if (candidate.source === 'lucide')
          bytes = Buffer.from(
            bytes
              .toString()
              .replaceAll('stroke="currentColor"', 'stroke="#3d4660"')
              .replaceAll('stroke-width="2"', 'stroke-width="1.25"'),
          );
        const asset = image(bytes, candidate.url, candidate.source);
        if (!asset) continue;
        let darkAsset: DiagramIconImage | null = null;
        if (candidate.darkUrl)
          try {
            darkAsset = image(await this.get(candidate.darkUrl), candidate.darkUrl, candidate.source);
          } catch {
            /* Light variant remains usable. */
          }
        result = { name: parsed.name, asset, ...(darkAsset ? { darkAsset } : {}) };
        break;
      } catch {
        /* Follow upstream's next source; never replace with a fuzzy match. */
      }
    }
  
    return result;
  }

  private async svgl(slug: string): Promise<Source[]> {
    const queries = new Set([
      slug,
      slug.replace(/[-_.]+/g, ' ').trim(),
      ...(slug.length > 4 && slug.endsWith('js') ? [slug.slice(0, -2)] : []),
    ]);
    const names = new Set([norm(slug), ...(slug.length > 4 && slug.endsWith('js') ? [norm(slug.slice(0, -2))] : [])]);
    for (const query of queries)
      try {
        const items: unknown = JSON.parse(
          (await this.get(`https://api.svgl.app?search=${encodeURIComponent(query)}`)).toString(),
        );
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (typeof item.title !== 'string' || !names.has(norm(item.title))) continue;
          const route = item.route;
          if (typeof route === 'string') return [{ source: 'svgl', url: route }];
          if (route && typeof route === 'object' && typeof (route.light ?? route.dark) === 'string')
            return [
              {
                source: 'svgl',
                url: route.light ?? route.dark,
                ...(route.light && route.dark ? { darkUrl: route.dark } : {}),
              },
            ];
        }
      } catch {
        /* Try separators and the alternate official source chain. */
      }
    return [];
  }

  private async get(raw: string, limit = maxImage): Promise<Buffer> {
    let url = raw;
    for (let hop = 0; hop < 5; hop++) {
      assertSource(url);
      const response = await (this.options.fetch ?? fetch)(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'diagram-icon-resolver/1' },
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location');
        await response.body?.cancel();
        if (!next) throw new Error('Invalid icon redirect.');
        url = new URL(next, url).href;
        continue;
      }
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new Error('Icon source unavailable.');
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > limit) throw new Error('Icon response exceeds the byte limit.');
        chunks.push(Buffer.from(part));
      }
      return Buffer.concat(chunks);
    }
    throw new Error('Too many icon redirects.');
  }
}

function parseSpec(spec: string) {
  if (typeof spec !== 'string' || !spec || spec.length > 500) throw new Error('Invalid icon specification.');
  const equal = spec.indexOf('=');
  const colon = spec.indexOf(':');
  const name = equal >= 0 ? spec.slice(0, equal) : colon >= 0 ? spec.slice(0, colon) : spec.replaceAll('/', '-');
  const slug = equal >= 0 ? '' : colon >= 0 ? spec.slice(colon + 1) : spec.toLowerCase().replaceAll(' ', '');
  if (
    !/^[A-Za-z0-9_-]+$/.test(name) ||
    (!slug && equal < 0) ||
    (slug && !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(slug)) ||
    slug.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error('Invalid icon specification.');
  const url = equal >= 0 ? spec.slice(equal + 1) : undefined;
  if (url) assertSource(url);
  return { name, slug, url };
}
function assertSource(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(
      /^(?:api\.)?svgl\.app$/.test(url.hostname) || ['raw.githubusercontent.com', 'cdn.jsdelivr.net'].includes(url.hostname)
    )
  )
    throw new Error('Unsupported icon source.');
}
function image(bytes: Buffer, url: string, source: DiagramIconImage['source']): DiagramIconImage | null {
  if (bytes.length < 50 || bytes.length > maxImage) return null;
  const text = bytes.toString('utf8');
  const svg = /^\s*(?:(?:<\?xml[^>]*>|<!--[\s\S]*?-->)\s*)*<svg[\s>]/i.test(text);
  if (
    svg &&
    /<(?:script|foreignObject|iframe|object|embed)\b|<!DOCTYPE|<\?xml-stylesheet|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|javascript:|data:)/i.test(
      text,
    )
  )
    return null;
  const mimeType = svg
    ? 'image/svg+xml'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'image/jpeg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : null;
  if (!mimeType) return null;
  const paints = [...text.matchAll(/(?:fill|stroke|stop-color)[=:]\s*"?([#a-zA-Z][^";\s>]*)/g)]
    .map((match) => match[1]!)
    .filter(
      (paint) => !['none', 'transparent', 'currentColor', 'currentcolor'].includes(paint) && !paint.startsWith('url('),
    );
  const whiteFill = svg && paints.length > 0 && paints.every((paint) => /^(?:#fff(?:fff)?|white)$/i.test(paint));
  return {
    mimeType,
    base64: bytes.toString('base64'),
    source,
    sourceUrl: url,
    whiteFill,
  };
}
export const diagramIcons = new DiagramIconResolver();

export async function fetchTechIcon(icon: string, resolver: DiagramIconResolver = diagramIcons) {
  const result = await resolver.fetchIcon(icon);
  return result
    ? {
        found: true as const,
        name: result.name,
        ...result.asset,
        ...(result.darkAsset ? { dark: result.darkAsset } : {}),
      }
    : { found: false as const, icon };
}
