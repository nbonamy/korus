import type { Agent, AppSnapshot, BackendModelOption, ClaudeConversationSnapshot, RendererMessage } from '@workspace/core/contracts';
import type { Mission } from '@workspace/core/missions';
import type { MissionRun } from '@workspace/core/mission-execution';

const sessionPrefix = 'mission-screenshot:';
const repositories = ['/workspace/orbit-api', '/workspace/orbit-web'];
const branch = 'feat/team-invitations';
export const missionScreenshotModel: BackendModelOption = {
  id: 'claude-sonnet-4-6', model: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', isDefault: true,
};

/** Reserved synthetic sessions never reach a provider, including after a daemon restart. */
export function isMissionScreenshotAgent(agent: Agent): boolean {
  return agent.backendSession?.kind === 'claude' && agent.backendSession.sessionId.startsWith(sessionPrefix);
}

export function applyMissionScreenshotFixture(snapshot: AppSnapshot, missionId: string, now = new Date().toISOString()): Mission {
  const mission = snapshot.missions?.find(candidate => candidate.id === missionId);
  if (!mission) throw new Error('Mission not found.');
  const team = snapshot.teams.find(candidate => candidate.id === mission.teamId);
  if (!team) throw new Error('Mission team not found.');
  const at = (minutes: number) => new Date(Date.parse(now) - minutes * 60_000).toISOString();
  const agents = [
    { role: 'lead', name: 'Mira', repository: 0, working: false },
    { role: 'api', name: 'Ava', repository: 0, working: true },
    { role: 'web', name: 'Noah', repository: 1, working: false },
  ].map(({ role, name, repository, working }): Agent => ({
    id: `${missionId}-screenshot-${role}`, teamId: team.id, name,
    folder: repositories[repository]!, backend: 'claude',
    backendSession: { kind: 'claude', sessionId: `${sessionPrefix}${missionId}:${role}`, transport: 'stdio' },
    backendDefaults: { kind: 'claude', model: missionScreenshotModel.model, userSelectedModel: true },
    workspace: { kind: 'git', folder: repositories[repository]!, repositoryName: repositories[repository]!.split('/').at(-1)!,
      repositoryRoot: repositories[repository]!, primaryWorktreeRoot: repositories[repository]!, branch, isLinkedWorktree: true, updatedAt: now },
    status: { type: working ? 'working' : 'idle' },
    ...(working ? { statusText: 'Testing invitation delivery and retries' } : {}),
    createdAt: at(24), updatedAt: now,
  }));
  for (const agent of agents) {
    const index = snapshot.agents.findIndex(candidate => candidate.id === agent.id);
    if (index < 0) snapshot.agents.push(agent);
    else snapshot.agents[index] = agent;
  }
  // Workers belong to the Mission, rather than adding duplicate sidebar teammates.
  const [lead, api, web] = agents as [Agent, Agent, Agent];
  const run = (id: string, stage: MissionRun['stage'], worker: Agent, status: MissionRun['status'], minutes: number): MissionRun => ({
    id: `${missionId}-screenshot-${id}`, stage, memberId: worker.id, workerId: worker.id,
    status, skills: [], feedback: '', startedAt: at(minutes), ...(status === 'accepted' ? { finishedAt: at(minutes - 3) } : {}),
  });
  mission.outcome = 'Ship team invitations';
  mission.stage = 'implementation';
  mission.status = 'active';
  mission.artifacts = {
    requirements: {
      problem: 'Let workspace owners invite teammates by email, with a secure invitation link and a clear acceptance flow.',
      acceptance: '- Invitations expire after 7 days and can only be used once.\n- Email delivery is retried safely.\n- New teammates land in the correct workspace.\n- Expired and already-used links show helpful recovery actions.',
    },
    tickets: [
      { id: 'mission-ticket-invite-tokens', title: 'Create secure invitation links', body: 'Add single-use tokens, workspace roles, and seven-day expiry. Cover invalid, expired, and reused links.', repositoryPath: repositories[0], done: true },
      { id: 'mission-ticket-invite-email', title: 'Send invitation emails', body: 'Queue branded emails with safe retries and deduplication. Connect delivery to the invitation endpoint.', repositoryPath: repositories[0], dependsOn: [0], done: false },
      { id: 'mission-ticket-invite-ui', title: 'Build the invitation experience', body: 'Add the invite dialog, pending invitations, and an accessible acceptance flow with expired-link recovery.', repositoryPath: repositories[1], done: true },
    ],
    implementation: { changes: 'Secure invitation links and the web experience are complete. Email delivery is in progress.', tests: 'API: 24 tests passing. Web: 18 tests and accessibility checks passing.' },
    review: { summary: '', pullRequestUrl: '', findings: [] },
  };
  const tokens = { ...run('tokens', 'implementation', api, 'accepted', 20), ticketIndex: 0, ticketId: 'mission-ticket-invite-tokens', repositoryPath: repositories[0],
    implementationResult: { changes: 'Added hashed, single-use invitation tokens with workspace roles and seven-day expiry.', tests: '24 API tests pass, including expiry, replay protection, and workspace isolation.' } };
  const email = { ...run('email', 'implementation', api, 'running', 5), ticketIndex: 1, ticketId: 'mission-ticket-invite-email', repositoryPath: repositories[0] };
  const ui = { ...run('ui', 'implementation', web, 'accepted', 17), ticketIndex: 2, ticketId: 'mission-ticket-invite-ui', repositoryPath: repositories[1],
    implementationResult: { changes: 'Built the invite dialog, pending invitation list, and acceptance screens with recovery states.', tests: '18 web tests pass. Keyboard navigation and accessibility checks pass.' } };
  mission.stageAgentIds = { requirements: lead.id, tickets: lead.id, implementation: api.id };
  mission.artifactFiles = {};
  mission.execution = {
    teamId: team.id, debugFixture: true, memberIds: [api.id, web.id], workspaceName: 'team-invitations',
    workspaces: repositories.map(repositoryPath => ({ repositoryPath, path: repositoryPath, branch })),
    runs: [run('requirements', 'requirements', lead, 'accepted', 24), run('tickets', 'tickets', lead, 'accepted', 21), tokens, email, ui],
  };
  mission.revision += 1;
  mission.updatedAt = now;
  return mission;
}

