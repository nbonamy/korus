import type { AppSnapshot } from '@workspace/core/contracts';
import type { WorktreeManager } from '../worktrees/worktree-manager';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

export function createWorktreeInitializationToolModuleProvider(snapshot: AppSnapshot, manager: WorktreeManager): AppMcpToolModuleProvider {
  return {
    id: 'worktree-initialization',
    resolve: ({ agentId }) => {
      const agent = snapshot.agents.find(candidate => candidate.id === agentId);
      if (!agent?.folder || (!agent.worktreeInitialization && !manager.getInitializationState(agent.folder))) return;
      return {
        id: 'worktree-initialization',
        register: server => server.registerTool('wait-for-worktree-initialization', {
          description: 'Wait for your worktree’s background setup to finish before running dependency-dependent checks, changing installation inputs or committing. Does not start setup again. No parameters.',
          inputSchema: {},
        }, (_input, extra) => loggedToolResult('wait-for-worktree-initialization', { agentId }, async () => {
          const state = await manager.waitForInitialization(agent.folder!, extra.signal) ?? agent.worktreeInitialization;
          if (state?.state === 'error') throw new Error(state.error ?? 'Worktree initialization failed.');
          return { success: true, state: state?.state ?? 'complete' };
        })),
      };
    },
  };
}
