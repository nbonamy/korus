import { z } from 'zod';

// Models.dev v2 price semantics. Token/character prices are USD per million;
// other units are USD per unit. Cache storage is per million tokens per hour,
// and web_search is per thousand calls. Neither is a token-consumption charge.
const rate = z.number().finite().nonnegative();
const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/);
const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const condition = z.union([
  z.strictObject({ equals: scalar }),
  z.strictObject({ in: z.array(scalar).min(1) }),
  z.strictObject({ gt: z.union([z.string(), z.number().finite()]) }),
  z.strictObject({ gte: z.union([z.string(), z.number().finite()]) }),
  z.strictObject({ lt: z.union([z.string(), z.number().finite()]) }),
  z.strictObject({ lte: z.union([z.string(), z.number().finite()]) }),
]);

type Predicate = { [key: string]: unknown };
const when: z.ZodType<Predicate> = z.lazy(() => z.object({
  all: z.array(when).min(1).optional(), any: z.array(when).min(1).optional(), not: when.optional(),
}).catchall(condition).refine((value) => Object.keys(value).length > 0));

type Factor = number | { [key: string]: Factor };
const factor: z.ZodType<Factor> = z.lazy(() => z.union([
  rate, z.record(z.string().min(1), factor).refine((value) => Object.keys(value).length > 0),
]));
const cachePrices = z.strictObject({
  read: rate.optional(),
  write: z.union([rate, z.record(duration, rate).refine((value) => Object.keys(value).length > 0)]).optional(),
  storage: rate.optional(),
});
const cacheCost = cachePrices.extend({ explicit: cachePrices.optional() });
const inputPrices = z.strictObject({ price: rate, cache: cacheCost.optional() });
const outputPrices = z.strictObject({ price: rate, reasoning: rate.optional() });
const unit = z.enum(['token', 'character', 'image', 'megapixel', 'second', 'minute']);
const input = inputPrices.extend({
  unit: unit.default('token'),
  overrides: z.array(inputPrices.partial().extend({ when })).optional(),
});
const output = outputPrices.extend({
  unit: unit.default('token'),
  overrides: z.array(outputPrices.partial().extend({ when })).optional(),
});
const modality = z.strictObject({ input: input.optional(), output: output.optional() });
const cost = z.strictObject({
  text: modality.optional(), image: modality.optional(), audio: modality.optional(), video: modality.optional(),
  web_search: z.strictObject({
    price: rate,
    overrides: z.array(z.strictObject({ when, price: rate.optional() })).optional(),
  }).optional(),
  multipliers: z.array(z.strictObject({ when, factor })).optional(),
}).refine((value) => ['text', 'image', 'audio', 'video', 'web_search'].some((key) => key in value), {
  message: 'Cost must contain a priced category',
});

const cacheKind = z.strictObject({
  ttl: z.array(duration).optional(),
  min_tokens: z.number().int().nonnegative().optional(),
});
const cacheSupport = z.union([
  z.literal(false),
  z.strictObject({
    implicit: z.union([z.literal(true), cacheKind]).optional(),
    explicit: z.union([z.literal(true), cacheKind.extend({
      max_breakpoints: z.number().int().positive().optional(), targets: z.array(z.string()).optional(),
    })]).optional(),
  }),
]);
const modes = z.record(z.string().min(1), z.strictObject({
  service_tier: z.string().min(1).optional(), cost: cost.optional(),
  // Retain the source mapping from named modes to request fields. These are
  // configuration evidence, not evidence that a request was served at that tier.
  body: z.record(z.string(), z.json()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  capabilities: z.record(z.string(), z.json()).optional(),
}));

// Validate every pricing-bearing field while allowing unrelated model metadata.
export const sourcePricingSchema = z.object({
  schema: z.literal(2),
  name: z.string().min(1).optional(),
  base_model: z.string().min(1).optional(),
  cost: cost.optional(),
  capabilities: z.object({ service_tier: z.array(z.string().min(1)).optional(), cache: cacheSupport.optional() }).optional(),
  experimental: z.object({ modes: modes.optional() }).optional(),
}).refine((value) => value.name !== undefined || value.base_model !== undefined, {
  message: 'Source model needs a name or base_model',
});

const provider = z.enum(['openai', 'anthropic', 'google']);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const model = z.strictObject({
  id: z.string().min(1), provider,
  canonicalId: z.string().min(1).optional(),
  availability: z.enum(['priced', 'unpriced']),
  cost: cost.optional(),
  serviceTiers: z.array(z.string().min(1)).optional(),
  cache: cacheSupport.optional(),
  modes: modes.optional(),
  source: z.strictObject({ path: z.string().min(1), blobSha: sha, urls: z.array(z.url()) }),
}).refine((value) => (value.availability === 'priced') === (value.cost !== undefined), {
  message: 'Unpriced models must omit cost; priced models must retain cost',
});

const snapshot = z.strictObject({
  date: z.iso.datetime(),
  openai: z.array(model).min(1), anthropic: z.array(model).min(1), google: z.array(model).min(1),
  provenance: z.strictObject({
    repository: z.literal('https://github.com/anomalyco/models.dev'),
    revision: sha, collectedAt: z.iso.datetime(), schemaVersion: z.literal(1), currency: z.literal('USD'),
  }),
}).superRefine((value, context) => {
  for (const name of ['openai', 'anthropic', 'google'] as const) {
    const models = value[name];
    if (models.some((entry) => entry.provider !== name) || new Set(models.map((entry) => entry.id)).size !== models.length) {
      context.addIssue({ code: 'custom', message: `Invalid or duplicate ${name} identity` });
    }
    if (!models.some((entry) => entry.availability === 'priced')) {
      context.addIssue({ code: 'custom', message: `No priced models for required provider ${name}` });
    }
  }
});

export const pricingHistorySchema = z.array(snapshot).min(1).superRefine((history, context) => {
  if (history[0].date !== '2026-10-01T00:00:00.000Z') {
    context.addIssue({ code: 'custom', message: 'Initial pricing date must be October 1, 2026 UTC' });
  }
  for (let index = 1; index < history.length; index += 1) {
    if (Date.parse(history[index].date) <= Date.parse(history[index - 1].date)) {
      context.addIssue({ code: 'custom', message: 'Pricing snapshots must have increasing timestamps' });
    }
  }
});

export type PricingHistory = z.infer<typeof pricingHistorySchema>;