/** Regenerated from the persisted fixture identity, without provider transcript files. */
export function missionScreenshotConversation(snapshot: AppSnapshot, agentId: string): ClaudeConversationSnapshot | null {
  const agent = snapshot.agents.find(candidate => candidate.id === agentId);
  if (!agent || !isMissionScreenshotAgent(agent)) return null;
  const mission = snapshot.missions?.find(candidate => candidate.execution?.debugFixture
    && candidate.execution.runs.some(run => run.workerId === agentId));
  if (!mission) return null;
  const role = agentId.endsWith('-lead') ? 'lead' : agentId.endsWith('-api') ? 'api' : 'web';
  const busy = role === 'api';
  const turnId = `${agentId}-turn`;
  const createdAt = mission.updatedAt;
  const text = (id: string, role: RendererMessage['role'], content: string): RendererMessage => ({
    id: `${agentId}-${id}`, agentId, role, status: 'complete', turnId, createdAt, parts: [{ type: 'text', text: content }],
  });
  const messages: RendererMessage[] = role === 'lead' ? [
    text('request', 'user', 'Add team invitations across the API and web app. Keep the flow simple, secure, and ready to ship.'),
    text('plan', 'assistant', 'I split this into three tickets across **orbit-api** and **orbit-web**. Ava owns the API; Noah owns the web experience. Both are working on `feat/team-invitations`.'),
    text('progress', 'assistant', '**Two of three tickets are complete.**\n\n- Ava finished secure, single-use invitation links. All 24 API tests pass.\n- Noah finished the invite dialog and acceptance flow. All 18 web tests pass, including expired links and keyboard navigation.\n- Ava is connecting email delivery and checking retry behavior.\n\nOnce delivery checks pass, I’ll bring both repositories into review together.'),
  ] : role === 'api' ? [
    text('request', 'user', 'Implement secure invitation links, then connect invitation email delivery. Keep retries idempotent and cover expiry and replay protection.'),
    text('tokens', 'assistant', 'The invitation endpoints are ready. Tokens are hashed at rest, expire after seven days, and can only be accepted once. Workspace roles are enforced on both creation and acceptance.'),
    { ...text('tests', 'assistant', ''), parts: [{ type: 'tool', id: `${agentId}-tests`, kind: 'command', title: 'npm test -- invitations', status: 'completed', body: '✓ token creation and expiry\n✓ single-use acceptance\n✓ workspace isolation\n\n24 tests passed' }] },
    { ...text('delivery', 'assistant', ''), parts: [{ type: 'tool', id: `${agentId}-delivery`, kind: 'command', title: 'npm test -- invitation-delivery', status: 'running', body: 'Checking email delivery, retry behavior, and deduplication…' }] },
    text('email', 'assistant', 'Secure invitation links are complete, with **24 API tests passing**.\n\nI’m connecting the email queue and checking delivery retries. Each job uses the invitation ID as its deduplication key, so a retry won’t send the same invitation twice.\n\nNext: verify the email link opens Noah’s acceptance flow, then hand this repository back for review.'),
  ] : [
    text('request', 'user', 'Build the invitation experience: invite dialog, pending invitations, and acceptance screens. Include expired-link recovery and keyboard navigation.'),
    text('work', 'assistant', 'The invite dialog and pending invitation list are complete. The acceptance screen handles valid, expired, and already-used links, with a clear path back to the workspace.'),
    { ...text('tests', 'assistant', ''), parts: [{ type: 'tool', id: `${agentId}-tests`, kind: 'command', title: 'npm test -- invitations', status: 'completed', body: '18 tests passed\nAccessibility: no violations\nKeyboard navigation: passed' }] },
    text('done', 'assistant', 'Ready for review. **18 tests pass**, and the dialog works entirely from the keyboard. I used the shared form and dialog components so the new screens match the rest of the app.'),
  ];
  return {
    agentId, sessionId: agent.backendSession!.kind === 'claude' ? agent.backendSession!.sessionId : null,
    activeTurnId: busy ? turnId : null, turnIds: [turnId],
    turns: [{ id: turnId, status: busy ? 'inProgress' : 'completed', error: null, willRetry: false, startedAt: createdAt,
      completedAt: busy ? null : createdAt, durationMs: busy ? null : 180_000 }],
    messages, answeredClientRequestIds: [], busy, historyLoading: false,
    historyState: { hasOlder: false, loadingOlder: false }, contextUsage: null, plan: null, error: null,
  };
}
