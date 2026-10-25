import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'smol-toml';
import { z } from 'zod';
import { pricingHistorySchema, sourcePricingSchema } from '../backend/src/pricing/schema.ts';

const providers = ['openai', 'anthropic', 'google'];
const defaultOutput = fileURLToPath(new URL('../backend/src/pricing/history.json', import.meta.url));
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const commitSchema = z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) });
const treeSchema = z.object({
  sha, truncated: z.literal(false),
  tree: z.array(z.object({ path: z.string(), type: z.string(), sha })),
});

async function get(url, format = 'json') {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'korus-pricing-collector' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Pricing source HTTP ${response.status}: ${url}`);
  return format === 'json' ? response.json() : response.text();
}

// Object keys and set-like arrays do not change pricing. Overrides remain
// ordered: Models.dev merges matching overrides in order, then multiplies all
// matching factors. Reversing overlapping overrides can change the charge.
function normalize(value, key = '') {
  if (Array.isArray(value)) {
    const values = value.map((entry) => normalize(entry));
    if (['multipliers', 'in', 'all', 'any', 'serviceTiers', 'ttl', 'targets', 'urls'].includes(key)) {
      return values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
    }
    return values;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, normalize(value[name], name)]));
  }
  return value;
}

function pricingContent(snapshot) {
  return JSON.stringify(normalize(Object.fromEntries(providers.map((provider) => [provider,
    snapshot[provider].map(({ source: _source, ...model }) => model).sort((a, b) => a.id.localeCompare(b.id, 'en')),
  ]))));
}

async function collect({ apiBase, rawBase, now }) {
  const commit = commitSchema.parse(await get(`${apiBase}/repos/anomalyco/models.dev/commits/dev`));
  const revision = commit.sha;
  const tree = treeSchema.parse(await get(`${apiBase}/repos/anomalyco/models.dev/git/trees/${commit.commit.tree.sha}?recursive=1`));
  if (tree.sha !== commit.commit.tree.sha) throw new Error('Pricing source tree does not match pinned revision');
  const files = tree.tree.filter((entry) => /^providers\/(openai|anthropic|google)\/models\/.+\.toml$/.test(entry.path));
  if (new Set(files.map((entry) => entry.path)).size !== files.length) throw new Error('Duplicate source paths');
  for (const provider of providers) {
    if (!files.some((entry) => entry.path.startsWith(`providers/${provider}/models/`))) {
      throw new Error(`Missing required provider: ${provider}`);
    }
  }
  const snapshot = Object.fromEntries(providers.map((provider) => [provider, []]));
  // Bound concurrent raw requests; each path and blob is pinned to the same tree.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
    while (cursor < files.length) {
      const entry = files[cursor++];
      if (entry.type !== 'blob' || entry.path.split('/').some((part) => part === '..' || part === '.')) {
        throw new Error(`Invalid source file: ${entry.path}`);
      }
      const text = await get(`${rawBase}/anomalyco/models.dev/${revision}/${entry.path}`, 'text');
      const blobSha = createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
      if (blobSha !== entry.sha) throw new Error(`Pricing source blob mismatch: ${entry.path}`);
      let authored;
      try { authored = sourcePricingSchema.parse(parse(text)); }
      catch (error) { throw new Error(`Invalid pricing source: ${entry.path}`, { cause: error }); }
      const provider = entry.path.split('/')[1];
      const model = {
        id: entry.path.slice(`providers/${provider}/models/`.length, -5), provider,
        ...(authored.base_model !== undefined ? { canonicalId: authored.base_model } : {}),
        availability: authored.cost === undefined ? 'unpriced' : 'priced',
        ...(authored.cost !== undefined ? { cost: authored.cost } : {}),
        ...(authored.capabilities?.service_tier !== undefined ? { serviceTiers: authored.capabilities.service_tier } : {}),
        ...(authored.capabilities?.cache !== undefined ? { cache: authored.capabilities.cache } : {}),
        ...(authored.experimental?.modes !== undefined ? { modes: authored.experimental.modes } : {}),
        source: {
          path: entry.path, blobSha,
          urls: [...new Set(text.split('\n').filter((line) => line.trimStart().startsWith('#'))
            .flatMap((line) => [...line.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0])))].sort(),
        },
      };
      snapshot[provider].push(normalize(model));
    }
  }));
  for (const provider of providers) snapshot[provider].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return {
    ...snapshot,
    provenance: { repository: 'https://github.com/anomalyco/models.dev', revision, collectedAt: now.toISOString(), schemaVersion: 1, currency: 'USD' },
  };
}

export async function updatePricing({ outputPath = defaultOutput, apiBase = 'https://api.github.com', rawBase = 'https://raw.githubusercontent.com', now = new Date() } = {}) {
  const collected = await collect({ apiBase, rawBase, now });
  await mkdir(path.dirname(outputPath), { recursive: true });
  // Serialize competing collectors through replacement, so both observe the
  // latest history. A failed process leaves its lock for explicit inspection.
  const lockPath = `${outputPath}.lock`;
  const lock = await open(lockPath, 'wx');
  const temporary = `${outputPath}.${randomUUID()}.tmp`;
  try {
    let history = [];
    try { history = pricingHistorySchema.parse(JSON.parse(await readFile(outputPath, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const snapshot = { date: history.length ? now.toISOString() : '2026-10-01T00:00:00.000Z', ...collected };
    // Validate even if identical: bad collections must not masquerade as no-ops.
    pricingHistorySchema.parse([{ ...snapshot, date: '2026-10-01T00:00:00.000Z' }]);
    if (history.length && pricingContent(snapshot) === pricingContent(history.at(-1))) return { changed: false, snapshots: history.length };
    const next = [...history, snapshot];
    pricingHistorySchema.parse(next);
    const file = await open(temporary, 'wx');
    try { await file.writeFile(`${JSON.stringify(next, null, 2)}\n`); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, outputPath);
    return { changed: true, snapshots: next.length };
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: npm run pricing:update');
    const result = await updatePricing();
    console.log(`[pricing] ${result.changed ? 'appended snapshot' : 'unchanged'} (${result.snapshots} total)`);
  } catch (error) {
    console.error('[pricing] collection failed; history was preserved:', error);
    process.exitCode = 1;
  }
}
