import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BackendConversationRef } from '@workspace/core/contracts';
import type { AgentBackendDriver } from '@workspace/core/backend-driver';
import { codexBackendCapabilities } from '@workspace/core/backend-capabilities';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import type { AgentGitService } from '../git/agent-git-service';
import {
  createTestSnapshot,
  gitWorkspace,
  createTextMessage,
} from './server-test-fixtures';

describe('AppBackendServer', () => {
  it('offers the imagegen bridge alongside native skills only to eligible non-Codex agents', async () => {
    const snapshot = createTestSnapshot();
    const native = { name: 'review', path: '/skills/review/SKILL.md', enabled: true };
    const drivers = (['codex', 'claude', 'antigravity'] as const).map(backend => ({
      backend, listSkills: vi.fn(async () => [native]), getRuntimeStatus: vi.fn(), getCapabilities: vi.fn(),
      sendPrompt: vi.fn(), interrupt: vi.fn(), respondToAgentRequest: vi.fn(), onEvent: () => () => {}, close: vi.fn(),
    } satisfies AgentBackendDriver));
    snapshot.agents = drivers.map(({ backend }) => ({ id: backend, teamId: 'team-test', name: backend,
      backend, folder: '/repo', status: { type: 'idle' }, createdAt: 'created', updatedAt: 'updated' }));
    snapshot.teams[0]!.agentIds = snapshot.agents.map(agent => agent.id);
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: new BackendDriverRpc(new Map(drivers.map(driver => [driver.backend, driver]))) });
    const list = (agentId: string) => server.handleMessage({ jsonrpc: '2.0', id: 'skills', method: backendMethods.agentSkillsList, params: { agentId } });
    try {
      await expect(list('codex')).resolves.toMatchObject({ result: [native] });
      for (const backend of ['claude', 'antigravity']) {
        await expect(list(backend)).resolves.toMatchObject({ result: [native, {
          name: 'imagegen', path: 'korus:skill/korus-imagegen', scope: 'system', enabled: true,
          displayName: 'Image Gen', shortDescription: 'Generate or edit images for websites, games, and more',
        }] });
      }
      snapshot.general.providerEnabled = { codex: false };
      await expect(list('claude')).resolves.toMatchObject({ result: [native] });
      snapshot.general.providerEnabled = { codex: true };
      const ownImagegen = { ...native, name: 'imagegen' };
      drivers[1]!.listSkills.mockResolvedValue([ownImagegen]);
      await expect(list('claude')).resolves.toMatchObject({ result: [ownImagegen] });
    } finally { await server.close(); }
  });

  it.each([
    { outcome: 'success', discardChanges: false },
    { outcome: 'failure', discardChanges: true },
  ])('removes the agent before cleanup and handles $outcome without overwriting newer roster changes', async ({ outcome, discardChanges }) => {
    const snapshot = createTestSnapshot();
    const base = { teamId: 'team-test', backend: 'codex' as const, status: { type: 'idle' as const }, createdAt: 'created', updatedAt: 'updated' };
    const closing = { ...base, id: 'closing', name: 'Closing', folder: '/repo-feature', workspace: { ...gitWorkspace('/repo-feature', 'repo', 'feature'), primaryWorktreeRoot: '/repo', isLinkedWorktree: true } };
    const unrelated = { ...base, id: 'unrelated', name: 'Other repository', folder: '/other', workspace: gitWorkspace('/other', 'other', 'main') };
    const peer = { ...base, id: 'peer', name: 'Same repository', folder: '/repo', workspace: gitWorkspace('/repo', 'repo', 'main') };
    snapshot.agents = [closing, unrelated, peer];
    snapshot.teams[0]!.agentIds = snapshot.agents.map(agent => agent.id);
    snapshot.teams[0]!.activeAgentId = unrelated.id;
    snapshot.activeAgentId = unrelated.id;
    snapshot.clientPreferences = {
      desktop: { activeAgentId: closing.id, activeTeamId: 'team-test', activeAgentByTeam: { 'team-test': closing.id } },
      observer: { activeAgentId: unrelated.id, activeTeamId: 'team-test' },
    };
    let complete!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const validateLinkedWorktreeDeletion = vi.fn();
    const deleteLinkedWorktree = vi.fn(() => pending);
    const saved: typeof snapshot[] = [];
    const server = new AppBackendServer({ version: 'test', snapshot,
      agentGitService: { validateLinkedWorktreeDeletion, deleteLinkedWorktree } as unknown as AgentGitService,
      saveSnapshot: async value => { saved.push(structuredClone(value)); },
    });
    try {
      const closingPromise = server.handleMessage({ jsonrpc: '2.0', id: 'close', method: backendMethods.agentDelete,
        params: { agentId: closing.id, input: { deleteWorktree: true, deleteRemoteBranch: true, discardChanges, confirmed: true } } });
      await vi.waitFor(() => expect(deleteLinkedWorktree).toHaveBeenCalledOnce());
      expect(validateLinkedWorktreeDeletion).toHaveBeenCalledWith(closing.folder, true, undefined, discardChanges);
      expect(deleteLinkedWorktree).toHaveBeenCalledWith(closing.folder, true, undefined, discardChanges);
      expect(snapshot.agents.map(agent => agent.id)).toStrictEqual([unrelated.id, peer.id]);
      expect(saved[0]!.agents.some(agent => agent.id === closing.id)).toBe(false);
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'during', method: backendMethods.snapshotGet }))
        .resolves.toMatchObject({ result: { snapshot: { activeAgentId: peer.id } } });
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'observer', method: backendMethods.snapshotGet, params: { _clientId: 'observer' } }))
        .resolves.toMatchObject({ result: { snapshot: { activeAgentId: unrelated.id } } });
      // Another user action during cleanup must survive both completion and rollback.
      await server.handleMessage({ jsonrpc: '2.0', id: 'rename', method: backendMethods.teamUpdate, params: { input: { id: 'team-test', name: 'Renamed team', color: '#1B4FB2' } } });
      await server.handleMessage({ jsonrpc: '2.0', id: 'navigate', method: backendMethods.clientNavigationSelectAgent, params: { agentId: unrelated.id } });
      if (outcome === 'failure') {
        fail(new Error('Worktree is locked'));
        await expect(closingPromise).rejects.toThrow('Worktree is locked');
        expect(snapshot.agents.find(agent => agent.id === closing.id)).toStrictEqual(closing);
        expect(snapshot.teams[0]!.agentIds).toStrictEqual([closing.id, unrelated.id, peer.id]);
      } else {
        complete();
        await closingPromise;
        expect(snapshot.agents.some(agent => agent.id === closing.id)).toBe(false);
      }
      expect(snapshot.teams[0]!.name).toBe('Renamed team');
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'after', method: backendMethods.snapshotGet }))
        .resolves.toMatchObject({ result: { snapshot: { activeAgentId: unrelated.id } } });
      expect(saved.at(-1)!.agents.some(agent => agent.id === closing.id)).toBe(outcome === 'failure');
    } finally { await server.close(); }
  });

  it('browses directory levels without hiding later folders, pages large folders, and searches unloaded files', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'korus-explorer-'));
    const snapshot = createTestSnapshot();
    snapshot.agents = [{ id: 'explorer', teamId: 'team-test', name: 'Explorer', folder, backend: 'codex',
      status: { type: 'idle' }, createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' }];
    snapshot.teams[0]!.agentIds = ['explorer'];
    const server = new AppBackendServer({ version: 'test', pid: 123, snapshot, driverRpc: new BackendDriverRpc(new Map()) });
    const list = (input: Record<string, unknown> = {}) => server.handleMessage({
      jsonrpc: '2.0', id: 'directory', method: 'agent/directory/list', params: { agentId: 'explorer', input },
    });
    try {
      await Promise.all(['aaa-large', 'empty', 'pensieve'].map(name => mkdir(path.join(folder, name))));
      await Promise.all(Array.from({ length: 1005 }, (_, index) => writeFile(path.join(folder, 'aaa-large', `${String(index).padStart(4, '0')}.txt`), 'fixture')));
      await writeFile(path.join(folder, 'pensieve', 'plan.md'), '# Plan');
      await expect(list()).resolves.toMatchObject({ result: { entries: [
        { kind: 'folder', name: 'aaa-large', path: 'aaa-large' },
        { kind: 'folder', name: 'empty', path: 'empty' },
        { kind: 'folder', name: 'pensieve', path: 'pensieve' },
      ], nextCursor: null } });
      const paths: string[] = [];
      let cursor: number | undefined;
      do {
        const response = await list({ path: 'aaa-large', cursor });
        if (!response || !('result' in response)) throw new Error(JSON.stringify(response));
        const page = response.result as { entries: { path: string }[]; nextCursor: number | null };
        expect(page.entries.length).toBeLessThanOrEqual(250);
        paths.push(...page.entries.map(entry => entry.path));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      expect(new Set(paths).size).toBe(1005);
      await expect(list({ query: 'pensieve/plan' })).resolves.toMatchObject({ result: {
        entries: [{ kind: 'file', name: 'plan.md', path: 'pensieve/plan.md' }], nextCursor: null,
      } });
      await expect(list({ path: 'empty' })).resolves.toMatchObject({ result: { entries: [], nextCursor: null } });
      await writeFile(path.join(folder, 'empty', 'new-plan.md'), '# New');
      await expect(list({ path: 'empty' })).resolves.toMatchObject({ result: {
        entries: [{ kind: 'file', name: 'new-plan.md', path: 'empty/new-plan.md' }], nextCursor: null,
      } });
      await expect(list({ path: '..' })).rejects.toThrow(/workspace/i);
      await expect(list({ cursor: -1 })).rejects.toThrow(/cursor/i);
    } finally { await server.close(); await rm(folder, { recursive: true, force: true }); }
  });

  it.each(['working', 'awaitingInput', 'error'] as const)('rejects a restart before changing provider state when the agent is %s', async type => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{ id: 'restart', teamId: 'team-test', name: 'Restart', folder: '/code/repo', backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'keep-thread' }, status: type === 'error' ? { type, message: 'Failed' } : { type }, createdAt: '', updatedAt: '' }];
    const handle = vi.fn(async () => undefined);
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc: { handle, onEvent: () => () => {}, close: async () => {} } as never });
    try {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'restart', method: backendMethods.agentConversationReset, params: { agentId: 'restart' } })).rejects.toThrow('idle');
      expect(handle).not.toHaveBeenCalled();
      expect(snapshot.agents[0]!.backendSession).toStrictEqual({ kind: 'codex', threadId: 'keep-thread' });
    } finally { await server.close(); }
  });

  it('duplicates into a chosen connected backend, preserving the checkout and isolating provider defaults', async () => {
    const snapshot = createTestSnapshot();
    snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    snapshot.general.providerModelDefaults = { claude: { model: 'target-model', reasoningEffort: null, serviceTier: null } };
    snapshot.agents = [{ id: 'source', teamId: 'team-test', name: 'Source', folder: '/code/repo-worktree', backend: 'codex', backendDefaults: { kind: 'codex', model: 'source-model' },
      backendSession: { kind: 'codex', threadId: 'source-thread' }, status: { type: 'working' }, createdAt: '', updatedAt: '', workspace: gitWorkspace('/code/repo', 'repo', 'feature/mobile') }];
    snapshot.teams[0]!.agentIds = ['source'];
    const handle = vi.fn(async () => ({ kind: 'claude', connected: true, state: { loggedIn: true } }));
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, saveSnapshot: async () => {},
      driverRpc: { handle, onEvent: () => () => {}, close: async () => {} } as never,
      providerSetup: { isChanging: () => false, list: () => [{ backend: 'claude', installed: true, homePath: '/claude' }] } as never,
    });
    try {
      const reply = await server.handleMessage({ jsonrpc: '2.0', id: 'duplicate', method: backendMethods.agentDuplicate, params: { agentId: 'source', options: { backend: 'claude' } } });
      expect(reply).not.toHaveProperty('error');
      expect(handle).toHaveBeenCalledExactlyOnceWith('driver/provider/authentication', { backend: 'claude', action: 'check' });
      const duplicate = snapshot.agents.find(agent => agent.id !== 'source')!;
      expect(duplicate).toMatchObject({ folder: '/code/repo-worktree', workspace: snapshot.agents[0]!.workspace, backend: 'claude', backendDefaults: { kind: 'claude', model: 'target-model' }, status: { type: 'idle' } });
      expect(duplicate.backendSession).toBeUndefined();
      expect(snapshot.agents[0]!.backendSession).toStrictEqual({ kind: 'codex', threadId: 'source-thread' });
      const count = snapshot.agents.length;
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'unavailable', method: backendMethods.agentDuplicate, params: { agentId: 'source', options: { backend: 'antigravity' } } })).resolves.toMatchObject({ error: { message: expect.stringContaining('not connected') } });
      expect(snapshot.agents).toHaveLength(count);
    } finally { await server.close(); }
  });

  it('owns agent CRUD and layout mutations', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-agent-'));
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = {
      path: '/Users/nbonamy/src',
      initialized: true,
      recentRepoNames: ['id8'],
    };
    snapshot.teams.push({ id: 'team-other', name: 'Other Team', agentIds: [] });
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: new BackendDriverRpc(new Map()),
    });

    try {
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'create-agent',
        method: 'agent/create',
        params: { input: { name: 'Dina', folder: tempDir, backend: 'codex', sourceRepositoryName: 'agent-workspace', teamId: 'team-test' } },
      })).resolves.toMatchObject({
        result: {
          activeAgentId: expect.stringContaining('agent-'),
          agents: [{ name: 'Dina', folder: tempDir }],
          sourceFolder: {
            recentRepoNames: ['agent-workspace', 'id8'],
          },
        },
      });
      const agentId = snapshot.agents[0]?.id ?? '';
      expect(snapshot.teams.find((team) => team.id === 'team-test')?.agentIds).toStrictEqual([agentId]);

      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'update-agent',
        method: 'agent/update',
        params: { input: { id: agentId, name: 'Dina Backend' } },
      })).resolves.toMatchObject({
        result: {
          agents: [{ id: agentId, name: 'Dina Backend', folder: tempDir }],
        },
      });
      const modelSelection = { model: 'sol', reasoningEffort: 'high', serviceTier: null };
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'update-model-selection',
        method: 'agent/update',
        params: { input: { id: agentId, modelSelection } },
      })).resolves.toMatchObject({
        result: { agents: [{ id: agentId, backendDefaults: { kind: 'codex', model: 'sol', reasoningEffort: 'high', serviceTier: null, userSelectedModel: true } }] },
      });
      expect(saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        agents: [expect.objectContaining({ backendDefaults: expect.objectContaining({ model: 'sol', userSelectedModel: true }) })],
      }));
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'update-agent-git-diff-target',
        method: 'agent/update',
        params: { input: { id: agentId, gitDiffTarget: { type: 'staged' } } },
      })).resolves.toMatchObject({
        result: {
          agents: [{ id: agentId, name: 'Dina Backend', gitDiffTarget: { type: 'staged' } }],
        },
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'set-open-in-application',
        method: 'client/agentExternalApplication/update',
        params: { agentId, application: 'xcode' },
      })).resolves.toMatchObject({
        result: {
          agents: [{ id: agentId, openInApplication: 'xcode' }],
        },
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'duplicate-agent',
        method: 'agent/duplicate',
        params: { agentId },
      })).resolves.toMatchObject({
        result: {
          agents: [{ id: agentId }, { name: 'Dina Backend (copy)', openInApplication: 'xcode', backendDefaults: { model: 'sol', userSelectedModel: true } }],
        },
      });
      const duplicateId = snapshot.agents[1]?.id ?? '';

      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'move-agent',
        method: 'agent/team/move',
        params: { input: { agentId: duplicateId, teamId: 'team-other' } },
      })).resolves.toMatchObject({
        result: {
          activeTeamId: 'team-other',
          activeAgentId: duplicateId,
        },
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'reorder-agent',
        method: 'client/agentOrder/update',
        params: { input: { teamId: 'team-test', agentId, beforeAgentId: null } },
      })).resolves.toMatchObject({ result: { activeAgentId: expect.any(String) } });
      expect(snapshot.teams.find((team) => team.id === 'team-test')?.agentIds).toStrictEqual([agentId]);
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'close-agent',
        method: 'agent/delete',
        params: { agentId: duplicateId },
      })).resolves.toMatchObject({
        result: {
          agents: [{ id: agentId }],
        },
      });

      expect(saveSnapshot).toHaveBeenCalled();
    } finally {
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reorders repository groups atomically with every agent in the repository', async () => {
    const snapshot = createTestSnapshot();
    const createdAt = '2026-06-05T00:00:00.000Z';
    snapshot.agents = [
      {
        id: 'agent-app-main',
        teamId: 'team-test',
        name: `${product.name} main`,
        folder: '/src/agent-workspace',
        workspace: gitWorkspace('/src/agent-workspace', 'agent-workspace', 'main'),
        backend: 'codex',
        backendDefaults: { kind: 'codex' },
        status: { type: 'idle' },
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'agent-id8',
        teamId: 'team-test',
        name: 'id8',
        folder: '/src/id8',
        workspace: gitWorkspace('/src/id8', 'id8', 'main'),
        backend: 'codex',
        backendDefaults: { kind: 'codex' },
        status: { type: 'idle' },
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'agent-app-worktree',
        teamId: 'team-test',
        name: `${product.name} worktree`,
        folder: '/src/agent-workspace.worktrees/drag-drop',
        workspace: {
          ...gitWorkspace('/src/agent-workspace', 'agent-workspace', 'feat/drag-drop'),
          folder: '/src/agent-workspace.worktrees/drag-drop',
          repositoryRoot: '/src/agent-workspace.worktrees/drag-drop',
          isLinkedWorktree: true,
        },
        backend: 'codex',
        backendDefaults: { kind: 'codex' },
        status: { type: 'idle' },
        createdAt,
        updatedAt: createdAt,
      },
    ];
    snapshot.teams[0]!.agentIds = snapshot.agents.map((agent) => agent.id);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc: new BackendDriverRpc(new Map()),
    });

    try {
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'reorder-repository',
        method: 'client/repositoryOrder/update',
        params: {
          input: {
            teamId: 'team-test',
            repositoryRoot: '/src/agent-workspace',
            beforeRepositoryRoot: null,
          },
        },
      })).resolves.toMatchObject({ result: { activeTeamId: 'team-test' } });

      expect(snapshot.clientPreferences?.desktop?.agentOrderByTeam?.['team-test']).toStrictEqual([
        'agent-id8',
        'agent-app-main',
        'agent-app-worktree',
      ]);
      expect(saveSnapshot).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });

  it('forgets the live backend session before closing its agent without retiring the conversation', async () => {
    const snapshot = createTestSnapshot();
    const agent = {
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/repo',
      backend: 'codex' as const,
      backendSession: { kind: 'codex' as const, threadId: 'thread-dina' },
      status: { type: 'idle' as const },
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    snapshot.teams[0]!.agentIds = [agent.id];
    snapshot.agents = [agent];
    snapshot.activeAgentId = agent.id;
    const releaseConversation = vi.fn();
    const archiveAgentConversation = vi.fn().mockResolvedValue(undefined);
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      releaseConversation,
      archiveAgentConversation,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      saveSnapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'close-agent',
      method: backendMethods.agentDelete,
      params: { agentId: agent.id },
    })).resolves.toMatchObject({ result: { agents: [] } });

    expect(archiveAgentConversation).toHaveBeenCalledWith(expect.objectContaining({
      backendSession: { kind: 'codex', threadId: 'thread-dina' },
    }));
    expect(releaseConversation).toHaveBeenCalledWith(agent.id);
    expect(snapshot.agents).toStrictEqual([]);
    expect(saveSnapshot).toHaveBeenCalledOnce();
    await server.close();
  });

  it.each([
    { label: 'deletes the provider session when a quick chat is closed', sessionKind: 'quickChat' as const, withDelete: true, expected: 'delete' },
    { label: 'archives the conversation of a project agent', sessionKind: undefined, withDelete: true, expected: 'archive' },
    { label: 'archives a quick chat when the provider cannot delete', sessionKind: 'quickChat' as const, withDelete: false, expected: 'archive' },
  ])('$label', async ({ sessionKind, withDelete, expected }) => {
    const snapshot = createTestSnapshot();
    const agent = {
      id: 'agent-chat', teamId: 'team-test', name: null, folder: sessionKind ? null : '/repo', ...(sessionKind ? { sessionKind } : {}),
      backend: 'codex' as const, backendSession: { kind: 'codex' as const, threadId: 'thread-chat' },
      status: { type: 'idle' as const }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    };
    snapshot.teams[0]!.agentIds = [agent.id];
    snapshot.agents = [agent];
    snapshot.activeAgentId = agent.id;
    const archiveAgentConversation = vi.fn().mockResolvedValue(undefined);
    const deleteAgentConversation = vi.fn().mockResolvedValue(undefined);
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: agent.backendSession }),
      interrupt: async () => ({ backendSession: agent.backendSession }),
      respondToAgentRequest: async () => undefined,
      releaseConversation: vi.fn(),
      archiveAgentConversation,
      ...(withDelete ? { deleteAgentConversation } : {}),
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({ version: 'test', snapshot, saveSnapshot: vi.fn().mockResolvedValue(undefined), driverRpc: new BackendDriverRpc(new Map([['codex', driver]])) });
    try {
      await server.handleMessage({ jsonrpc: '2.0', id: 'close-chat', method: backendMethods.agentDelete, params: { agentId: agent.id } });

      expect(deleteAgentConversation).toHaveBeenCalledTimes(expected === 'delete' ? 1 : 0);
      expect(archiveAgentConversation).toHaveBeenCalledTimes(expected === 'archive' ? 1 : 0);
      expect(snapshot.agents).toStrictEqual([]);
    } finally { await server.close(); }
  });

  it.each([
    { confirmed: true, deleteWorktree: true, discardChanges: 'true' },
    { confirmed: false, deleteWorktree: true, discardChanges: true },
    { confirmed: true, deleteWorktree: false, discardChanges: true },
  ])('rejects invalid discard authorization without deleting the agent: %j', async (input) => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{ id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo-feature', backend: 'codex', status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }];
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    const agent = snapshot.agents[0]!;
    const deleteLinkedWorktree = vi.fn();
    const server = new AppBackendServer({ version: 'test', snapshot, agentGitService: { deleteLinkedWorktree } as unknown as AgentGitService });
    try {
      await expect(server.handleMessage({ jsonrpc: '2.0', id: 'invalid-discard', method: backendMethods.agentDelete, params: { agentId: agent.id, input } })).rejects.toThrow();
      expect(snapshot.agents).toContain(agent);
      expect(deleteLinkedWorktree).not.toHaveBeenCalled();
    } finally { await server.close(); }
  });

  it.each(['github', 'gitlab'] as const)('cleans up a closed %s request after verifying its recorded identity and head', async provider => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/repo-feature',
      backend: 'codex',
      status: { type: 'idle' },
      pullRequest: {
        provider,
        repository: provider === 'gitlab' ? 'gitlab.com/group/sub/repo' : 'owner/repo',
        branch: 'feature',
        number: 7,
        title: 'Feature',
        url: provider === 'gitlab' ? 'https://gitlab.com/group/sub/repo/-/merge_requests/7' : 'https://github.com/owner/repo/pull/7',
        draft: false,
        headSha: 'merged-head',
        state: 'closed',
        createdAt: '2026-09-03T11:00:00.000Z',
        updatedAt: '2026-09-03T12:00:00.000Z',
      },
      createdAt: '2026-09-03T10:00:00.000Z',
      updatedAt: '2026-09-03T10:00:00.000Z',
    }];
    const tracking = snapshot.agents[0]!.pullRequest;
    const validateLinkedWorktreeDeletion = vi.fn();
    const deleteLinkedWorktree = vi.fn();
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      agentGitService: { validateLinkedWorktreeDeletion, deleteLinkedWorktree } as unknown as AgentGitService,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'cleanup-closed-pr-remote',
      method: backendMethods.agentDelete,
      params: {
        agentId: 'agent-dina',
        input: { deleteWorktree: true, deleteRemoteBranch: true, pullRequestCleanup: true, confirmed: true },
      },
    })).rejects.toThrow('Keep the remote branch');

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'cleanup-closed-pr',
      method: backendMethods.agentDelete,
      params: {
        agentId: 'agent-dina',
        input: { deleteWorktree: true, pullRequestCleanup: true, confirmed: true },
      },
    })).resolves.toMatchObject({ result: { agents: [] } });

    expect(validateLinkedWorktreeDeletion).toHaveBeenCalledWith('/repo-feature', false, 'merged-head', false, tracking);
    expect(deleteLinkedWorktree).toHaveBeenCalledWith('/repo-feature', false, 'merged-head', false, tracking);
    await server.close();
  });

  it('does not delete a worktree shared by another agent', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina', 'agent-jesse'];
    snapshot.agents = [
      {
        id: 'agent-dina', teamId: 'team-test', name: 'Dina', folder: '/repo-feature', backend: 'codex',
        status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'agent-jesse', teamId: 'team-test', name: 'Jesse', folder: '/repo-feature', backend: 'codex',
        status: { type: 'idle' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    snapshot.activeAgentId = 'agent-dina';
    const deleteLinkedWorktree = vi.fn();
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      agentGitService: { deleteLinkedWorktree } as unknown as AgentGitService,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'close-shared-worktree',
      method: backendMethods.agentDelete,
      params: { agentId: 'agent-dina', input: { deleteWorktree: true, confirmed: true } },
    })).rejects.toThrow('The worktree is also used by Jesse.');

    expect(deleteLinkedWorktree).not.toHaveBeenCalled();
    expect(snapshot.agents).toHaveLength(2);
    await server.close();
  });

  it('owns agent file listing and reads by resolving agent folders internally', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-agent-files-'));
    const externalTempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-external-file-'));
    const externalFile = path.join(externalTempDir, 'outside.md');
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: tempDir,
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new BackendDriverRpc(new Map()),
    });

    try {
      await mkdir(path.join(tempDir, 'docs'), { recursive: true });
      await writeFile(path.join(tempDir, 'README.md'), '# Read me\n');
      await writeFile(path.join(tempDir, 'docs', 'architecture.md'), '# Architecture\n');
      await writeFile(externalFile, '# Outside\n');

      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'list-files',
        method: 'agent/files/list',
        params: { agentId: 'agent-dina' },
      })).resolves.toMatchObject({
        result: expect.arrayContaining([
          { name: 'README.md', path: 'README.md' },
          { name: 'architecture.md', path: 'docs/architecture.md' },
        ]),
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'preview-file',
        method: 'agent/file/preview',
        params: { agentId: 'agent-dina', filePath: 'README.md' },
      })).resolves.toMatchObject({
        result: {
          path: 'README.md',
          content: '# Read me\n',
        },
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0', id: 'download-file', method: 'agent/file/chunk/read',
        params: { agentId: 'agent-dina', filePath: 'README.md', offset: 2 },
      })).resolves.toMatchObject({
        result: { path: 'README.md', size: 10, data: Buffer.from('Read me\n').toString('base64'), nextOffset: 10 },
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'missing-agent',
        method: 'agent/file/preview',
        params: { agentId: 'agent-missing', filePath: 'README.md' },
      })).resolves.toMatchObject({
        error: {
          message: 'Agent not found: agent-missing',
        },
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'external-file',
        method: 'agent/file/preview',
        params: { agentId: 'agent-dina', filePath: externalFile },
      })).resolves.toMatchObject({
        result: {
          path: externalFile,
          content: '# Outside\n',
        },
      });
    } finally {
      await server.close();
      await Promise.all([
        rm(tempDir, { recursive: true, force: true }),
        rm(externalTempDir, { recursive: true, force: true }),
      ]);
    }
  });

  it('previews absolute files from a quick chat without a project workspace', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-quick-chat-file-'));
    const filePath = path.join(tempDir, 'MEMORY.md');
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-quick-chat'];
    snapshot.agents = [{
      id: 'agent-quick-chat',
      teamId: 'team-test',
      sessionKind: 'quickChat',
      name: null,
      folder: null,
      backend: 'codex',
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    const server = new AppBackendServer({
      version: 'test-version',
      snapshot,
      driverRpc: new BackendDriverRpc(new Map()),
    });

    try {
      await writeFile(filePath, '# Memory\n');
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'preview-quick-chat-absolute-file',
        method: 'agent/file/preview',
        params: { agentId: 'agent-quick-chat', filePath },
      })).resolves.toMatchObject({
        result: { path: filePath, kind: 'text', content: '# Memory\n' },
      });
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: 'preview-quick-chat-relative-file',
        method: 'agent/file/preview',
        params: { agentId: 'agent-quick-chat', filePath: 'MEMORY.md' },
      })).rejects.toThrow('This session does not have a project workspace.');
    } finally {
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('owns provider metadata and conversation-history reads by resolving agents internally', async () => {
    const snapshot = createTestSnapshot();
    snapshot.teams[0]!.agentIds = ['agent-dina'];
    snapshot.agents = [{
      id: 'agent-dina',
      teamId: 'team-test',
      name: 'Dina',
      folder: '/Users/nbonamy/src/agent-workspace',
      backend: 'codex',
      backendSession: { kind: 'codex', threadId: 'thread-root' },
      status: { type: 'idle' },
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
    }];
    snapshot.activeAgentId = 'agent-dina';
    snapshot.subagentTrees['agent-dina'] = {
      rootConversationId: 'thread-root',
      nodes: {
        'thread-child': {
          conversationId: 'thread-child',
          parentConversationId: 'thread-root',
          createdAt: '2026-06-13T00:00:00.000Z',
          status: 'completed',
          updatedAt: '2026-06-13T00:00:00.000Z',
        },
        'thread-grandchild': {
          conversationId: 'thread-grandchild',
          parentConversationId: 'thread-child',
          createdAt: '2026-06-13T00:00:00.000Z',
          status: 'completed',
          updatedAt: '2026-06-13T00:00:00.000Z',
        },
        'thread-legacy-child': {
          conversationId: 'thread-legacy-child',
          parentConversationId: 'thread-root',
          createdAt: '2026-06-13T00:00:00.000Z',
          status: 'completed',
          updatedAt: '2026-06-13T00:00:00.000Z',
        },
      },
      operations: {},
      activities: {
        'activity-child': {
          id: 'activity-child',
          lifecycle: 'completed',
          kind: 'started',
          conversationId: 'thread-child',
          agentPath: '/root/child',
          occurredAt: '2026-06-13T00:00:01.000Z',
        },
        'activity-grandchild': {
          id: 'activity-grandchild',
          lifecycle: 'completed',
          kind: 'started',
          conversationId: 'thread-grandchild',
          agentPath: '/root/child/grandchild',
          occurredAt: '2026-06-13T00:00:02.000Z',
        },
      },
    };
    snapshot.automations = [{
      id: 'automation-bugs',
      name: 'GitHub bugs',
      enabled: true,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z',
      prompt: 'Check tasks', target: { kind: 'newQuickChat' as const, teamId: 'team-test', backend: 'codex' as const },

      schedule: { intervalMinutes: 60 },
      executionLog: [{
        id: 'automation-exec-1',
        automationId: 'automation-bugs',
        startedAt: '2026-06-13T00:00:00.000Z',
        status: 'completed',

        agentId: 'agent-dina', agentName: 'Dina', conversationRef: { backend: 'codex', threadId: 'thread-dina' },
      }],
    }];
    const conversations = [{
      id: 'thread-dina',
      title: 'Read docs',
      updatedAt: '2026-06-09T10:00:00.000Z',
      messageCount: 3,
      storageState: 'active' as const,
      ref: { backend: 'codex' as const, threadId: 'thread-dina' },
    }];
    const messages = [{
      ...createTextMessage('user-thread-dina-user-1', 'agent-dina', 'hello'),
      turnId: 'turn-root',
    }];
    const subagentMessage = {
      ...createTextMessage('assistant-thread-child-1', 'agent-dina', 'child result'),
      turnId: 'turn-child',
    };
    const nestedSubagentMessage = {
      ...createTextMessage('assistant-thread-grandchild-1', 'agent-dina', 'nested child result'),
      turnId: 'turn-grandchild',
    };
    const legacySubagentMessage = createTextMessage('assistant-thread-legacy-child-1', 'agent-dina', 'legacy child result');
    const childMessages = [...messages, subagentMessage];
    const grandchildMessages = [subagentMessage, nestedSubagentMessage];
    const legacyChildMessages = [...messages, legacySubagentMessage];
    const listModels = vi.fn().mockResolvedValue([{ id: 'gpt-test', name: 'GPT Test' }]);
    const listPlugins = vi.fn().mockResolvedValue([{ id: 'dropbox', name: 'dropbox', displayName: 'Dropbox', enabled: true }]);
    const listSkills = vi.fn().mockResolvedValue([{ name: 'frontend-design', path: '/skills/frontend-design/SKILL.md' }]);
    const listConversations = vi.fn().mockResolvedValue(conversations);
    const readConversationMessages = vi.fn(async (ref: BackendConversationRef) => {
      if (ref.backend !== 'codex') return messages;
      if (ref.threadId === 'thread-grandchild') return grandchildMessages;
      if (ref.threadId === 'thread-child') return childMessages;
      if (ref.threadId === 'thread-legacy-child') return legacyChildMessages;
      return messages;
    });
    const readConversationSummary = vi.fn(async (_agent: unknown, ref: BackendConversationRef) => ({
      id: ref.backend === 'codex' ? ref.threadId : 'thread-unknown',
      parentConversationId: ref.backend === 'codex' && ref.threadId === 'thread-grandchild'
        ? 'thread-child'
        : 'thread-root',
      agentNickname: ref.backend === 'codex' ? `Nickname ${ref.threadId}` : undefined,
      title: 'Subagent',
      status: 'idle' as const,
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:01.000Z',
      messageCount: 1,
      storageState: 'active' as const,
      ref,
    }));
    const driver: AgentBackendDriver = {
      backend: 'codex',
      getRuntimeStatus: () => ({ backend: 'codex', status: 'running' }),
      getCapabilities: () => codexBackendCapabilities,
      sendPrompt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      interrupt: async () => ({ backendSession: { kind: 'codex', threadId: 'thread-test' } }),
      respondToAgentRequest: async () => undefined,
      listConversations,
      listModels,
      listPlugins,
      listSkills,
      readConversationMessages,
      readConversationSummary,
      onEvent: () => () => undefined,
      close: async () => undefined,
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc: new BackendDriverRpc(new Map([['codex', driver]])),
    });

    await server.initialize();
    await server.handleMessage({ jsonrpc: '2.0', id: 'snapshot', method: 'snapshot/get' });
    await vi.waitFor(() => {
      expect(snapshot.subagentTrees['agent-dina']?.nodes['thread-child']?.agentNickname)
        .toBe('Nickname thread-child');
      expect(snapshot.subagentTrees['agent-dina']?.nodes['thread-grandchild']?.agentNickname)
        .toBe('Nickname thread-grandchild');
      expect(snapshot.subagentTrees['agent-dina']?.nodes['thread-legacy-child']?.agentNickname)
        .toBe('Nickname thread-legacy-child');
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'models',
      method: 'agent/models/list',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({ result: [{ id: 'gpt-test', name: 'GPT Test' }] });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'plugins',
      method: 'agent/plugins/list',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({ result: [{ id: 'dropbox', displayName: 'Dropbox' }] });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'skills',
      method: 'agent/skills/list',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({ result: [{ name: 'frontend-design' }] });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'conversations',
      method: 'agent/conversations/list',
      params: { agentId: 'agent-dina' },
    })).resolves.toMatchObject({ result: conversations });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'messages',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-dina', ref: { backend: 'codex', threadId: 'thread-dina' } },
    })).resolves.toMatchObject({ result: messages });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'subagent-messages',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-dina', ref: { backend: 'codex', threadId: 'thread-child' } },
    })).resolves.toMatchObject({ result: childMessages });
    expect(readConversationMessages).not.toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-root' }, 'agent-dina');
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'nested-subagent-messages',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-dina', ref: { backend: 'codex', threadId: 'thread-grandchild' } },
    })).resolves.toMatchObject({ result: grandchildMessages });
    expect(readConversationMessages.mock.calls.filter(([candidate]) => (
      candidate.backend === 'codex' && candidate.threadId === 'thread-child'
    ))).toHaveLength(1);
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'legacy-subagent-messages',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-dina', ref: { backend: 'codex', threadId: 'thread-legacy-child' } },
    })).resolves.toMatchObject({ result: legacyChildMessages });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'unknown-ref',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-dina', ref: { backend: 'codex', threadId: 'thread-unknown' } },
    })).resolves.toMatchObject({ error: { message: 'Conversation reference is not available.' } });
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'invalid-ref',
      method: 'agent/conversation/messages/get',
      params: { agentId: 'agent-dina', ref: { backend: 'codex' } },
    })).resolves.toMatchObject({ error: { message: 'Invalid conversation reference.' } });

    expect(listModels).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(listPlugins).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(listSkills).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }));
    expect(listConversations).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-dina' }), undefined);
    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-dina' }, 'agent-dina');
    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-child' }, 'agent-dina');
    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-grandchild' }, 'agent-dina');
    expect(readConversationMessages).toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-legacy-child' }, 'agent-dina');
    expect(readConversationMessages).not.toHaveBeenCalledWith({ backend: 'codex', threadId: 'thread-root' }, 'agent-dina');
    await server.close();
  });
});
