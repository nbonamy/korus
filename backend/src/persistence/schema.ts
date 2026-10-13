import { z } from 'zod';
import type { AccountRateLimits, AppGeneralSettings, AppThemeSettings, Automation, RemoteConnection, SourceFolderState, SubagentNode, Team, WorkBacklogAssignment, WorkBacklogState } from '@workspace/core/contracts';
import { isAgentBackend } from '@workspace/core/contracts/shared';
import type { Mission } from '@workspace/core/missions';
import { isVisualization } from '@workspace/core/visualize';
import { StoreFormatError } from './store-format';
import type { StoredRosterAgent, RosterData, SettingsData, VisualizationData } from './layout';
import type { BrowserBookmark } from '@workspace/core/browser-bookmarks';

/*
 * Roster schema 2; settings and visualization schema 1. Known fields and supported engine
 * blocks are validated, but additive fields are tolerated; unknown engines stay opaque.
 * Entities that keep their long-standing shape (agents' inner fields, missions,
 * automations, settings...) are checked as objects here and repaired by the existing
 * entity sanitizers when the state is joined back together.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const entity = <T>(label: string) => z.custom<T>(isRecord, `${label} must be an object`);

const engineSchema = z.discriminatedUnion('kind', [
  z.looseObject({
    kind: z.literal('antigravity'),
    session: z.looseObject({ sessionId: z.string() }).optional(),
    settings: z.looseObject({}).optional(),
  }),
  z.looseObject({
    kind: z.literal('codex'),
    session: z.looseObject({ threadId: z.string() }).optional(),
    settings: z.looseObject({}).optional(),
  }),
  z.looseObject({
    kind: z.literal('claude'),
    session: z.looseObject({ sessionId: z.string(), transport: z.enum(['stdio', 'websocket']) }).optional(),
    settings: z.looseObject({}).optional(),
  }),
]);

const agentSchema = z.custom<StoredRosterAgent>(
  (value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.engine)
      || typeof value.engine.kind !== 'string' || !value.engine.kind.trim()) return false;
    return !isAgentBackend(value.engine.kind)
      || engineSchema.safeParse(value.engine).success;
  },
  'agent must have an id and a valid engine block',
);

export const rosterSchema = z.looseObject({
  activeTeamId: z.string().nullable(),
  teams: z.array(entity<Team>('team')),
  agents: z.array(agentSchema),
  automations: z.array(entity<Automation>('automation')),
  missions: z.array(entity<Mission>('mission')).optional(),
  workAssignments: z.record(z.string(), entity<WorkBacklogAssignment>('work assignment')),
  subagents: z.record(z.string(), z.looseObject({
    rootConversationId: z.string(),
    nodes: z.record(z.string(), entity<SubagentNode>('subagent node')),
  })),
  accountRateLimits: entity<AccountRateLimits>('account rate limits').optional(),
}) satisfies z.ZodType<RosterData>;

export const settingsSchema = z.looseObject({
  settings: entity<AppGeneralSettings>('settings'),
  browserBookmarksByClient: z.record(z.string(), z.array(entity<BrowserBookmark>('browser bookmark'))).optional(),
  theme: entity<AppThemeSettings>('theme'),
  sourceFolder: entity<SourceFolderState>('source folder'),
  remoteConnections: z.array(entity<RemoteConnection>('remote connection')),
  workIntegrations: z.looseObject({
    connections: z.array(entity<WorkBacklogState['connections'][number]>('work integration connection')),
    providerConfigurations: entity<WorkBacklogState['providerConfigurations']>('provider configurations'),
    providerSettings: entity<WorkBacklogState['providerSettings']>('provider settings'),
  }),
}) satisfies z.ZodType<SettingsData>;

export const visualizationSchema = z.looseObject({
  repository: z.string().min(1),
  position: z.number().int().min(0),
  visualization: z.custom<VisualizationData['visualization']>(isVisualization, 'visualization is not valid'),
}) satisfies z.ZodType<VisualizationData>;

export function parseData<T>(file: string, schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
  throw new StoreFormatError(`${file} is invalid${where}: ${issue?.message ?? 'unknown problem'}. Restore it from the backups folder.`);
}
