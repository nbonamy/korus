import type { AgentGitDiff, AgentGitDiffTarget, AppSnapshot } from '@workspace/core/contracts';
import { fileKinds, type KindBreakdown } from '@workspace/core/file-kind';
import * as z from 'zod/v4';
import { McpToolError } from './agent-coordinator';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

const scopes = ['uncommitted', 'unstaged', 'staged', 'branch', 'commit'] as const;

/** Lets an agent size up its own changes: how much, and how much of it is code, tests, docs or other. */
export function createGitDiffStatsToolModuleProvider(options: {
  snapshot: AppSnapshot;
  diff: (folder: string, target: Exclude<AgentGitDiffTarget, { type: 'turn' }>) => Promise<AgentGitDiff>;
}): AppMcpToolModuleProvider {
  return {
    id: 'git-diff-stats',
    resolve: ({ agentId }) => {
      if (!options.snapshot.agents.find(candidate => candidate.id === agentId)?.folder) return undefined;
      return {
        id: 'git-diff-stats',
        register: server => {
          server.registerTool('get-diff-stats', {
            description: 'Sizes up the changes in this agent’s repository by file type (code, test, docs, other): lines added and removed and files changed, in total and per type. scope picks what to compare: uncommitted (default: staged, unstaged and untracked), unstaged, staged, branch (everything since the merge-base with the base branch, uncommitted work included) or commit (needs sha). Use it to check how much of a change is tests or docs before deciding what to review or write next. Example: {"scope":"branch"}.',
            inputSchema: z.strictObject({
              scope: z.enum(scopes).default('uncommitted').describe('Which changes to measure.'),
              baseRef: z.string().trim().min(1).optional().describe('Only for scope "branch": the ref to compare against. Defaults to the repository’s base branch.'),
              sha: z.string().trim().min(1).optional().describe('Only for scope "commit": the commit to measure.'),
            }),
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          }, ({ scope, baseRef, sha }) => loggedToolResult('get-diff-stats', { agentId, scope }, async () => {
            const folder = options.snapshot.agents.find(candidate => candidate.id === agentId)?.folder;
            if (!folder) throw new McpToolError('This agent has no working folder.');
            if (scope === 'commit' && !sha) throw new McpToolError('scope "commit" needs a sha.');
            const target: Exclude<AgentGitDiffTarget, { type: 'turn' }> = scope === 'commit'
              ? { type: 'commit', sha: sha! }
              : scope === 'branch'
                ? { type: 'branch', ...(baseRef ? { baseRef } : {}) }
                : { type: scope };
            const result = await options.diff(folder, target);
            const { addedLines, removedLines, changedFiles, byKind } = result.summary;
            return {
              scope,
              ...(result.target.type === 'branch' && result.target.baseRef ? { baseRef: result.target.baseRef } : {}),
              addedLines, removedLines, changedFiles,
              byKind: Object.fromEntries(fileKinds.map(kind => [kind, byKind?.[kind] ?? { addedLines: 0, removedLines: 0, changedFiles: 0 }])) as KindBreakdown,
            };
          }));
        },
      };
    },
  };
}
