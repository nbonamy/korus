import { product } from './product';
import type { Mission, MissionRun, MissionStage } from './mission-types';

export type {
  MissionArtifactReadResult,
  MissionArtifactWriteInput,
  MissionDelivery,
  MissionExecution,
  MissionExecutionInput,
  MissionResultInput,
  MissionRun,
  MissionReviewFindingInput,
  MissionReviewFindingUpdateInput,
  MissionTicketDraftInput,
  MissionTicketDraftResult,
  MissionToolContext,
  MissionWorkspace,
} from './mission-types';

export type MissionImplementationStartProgress = {
  missionId: string;
  phase: 'creatingWorktrees' | 'initializingWorkspaces' | 'startingAgents';
  repositoryCount: number;
  ticketCount: number;
};

export function pendingMissionRun(mission: Mission): MissionRun | undefined {
  return mission.execution?.runs.slice().reverse().find(run => ['preparing', 'running', 'awaitingReview'].includes(run.status));
}

export function missionDeveloperInstructions(mission: Mission, run: MissionRun, repositories: string[] = []): string {
  const instructions: Record<MissionStage, string> = {
    requirements: "Treat the user's first message as the beginning of requirements shaping. Repository attachment is optional. Code implementation is not authorized.",
    tickets: 'Continue as the same Mission orchestrator with approved requirements. Repository research may be delegated to represented repositories; code implementation and tracker publication are not authorized.',
    implementation: `Implement ONLY ticket ${(run.ticketIndex ?? 0) + 1} in ${run.repositoryPath ?? 'the assigned repository'} until reassigned by ${product.name} or the user. Leave coherent local commits for review. Submission accepts implementation, not tracker issue closure. No push, merge or PR is authorized.`,
    review: 'Inspect the Mission changes against approved requirements and tickets. The user controls approval, selected remediation and delivery; inspection grants no fixes, push, merge or PR authority.',
    ship: 'Shipping is controlled by the Mission workspace. Do not start an agent run for this stage.',
  };
  const context = [
    `Mission: ${mission.outcome}`,
    `Stage: ${run.stage}.`,
    `Repositories currently represented in the team: ${repositories.length ? repositories.join(', ') : 'none'}.`,
    mission.execution?.workspaces?.length
      ? `Mission workspace ${mission.execution.workspaceName ?? ''}:\n${mission.execution.workspaces.map(workspace => `- ${workspace.repositoryPath} -> ${workspace.path} at ${workspace.baseSha ?? 'unavailable'}`).join('\n')}\n${run.stage === 'review'
        ? 'During Review, you may inspect every listed isolated Mission worktree. When remediation is requested, edit only the listed Mission worktree matching each finding repository. Do not edit source checkouts or unrelated worktrees.'
        : 'Work only in your assigned isolated worktree. Do not edit source checkouts or other Mission worktrees.'}`
      : mission.execution?.workspace
        ? `Mission baseline commit: ${mission.execution.workspace.baseSha ?? 'unavailable'}. Work only in the isolated mission worktree: ${mission.execution.workspace.path}. Do not edit the source checkout or other worktrees.`
      : `This stage runs from the ${product.name}-owned mission home. No Git worktree is attached yet.`,
    `This is an explicitly assigned Mission task. The ${product.name}-owned Mission skill controls its procedure; repository instructions own project conventions. User approval of artifacts and delivery remains required.`,
    instructions[run.stage],
    run.skills.length ? `Load the assigned procedure through ${product.mcpServerName} MCP before acting: ${run.skills.map(skill => `read-skill with name="${skill.name}"`).join(', ')}.` : 'This stage has no agent-run skill.',
    run.feedback ? `User-provided context and feedback:\n${run.feedback}` : '',
    `Accepted artifacts (authoritative structured context):\n${JSON.stringify(mission.artifacts, null, 2)}`,
    `Canonical artifact revisions (read content with ${product.mcpServerName}.read-mission-artifact):\n${JSON.stringify(mission.artifactFiles ?? {}, null, 2)}`,
    `Submit with ${product.mcpServerName}.submit-mission-result; update only your stage or assigned ticket. ${run.stage === 'implementation' ? `${product.name} aggregates implementation evidence; the user decides when to continue to Review.` : 'Submission proposes a result for user review; it does not approve the stage.'}`,
  ].filter(Boolean).join('\n\n');
  return `<context>\n${context}\n</context>`;
}
