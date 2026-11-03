import { z } from 'zod';
export const runProfileText = z.string().trim().min(1).max(4096).refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Use a single-line command without control characters.');
export const runProfileInputSchema = z.strictObject({ id: z.string().uuid().optional(), name: runProfileText.max(100), command: runProfileText, directory: runProfileText.default('.'), previewUrl: runProfileText.optional() });
export const storedRunProfileSchema = runProfileInputSchema.extend({ id: z.string().uuid() });
