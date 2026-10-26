import type { AppSnapshot } from '@workspace/core/contracts';
import * as z from 'zod/v4';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export type StartedMission = { missionId: string; outcome: string };

/** Lets an ordinary agent start a Mission from the conversation, the way /mission asks it to. */
export function createMissionStartToolModuleProvider(options: {
  snapshot: AppSnapshot;
  startMission: (agentId: string, input: { outcome: string; prompt: string }) => Promise<StartedMission>;
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
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
          }, ({ outcome, prompt }) => loggedToolResult('create-mission', { agentId, outcomeLength: outcome.length, promptLength: prompt.length }, async () => {
            const started = await options.startMission(agentId, { outcome, prompt });
            return { success: true, missionId: started.missionId, outcome: started.outcome, message: 'The Mission was started and opened for the user.' };
          }));
        },
      };
    },
  };
}
