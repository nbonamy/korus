import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { DiagramIconResolver } from '../resolver';

const svg = (paint = '#ef3340') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${paint}" d="M1 1h22v22H1z"/></svg>`;
function setup(fetcher: typeof fetch) {
  return { resolver: new DiagramIconResolver({ fetch: fetcher }) };
}
const response = (value: string | Buffer, status = 200) =>
  new Response(value as ConstructorParameters<typeof Response>[0], { status });

it('resolves exact svgl names and both variants, preserving brand bytes with fresh network retrieval on every call', async () => {
  const light = svg(),
    dark = svg('#ffffff');
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('api.svgl.app'))
      return Response.json([
        {
          title: 'Vue',
          route: { light: 'https://svgl.app/library/vue.svg', dark: 'https://svgl.app/library/vue-dark.svg' },
        },
      ]);
    return response(url.includes('dark') ? dark : light);
  });
  const { resolver } = await setup(fetcher);
  const first = await resolver.fetchIcon('front:vue');
  const second = await resolver.fetchIcon('front:vue');
  expect(first).toStrictEqual(second);
  expect(first).toMatchObject({
    name: 'front',
    asset: { source: 'svgl', whiteFill: false },
    darkAsset: { whiteFill: true },
  });
  expect(Buffer.from(first!.asset.base64, 'base64').toString()).toBe(light);
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it('rejects fuzzy matches and follows devicon then gilbarbara fallbacks without changing colors', async () => {
  const requests: string[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('api.svgl.app'))
      return Response.json([{ title: 'Vue Router', route: 'https://svgl.app/library/wrong.svg' }]);
    return url.endsWith('/vue-icon.svg') ? response(svg()) : response('missing', 404);
  });
  const { resolver } = await setup(fetcher);
  expect(await resolver.fetchIcon('vue')).toMatchObject({ asset: { source: 'gilbarbara' } });
  expect(requests.some((url) => url.endsWith('wrong.svg'))).toBe(false);
  expect(requests.findIndex((url) => url.includes('devicons'))).toBeLessThan(
    requests.findIndex((url) => url.includes('gilbarbara')),
  );
});

it('ports AWS aliases, groups, general icons and dark variants with bounded archive reads', async () => {
  const archive = await readFile(new URL('./fixtures/aws.zip', import.meta.url));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) =>
      String(input).includes('.zip')
        ? response(archive)
        : response('<a href="https://d1.awsstatic.com/icons/Icon-package_Test.zip">Icons</a>'),
    );
  const { resolver } = await setup(fetcher);
  for (const icon of ['aws/lambda', 'aws/s3', 'aws/vpc', 'aws/General-User'])
    expect(await resolver.fetchIcon(icon)).toMatchObject({ asset: { source: 'aws' } });
  expect(await resolver.fetchIcon('aws/vpc')).toHaveProperty('darkAsset');
  expect(await resolver.fetchIcon('aws/not-a-service')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(12);
});

it('ports Lucide tinting and explicit source syntax, refusing active images and unsafe destinations', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input) =>
      response(
        String(input).includes('lucide-static')
          ? '<!-- @license lucide-static - ISC -->\n' + svg('currentColor').replace('<svg ', '<svg stroke-width="2" ').replace('fill=', 'stroke=')
          : '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    );
  const { resolver } = await setup(fetcher);
  const icon = await resolver.fetchIcon('store:lucide/database');
  expect(icon).toMatchObject({ asset: { source: 'lucide' } });
  expect(Buffer.from(icon!.asset.base64, 'base64').toString()).toContain('#3d4660');
  expect(Buffer.from(icon!.asset.base64, 'base64').toString()).toContain('stroke-width="1.25"');
  expect(await resolver.fetchIcon('bad=https://raw.githubusercontent.com/test/icon.svg')).toBeNull();
  for (const spec of [
    '../escape',
    'unsafe=http://127.0.0.1/private',
    'unsafe=https://example.com/private',
    'unsafe=https://raw.githubusercontent.com@127.0.0.1/private',
  ])
    await expect(resolver.fetchIcon(spec)).rejects.toThrow(/icon|source/i);
});

it('bounds response bytes and validates every redirect before making another request', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
  const { resolver } = await setup(fetcher);
  expect(await resolver.fetchIcon('logo=https://raw.githubusercontent.com/test/icon.svg')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(response('x'.repeat(2 * 1024 * 1024 + 1)));
  expect(await resolver.fetchIcon('large=https://raw.githubusercontent.com/test/large.svg')).toBeNull();
});
