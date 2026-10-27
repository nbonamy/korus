import type { AppSnapshot } from '@workspace/core/contracts';
import * as z from 'zod/v4';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export type StartedMission = { missionId: string; outcome: string };
export type MissionStartInput = {
  outcome: string;
  prompt: string;
  backend?: 'codex' | 'claude' | 'antigravity';
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
};

/** Lets an ordinary agent start a Mission from the conversation, the way /mission asks it to. */
export function createMissionStartToolModuleProvider(options: {
  snapshot: AppSnapshot;
  startMission: (agentId: string, input: MissionStartInput) => Promise<StartedMission>;
}): AppMcpToolModuleProvider {
  return {
    id: 'mission-start',
    resolve: ({ agentId }) => {
      const agent = options.snapshot.agents.find(candidate => candidate.id === agentId);
      // Mission workers run inside a Mission already; they never start another one.
      const isMissionWorker = options.snapshot.missions?.some(mission => mission.execution?.runs.some(run => run.workerId === agentId));
      if (!agent?.teamId || isMissionWorker) return undefined;
      return {
        id: 'mission-start',
        register: server => {
          server.registerTool('create-mission', {
            description: 'Start a Mission only when the user asks for one (for example with /mission). Creates the Mission on this agent’s team, sends your brief to its lead as the first message and opens it for the user. Does not do the work. Example: {"outcome":"Add CSV export to the reporting page","prompt":"Goal: …\\nConstraints: …\\nSuccess: …"}.',
            inputSchema: z.strictObject({
              outcome: z.string().trim().min(1).max(200).describe('One-line title of the desired result, at most 120 characters.'),
              prompt: z.string().trim().min(1).max(20_000).describe('Complete, self-contained first message for the Mission lead: goal, constraints, decisions made and how success is checked.'),
            backend: z.enum(['codex', 'claude', 'antigravity']).optional().describe('Provider for the Mission lead. Defaults to this agent’s provider. Set it only when the user asks for one.'),
            model: z.string().trim().min(1).optional().describe('Model for the Mission lead, as the provider names it. Defaults to this agent’s model. Set it only when the user asks for one; an unknown model is rejected with the available ones.'),
            reasoningEffort: z.string().trim().min(1).optional().describe('Reasoning effort for the Mission lead. Needs model.'),
            serviceTier: z.string().trim().min(1).optional().describe('Service tier for the Mission lead, for example a fast mode, as the model offers it. Needs model. Rejected with the supported tiers when the model has none.'),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
          }, ({ outcome, prompt, backend, model, reasoningEffort, serviceTier }) => loggedToolResult('create-mission', { agentId, outcomeLength: outcome.length, promptLength: prompt.length, backend, model }, async () => {
            const started = await options.startMission(agentId, { outcome, prompt, ...(backend ? { backend } : {}), ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}), ...(serviceTier ? { serviceTier } : {}) });
            return { success: true, missionId: started.missionId, outcome: started.outcome, message: 'The Mission was started and opened for the user.' };
          }));
        },
      };
    },
  };
}
