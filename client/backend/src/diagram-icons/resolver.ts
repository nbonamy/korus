import { fromBuffer, type ZipFile, type Entry } from 'yauzl';
import type { DiagramIconImage } from '@workspace/core/diagram-icon';

// TypeScript port of caru-ini/stack-diagram/scripts/fetch_icons.py (MIT).
// Copyright (c) 2026 caru-ini. Full upstream license: ../bundled-skills/korus-stack-diagram/SKILL.md.
export type ResolvedDiagramIcon = { name: string; asset: DiagramIconImage; darkAsset?: DiagramIconImage };
type Source = { source: DiagramIconImage['source']; url: string; darkUrl?: string };
const maxImage = 2 * 1024 * 1024;
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases: Record<string, string> = {
  s3: 'Amazon-Simple-Storage-Service',
  glacier: 'Amazon-Simple-Storage-Glacier',
  sqs: 'Amazon-Simple-Queue-Service',
  sns: 'Amazon-Simple-Notification-Service',
  ses: 'Amazon-Simple-Email-Service',
  ecs: 'Amazon-Elastic-Container-Service',
  ecr: 'Amazon-Elastic-Container-Registry',
  eks: 'Amazon-Elastic-Kubernetes-Service',
  elb: 'Elastic-Load-Balancing',
  alb: 'Elastic-Load-Balancing',
  nlb: 'Elastic-Load-Balancing',
  rds: 'Amazon-RDS',
  iam: 'AWS-Identity-and-Access-Management',
  kms: 'AWS-Key-Management-Service',
  msk: 'Amazon-Managed-Streaming-for-Apache-Kafka',
  opensearch: 'Amazon-OpenSearch-Service',
  vpc: 'Virtual-private-cloud-VPC',
};

export class DiagramIconResolver {
  constructor(private readonly options: { fetch?: typeof fetch } = {}) {}

  async fetchIcon(spec: string): Promise<ResolvedDiagramIcon | null> {
    return this.resolve(parseSpec(spec));
  }

  private async resolve(parsed: ReturnType<typeof parseSpec>): Promise<ResolvedDiagramIcon | null> {
    let result: ResolvedDiagramIcon | null = null;
    if (parsed.aws) {
      try {
        const index = await this.awsIndex();
        const query = norm(aliases[norm(parsed.aws)] ?? parsed.aws);
        const item = index.get(query) ?? [...index].find(([name]) => name.replace(/^(aws|amazon)/, '') === query)?.[1];
        if (item) {
          const asset = image(item.bytes, item.url, 'aws');
          const darkAsset = item.dark && image(item.dark.bytes, item.dark.url, 'aws');
          if (asset) result = { name: parsed.name, asset, ...(darkAsset ? { darkAsset } : {}) };
        }
      } catch {
        return null;
      }
    } else {
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

  private async awsIndex() {
    const page = (await this.get('https://aws.amazon.com/architecture/icons/')).toString();
    const match = page.match(/(?:https:)?\/\/[\w.-]+\.awsstatic\.com\/[^"'\s]+\/Icon-package_[^"'\s/]+\.zip/);
    if (!match) throw new Error('AWS icon package is unavailable.');
    const url = new URL(match[0], 'https://aws.amazon.com').href;
    const entries = await archiveIcons(await this.get(url, 80 * 1024 * 1024));
    const index = new Map<string, { bytes: Buffer; url: string; dark?: { bytes: Buffer; url: string } }>();
    for (const [file, bytes] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
      const match = file.match(
        /Architecture-Service-Icons_[^/]+\/[^/]+\/64\/Arch_(.+)_64\.svg$|Architecture-Group-Icons_[^/]+\/(.+)_32\.svg$|Resource-Icons_[^/]+\/Res_General-Icons\/Res_48_Light\/Res_(.+)_48_Light\.svg$/,
      );
      if (!match) continue;
      const name = norm(match[1] ?? match[2] ?? `General-${match[3]}`);
      const dark = match[3] ? file.replaceAll('_Light', '_Dark') : file.slice(0, -4) + '_Dark.svg';
      if (!index.has(name))
        index.set(name, {
          bytes,
          url: url + '#' + file,
          ...(entries.has(dark) ? { dark: { bytes: entries.get(dark)!, url: url + '#' + dark } } : {}),
        });
    }
    return index;
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
  const aws = slug.startsWith('aws/')
    ? slug.slice(4)
    : ['aws', 'amazonwebservices'].includes(norm(slug))
      ? 'AWS-Cloud-logo'
      : slug.toLowerCase().startsWith('aws-')
        ? slug.slice(4)
        : undefined;
  return { name, slug, url, aws };
}
function assertSource(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !(
      /^(?:api\.)?svgl\.app$/.test(url.hostname) ||
      ['raw.githubusercontent.com', 'cdn.jsdelivr.net', 'aws.amazon.com'].includes(url.hostname) ||
      /^[a-z0-9.-]+\.awsstatic\.com$/.test(url.hostname)
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
async function archiveIcons(bytes: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(bytes, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) =>
      error ? reject(error) : resolve(zip!),
    ),
  );
  const result = new Map<string, Buffer>();
  let total = 0,
    count = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        if (++count > 50_000) {
          reject(new Error('AWS icon archive exceeds the entry limit.'));
          return;
        }
        if (!entry.fileName.endsWith('.svg') || entry.uncompressedSize > maxImage || entry.isEncrypted()) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error ?? new Error('Invalid AWS icon archive.'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('error', reject);
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            total += chunk.length;
            if (size > maxImage || total > 40 * 1024 * 1024)
              stream.destroy(new Error('AWS icons exceed the expansion limit.'));
            else chunks.push(chunk);
          });
          stream.on('end', () => {
            result.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
    return result;
  } finally {
    zip.close();
  }
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
