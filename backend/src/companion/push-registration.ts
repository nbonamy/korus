import { z } from 'zod';

/** One validation boundary for persisted phone consent and relay delivery. */
export const pushRegistrationSchema = z.object({
  token: z.string().min(1).max(4096),
  transport: z.enum(['apns', 'fcm']).optional(),
  environment: z.enum(['development', 'production']),
  authorization: z.object({ expiresAt: z.number().int().positive(), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict().optional(),
}).strict().refine(value => value.transport === 'fcm' ? /^[!-~]+$/.test(value.token) : /^[a-f0-9]{32,512}$/.test(value.token), { message: 'Invalid push token.', path: ['token'] });
