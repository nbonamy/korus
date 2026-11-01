import { z } from 'zod';
import { pushRegistrationSchema } from './push-registration';

const fields = { token: z.string().regex(/^[a-fA-F0-9]{32,512}$/), environment: z.enum(['development', 'production']),
  authorization: pushRegistrationSchema.shape.authorization };
export const liveActivityRegistrationSchema = z.discriminatedUnion('kind', [
  z.object({ ...fields, kind: z.literal('start') }).strict(),
  z.object({ ...fields, kind: z.literal('update'), instanceId: z.uuid() }).strict(),
]);
export const liveActivityPushSchema = z.object({ hostId: z.string().min(1).max(128), instanceId: z.uuid(),
  startedAt: z.number().int().positive().safe(), timestamp: z.number().int().positive().safe(), event: z.enum(['start', 'update', 'end']),
  state: z.object({ hostName: z.string().max(160).optional(), active: z.number().int().min(0).max(1_000_000).optional(), running: z.number().int().min(0).max(1_000_000), attention: z.number().int().min(0).max(1_000_000),
    agents: z.array(z.object({ id: z.string().min(1).max(128), name: z.string().max(160), detail: z.string().max(200),
      backend: z.enum(['codex', 'claude', 'antigravity']).optional(), startedAt: z.number().int().positive().safe().optional(),
      status: z.enum(['idle', 'working', 'approval', 'question', 'waiting', 'error']) }).strict()).max(2), more: z.number().int().min(0).max(1_000_000) }).strict() }).strict();
