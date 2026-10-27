import { describe, expect, it } from 'vitest';
import type { Agent } from '../contracts';
import { projectAgentMentionLabels, projectWorkspaceSidebar, repositoryIconForAgent } from '../workspace-sidebar';

const projectSidebar = (input: Omit<Parameters<typeof projectWorkspaceSidebar>[0], 'quickChatsLabel'>) => (
  projectWorkspaceSidebar({ ...input, quickChatsLabel: 'Quick chats' })
);

describe('workspace sidebar projection', () => {
  it('groups primary checkouts and linked worktrees beneath the canonical repository', () => {
    const agents = [
      gitAgent('agent-main', 'Main conversation', '/src/agent-workspace', 'main', false),
      gitAgent('agent-feature', 'Implement routing', '/src/agent-workspace-routing', 'feat/routing', true),
    ];

    expect(projectSidebar({
      agents,
      activeAgentId: 'agent-feature',
      unreadAgentIds: ['agent-main'],
    })).toStrictEqual([{
      id: 'git:/src/agent-workspace',
      kind: 'repository',
      label: 'agent-workspace',
      repositoryRoot: '/src/agent-workspace',
      repositoryKey: '/src/agent-workspace',
      sessions: [{
        agentId: 'agent-main',
        customName: 'Main conversation',
        conversationTitle: null,
        displayTitle: 'Main conversation',
        branch: 'main',
        folder: '/src/agent-workspace',
        isLinkedWorktree: false,
        kind: 'main',
        isActive: false,
        isUnread: true,
        status: { type: 'idle' },
        quickSwitchIndex: 0,
      }, {
        agentId: 'agent-feature',
        customName: 'Implement routing',
        conversationTitle: null,
        displayTitle: 'Implement routing',
        branch: 'feat/routing',
        folder: '/src/agent-workspace-routing',
        isLinkedWorktree: true,
        kind: 'worktree',
        isActive: true,
        isUnread: false,
        status: { type: 'working' },
        quickSwitchIndex: 1,
      }],
    }]);
  });

  it.each([
    ['trunk', 'trunk', false, 'main'],
    ['main', 'trunk', false, 'branch'],
    ['master', 'trunk', false, 'branch'],
    ['trunk', 'trunk', true, 'worktree'],
    ['feature', 'trunk', true, 'worktree'],
    ['main', null, false, 'branch'],
  ] as const)('classifies %s with default %s and linked=%s as %s', (branch, defaultBranch, linked, kind) => {
    const agent = gitAgent('agent', null, '/src/project', branch, linked);
    if (agent.workspace?.kind !== 'git') throw new Error('Expected Git fixture');
    agent.workspace = { ...agent.workspace, defaultBranch };
    expect(projectSidebar({ agents: [agent], activeAgentId: null })[0]?.sessions[0]?.kind).toBe(kind);
  });

  it('classifies ordinary branches, detached heads, and folder sessions for presentation', () => {
    const branch = gitAgent('agent-branch', 'Branch', '/src/repo', 'feat/sidebar', false);
    const detached = gitAgent('agent-detached', 'Detached', '/src/repo-detached', 'main', false);
    if (detached.workspace?.kind === 'git') detached.workspace = { ...detached.workspace, branch: null };
    const folder = baseAgent('agent-folder', 'Notes', '/src/notes');

    expect(projectSidebar({ agents: [branch, detached, folder], activeAgentId: null }))
      .toMatchObject([
        { sessions: [{ kind: 'branch' }, { kind: 'detached' }] },
        { sessions: [{ kind: 'folder' }] },
      ]);
  });

  it('groups folder agents by folder and reserves Quick chats for quick-chat sessions', () => {
    const folderAgent = baseAgent('agent-notes', 'Scratchpad', '/src/notes');
    folderAgent.workspace = {
      kind: 'folder',
      folder: '/src/notes',
      label: 'notes',
      updatedAt: '2026-08-27T12:00:00.000Z',
    };
    const secondFolderAgent = baseAgent('agent-notes-two', 'Research', '/src/notes');
    const unclassified = baseAgent('agent-loose', 'Uninitialized', '/tmp/loose');
    const repo = gitAgent('agent-sdk', 'SDK work', '/src/codex-app-sdk', 'main', false, '/src/codex-app-sdk');
    const quickChat: Agent = { ...baseAgent('agent-chat', null, '/src/notes'), folder: null, sessionKind: 'quickChat' };

    expect(projectSidebar({ agents: [folderAgent, repo, secondFolderAgent, unclassified, quickChat], activeAgentId: null }))
      .toMatchObject([{
        id: 'folder:/src/notes',
        kind: 'folder',
        label: 'notes',
        sessions: [{ agentId: 'agent-notes' }, { agentId: 'agent-notes-two' }],
      }, {
        id: 'git:/src/codex-app-sdk',
        kind: 'repository',
        label: 'codex-app-sdk',
        sessions: [{ agentId: 'agent-sdk' }],
      }, {
        id: 'folder:/tmp/loose',
        kind: 'folder',
        label: 'loose',
        sessions: [{ agentId: 'agent-loose' }],
      }, {
        id: 'quick-chats',
        kind: 'quickChats',
        label: 'Quick chats',
        sessions: [{ agentId: 'agent-chat' }],
      }]);
  });

  it('keeps durable quick chats out of repositories and uses their conversation title', () => {
    const quickChat: Agent = {
      ...baseAgent('agent-chat', null, '/unused'),
      folder: null,
      sessionKind: 'quickChat',
    };
    quickChat.conversationTitle = 'Release planning';

    expect(projectSidebar({ agents: [quickChat], activeAgentId: quickChat.id }))
      .toMatchObject([{
        kind: 'quickChats',
        sessions: [{ displayTitle: 'Release planning', branch: null, folder: null, kind: 'folder' }],
      }]);
  });

  it('uses agent names without mixing them with branch names', () => {
    const first = gitAgent('agent-one', 'Fix tests', '/src/repo-one', 'feat/one', true);
    const second = gitAgent('agent-two', 'Review tests', '/src/repo-two', 'feat/one', true);

    expect(projectSidebar({ agents: [first, second], activeAgentId: null })[0]?.sessions)
      .toMatchObject([
        { displayTitle: 'Fix tests' },
        { displayTitle: 'Review tests' },
      ]);
  });

  it('projects tracked pull request state into its agent session', () => {
    const agent = gitAgent('agent-pr', 'PR work', '/src/repo-pr', 'feat/pr', true);
    agent.pullRequest = {
      provider: 'github',
      repository: 'owner/repo',
      branch: 'feat/pr',
      number: 7,
      title: 'Ship the feature',
      url: 'https://github.com/owner/repo/pull/7',
      draft: false,
      headSha: 'abc123',
      state: 'merged',
      mergedAt: '2026-09-03T12:00:00.000Z',
      createdAt: '2026-09-03T11:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
    };

    expect(projectSidebar({ agents: [agent], activeAgentId: null })[0]?.sessions[0]?.pullRequest)
      .toStrictEqual(agent.pullRequest);
  });

  it('prefers the explicit agent name over the conversation title', () => {
    const agent = gitAgent('agent-one', 'Custom agent', '/src/repo-one', 'feat/one', true);
    agent.conversationTitle = 'Current thread title';

    expect(projectSidebar({ agents: [agent], activeAgentId: null })[0]?.sessions[0])
      .toMatchObject({ customName: 'Custom agent', conversationTitle: 'Current thread title', displayTitle: 'Custom agent' });
  });

  it('disambiguates matching names only within the same repository', () => {
    const first = gitAgent('agent-one', 'Fix tests', '/src/repo-one', 'feat/one', true);
    const second = gitAgent('agent-two', 'Fix tests', '/src/repo-two', 'feat/two', true);

    expect(projectSidebar({ agents: [first, second], activeAgentId: null })[0]?.sessions.map(({ displayTitle }) => displayTitle))
      .toStrictEqual(['Fix tests · feat/one', 'Fix tests · feat/two']);
    expect(projectAgentMentionLabels([first, second], 'Quick chats')).toStrictEqual([
      { agentId: 'agent-one', label: 'Fix tests · feat/one · agent-workspace/feat/one' },
      { agentId: 'agent-two', label: 'Fix tests · feat/two · agent-workspace/feat/two' },
    ]);
    const otherRepository = gitAgent('other-repo', 'Fix tests', '/src/other-repo', 'feat/one', false, '/src/other-repo');
    const thirdRepository = gitAgent('third-repo', 'Fix tests', '/src/third-repo', 'feat/one', false, '/src/third-repo');
    const quickChat: Agent = { ...baseAgent('chat-one', 'Fix tests', '/unused'), sessionKind: 'quickChat', folder: null };
    const secondChat: Agent = { ...quickChat, id: 'chat-two' };
    const folder = baseAgent('folder-one', 'Fix tests', '/src/notes');
    const secondFolder = { ...folder, id: 'folder-two' };
    expect(projectSidebar({ agents: [first, second, otherRepository, thirdRepository, quickChat, secondChat, folder, secondFolder], activeAgentId: null })
      .flatMap(group => group.sessions.map(session => ({ id: session.agentId, title: session.displayTitle }))))
      .toStrictEqual([
        { id: first.id, title: 'Fix tests · feat/one' },
        { id: second.id, title: 'Fix tests · feat/two' },
        { id: otherRepository.id, title: 'Fix tests' },
        { id: thirdRepository.id, title: 'Fix tests' },
        { id: quickChat.id, title: 'Fix tests' },
        { id: secondChat.id, title: 'Fix tests' },
        { id: folder.id, title: 'Fix tests' },
        { id: secondFolder.id, title: 'Fix tests' },
      ]);
    const owner = { ...first, name: 'Sharing', conversationTitle: 'Sharing' };
    const collaborator: Agent = { ...owner, id: 'shared-copy', sessionKind: 'quickChat', folder: null, workspace: undefined, backendSession: undefined, sharedConversation: { joinId: 'shared-join' } };
    expect(projectSidebar({ agents: [owner, collaborator], activeAgentId: owner.id })
      .flatMap(group => group.sessions.map(session => ({ id: session.agentId, title: session.displayTitle }))))
      .toStrictEqual([{ id: owner.id, title: 'Sharing' }, { id: collaborator.id, title: 'Sharing' }]);
  });

  it('falls back to the branch when an agent has no name', () => {
    const agent = gitAgent('agent-unnamed', '   ', '/src/repo', 'feat/sidebar', true);
    agent.conversationTitle = 'Previous conversation';

    expect(projectSidebar({ agents: [agent], activeAgentId: null })[0]?.sessions[0])
      .toMatchObject({ customName: null, conversationTitle: 'Previous conversation', displayTitle: 'feat/sidebar' });
  });

  it('keeps duplicate unnamed branch labels literal across repositories', () => {
    const first = gitAgent('agent-one', null, '/src/id8', 'main', false, '/src/id8');
    const second = gitAgent('agent-two', null, '/src/computer-use', 'main', false, '/src/computer-use');

    expect(projectSidebar({ agents: [first, second], activeAgentId: null })
      .flatMap(({ sessions }) => sessions.map(({ displayTitle }) => displayTitle)))
      .toStrictEqual(['main', 'main']);
  });

  it('removes the repository prefix from an unnamed agent branch', () => {
    const agent = gitAgent('agent-unnamed', null, '/src/agent-workspace-work-routing', 'agent-workspace-work-routing', true);

    expect(projectSidebar({ agents: [agent], activeAgentId: null })[0]?.sessions[0])
      .toMatchObject({ displayTitle: 'work-routing' });
  });

  it('uses the Git origin as the stable repository preference key', () => {
    const agent = gitAgent('agent-origin', 'Origin', '/src/agent-workspace-worktree', 'feat/icons', true);
    if (agent.workspace?.kind === 'git') agent.workspace.originUrl = 'git@github.com:nbonamy/agent-workspace.git';

    expect(projectSidebar({ agents: [agent], activeAgentId: null })[0]).toMatchObject({
      repositoryRoot: '/src/agent-workspace',
      repositoryKey: 'remote:github.com/nbonamy/agent-workspace',
    });
  });

  it('resolves agent identity from the repository icon catalog', () => {
    const agent = gitAgent('agent-origin', 'Origin', '/src/agent-workspace-worktree', 'feat/icons', true);
    if (agent.workspace?.kind === 'git') agent.workspace.originUrl = 'git@github.com:nbonamy/agent-workspace.git';

    expect(repositoryIconForAgent(agent, {
      'remote:github.com/nbonamy/agent-workspace': '🦞',
    })).toBe('🦞');
    expect(repositoryIconForAgent(agent, {})).toBeUndefined();
    expect(repositoryIconForAgent(baseAgent('agent-folder', 'Folder', '/src/folder'), {
      '/src/folder': '📁',
    })).toBeUndefined();
  });

  it('falls back to persisted repository roots when migrating icon keys', () => {
    const agent = gitAgent('agent-origin', 'Origin', '/src/agent-workspace-worktree', 'feat/icons', true);
    if (agent.workspace?.kind === 'git') agent.workspace.originUrl = 'git@github.com:nbonamy/agent-workspace.git';

    expect(repositoryIconForAgent(agent, { '/src/agent-workspace': '🧠' })).toBe('🧠');
  });
});

function baseAgent(id: string, name: string | null, folder: string): Agent {
  return {
    id,
    teamId: 'team-test',
    name,
    folder,
    backend: 'codex',
    status: { type: 'idle' },
    createdAt: '2026-08-27T12:00:00.000Z',
    updatedAt: '2026-08-27T12:00:00.000Z',
  };
}

function gitAgent(
  id: string,
  name: string | null,
  folder: string,
  branch: string,
  linked: boolean,
  primaryWorktreeRoot = '/src/agent-workspace',
): Agent {
  const agent = baseAgent(id, name, folder);
  agent.status = id === 'agent-feature' ? { type: 'working' } : { type: 'idle' };
  agent.workspace = {
    kind: 'git',
    folder,
    repositoryName: primaryWorktreeRoot.split('/').at(-1)!,
    repositoryRoot: folder,
    branch,
    isLinkedWorktree: linked,
    primaryWorktreeRoot,
    updatedAt: '2026-08-27T12:00:00.000Z',
  };
  return agent;
}
