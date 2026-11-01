import * as z from 'zod/v4';

const findingPriorities = ['p0', 'p1', 'p2', 'p3'] as const;
type FindingPriority = (typeof findingPriorities)[number];

/** Accepts either case ("P2" as written in review instructions, or "p2") and normalizes to lowercase. */
export const findingPrioritySchema = z
  .enum([...findingPriorities, ...findingPriorities.map((priority) => priority.toUpperCase() as Uppercase<FindingPriority>)])
  .transform((priority) => priority.toLowerCase() as FindingPriority)
  .describe(
  'Accepts p0, p1, p2, p3 or P0, P1, P2, P3. P0: drop everything; universally blocks release, operations, or major usage. P1: urgent; fix in the next cycle. P2: normal; fix eventually. P3: low; nice to have.',
);
export const findingTitleSchema = z.string().trim().min(1).max(80).describe('Imperative finding title, at most 80 characters.');
export const findingBodySchema = z.string().trim().min(1).max(100_000).describe('One concise Markdown paragraph explaining why this is a problem.');
