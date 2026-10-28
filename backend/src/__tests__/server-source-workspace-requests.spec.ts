import { createInitialSnapshot } from '@workspace/core/snapshot';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import type { SourceWorktree } from '@workspace/core/contracts';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { AppBackendServer } from '../server';
import { BackendDriverRpc } from '../driver-rpc';
import { AgentGitService } from '../git/agent-git-service';
import { createQuickChatInSnapshot } from '@workspace/core/agent-manager';
import {
  createTestSnapshot,
  readyRemoteConnection,
  createRemoteAgent,
  createRemoteTeamSnapshot,
} from './server-test-fixtures';

describe('AppBackendServer', () => {

  it('owns source repository discovery path resolution', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = {
      path: '/Users/nbonamy/src',
      initialized: true,
      recentRepoNames: [],
    };
    const repositories = [{
      name: 'agent-workspace',
      path: '/Users/nbonamy/src/agent-workspace',
      worktrees: [{ name: 'main', path: '/Users/nbonamy/src/agent-workspace' }],
    }];
    const driverRpc = {
      handle: vi.fn().mockResolvedValue(repositories),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackendDriverRpc;
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'source-repositories',
      method: 'source/repositories/list',
    })).resolves.toMatchObject({
      result: repositories,
    });

    expect(driverRpc.handle).toHaveBeenCalledWith('source/repositories/list', {
      sourceFolderPath: '/Users/nbonamy/src',
    });
  });

  it('clones repositories inside the runtime-owned source folder and records them as recent', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = {
      path: '/Users/nbonamy/src',
      initialized: true,
      recentRepoNames: [],
    };
    const repository = {
      name: 'new-project',
      path: '/Users/nbonamy/src/new-project',
      worktrees: [{ name: 'main', path: '/Users/nbonamy/src/new-project' }],
    };
    const driverRpc = {
      handle: vi.fn().mockResolvedValue(repository),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackendDriverRpc;
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc,
      saveSnapshot,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'source-repository-clone',
      method: backendMethods.sourceRepositoryClone,
      params: { input: { url: 'https://github.com/nbonamy/new-project' } },
    })).resolves.toMatchObject({ result: repository });

    expect(driverRpc.handle).toHaveBeenCalledWith(backendMethods.sourceRepositoryClone, {
      sourceFolderPath: '/Users/nbonamy/src',
      url: 'https://github.com/nbonamy/new-project',
    });
    expect(snapshot.sourceFolder.recentRepoNames).toContain('new-project');
    expect(saveSnapshot).toHaveBeenCalled();
  });

  it('creates repositories inside the runtime-owned source folder and records them as recent', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = {
      path: '/Users/nbonamy/src',
      initialized: true,
      recentRepoNames: [],
    };
    const repository = {
      name: 'fresh-project',
      path: '/Users/nbonamy/src/fresh-project',
      worktrees: [{ name: 'main', path: '/Users/nbonamy/src/fresh-project' }],
    };
    const driverRpc = {
      handle: vi.fn().mockResolvedValue(repository),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackendDriverRpc;
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc,
      saveSnapshot,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'source-repository-create',
      method: backendMethods.sourceRepositoryCreate,
      params: { input: { name: 'fresh-project' } },
    })).resolves.toMatchObject({ result: repository });

    expect(driverRpc.handle).toHaveBeenCalledWith(backendMethods.sourceRepositoryCreate, {
      sourceFolderPath: '/Users/nbonamy/src',
      name: 'fresh-project',
    });
    expect(snapshot.sourceFolder.recentRepoNames).toContain('fresh-project');
    expect(saveSnapshot).toHaveBeenCalled();
  });

  it('creates a project repository and agent as one UI request', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = { path: '/src', initialized: true, recentRepoNames: [] };
    const repository = {
      name: 'new-product',
      path: '/src/new-product',
      worktrees: [{ name: 'main', path: '/src/new-product' }],
    };
    const driverRpc = {
      handle: vi.fn().mockResolvedValue(repository),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as BackendDriverRpc;
    const agentGitService = {
      identity: vi.fn(async (folder: string) => ({
        kind: 'git' as const,
        folder,
        repositoryName: 'new-product',
        repositoryRoot: folder,
        branch: 'main',
        isLinkedWorktree: false,
        primaryWorktreeRoot: folder,
        updatedAt: '2026-09-25T00:00:00.000Z',
      })),
      status: vi.fn().mockResolvedValue(null),
    } as unknown as AgentGitService;
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc, agentGitService });

    const response = await server.handleMessage({
      jsonrpc: '2.0', id: 'project-create', method: backendMethods.projectCreate,
      params: { input: { name: 'new-product' } },
    });

    expect(response).toMatchObject({ result: {
      activeAgentId: expect.any(String),
      agents: [{ folder: '/src/new-product', teamId: 'team-test', name: null, backend: 'codex' }],
      sourceFolder: { recentRepoNames: ['new-product'] },
    } });
    expect(driverRpc.handle).toHaveBeenCalledWith(backendMethods.sourceRepositoryCreate, {
      sourceFolderPath: '/src', name: 'new-product',
    });
  });

  it('creates a project on the selected remote host', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0].remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const remoteSnapshot = createRemoteTeamSnapshot([{
      ...createRemoteAgent(),
      folder: '/home/nicolas/src/new-product',
    }]);
    const remoteClients = { request: vi.fn().mockResolvedValue(remoteSnapshot), close: vi.fn() };
    const server = new AppBackendServer({ version: 'test', snapshot, remoteClients: remoteClients as never });

    await expect(server.handleMessage({
      jsonrpc: '2.0', id: 'remote-project', method: backendMethods.projectCreate,
      params: { input: { name: 'new-product', remoteConnectionId: 'connection-devbox' } },
    })).resolves.toMatchObject({ result: { agents: [{ folder: '/home/nicolas/src/new-product', teamId: 'team-test', remoteConnectionId: 'connection-devbox' }] } });
    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      backendMethods.projectCreate,
      { input: { name: 'new-product', teamId: 'team-remote' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
  });

  it.each(['codex', 'claude'] as const)('starts a project using the %s Quick Chat backend', async (backend) => {
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.sourceFolder = { path: '/src', initialized: true, recentRepoNames: [] };
    createQuickChatInSnapshot(snapshot, { teamId: 'team-test', backend }, undefined, 'agent-quick-chat', { select: false });
    const backendSession = backend === 'codex'
      ? { kind: 'codex', threadId: 'thread-project' }
      : { kind: 'claude', sessionId: 'session-project', transport: 'stdio' };
    const repository = {
      name: 'new-product', path: '/src/new-product', worktrees: [{ name: 'main', path: '/src/new-product' }],
    };
    const handle = vi.fn(async (method: string) => method === backendMethods.sourceRepositoryCreate
      ? repository
      : method === backendMethods.driverPromptSend
        ? { backendSession, turnId: 'turn-1' }
        : undefined);
    const driverRpc = {
      handle,
      tryHandlePromptCommand: vi.fn().mockReturnValue(null),
      onEvent: vi.fn(() => () => undefined),
    } as unknown as BackendDriverRpc;
    const agentGitService = {
      identity: vi.fn(async (folder: string) => ({
        kind: 'git' as const, folder, repositoryName: 'new-product', repositoryRoot: folder,
        branch: 'main', isLinkedWorktree: false, primaryWorktreeRoot: folder,
        updatedAt: '2026-09-25T00:00:00.000Z',
      })),
      status: vi.fn().mockResolvedValue(null),
    } as unknown as AgentGitService;
    const events: import('@workspace/core/contracts').MainToRendererEvent[] = [];
    const server = new AppBackendServer({ version: 'test', snapshot, driverRpc, agentGitService, onEvent: event => events.push(event) });
    const result = await server.createProjectFromQuickChat(
      'agent-quick-chat', 'new-product', 'Build the agreed product.',
    );

    expect(result).toMatchObject({ repository, promptSubmitted: true, agent: {
      folder: repository.path, teamId: 'team-test', name: null, backend,
      backendSession,
    } });
    expect(result.agent.delegatedByAgentId).toBeUndefined();
    const progress = events.filter(event => event.type === 'agentCreation.progress');
    expect(progress.map(event => [event.agentId, event.payload.state, event.payload.phase])).toStrictEqual([
      ['agent-quick-chat', 'running', 'creatingProject'],
      ['agent-quick-chat', 'running', 'creatingAgent'],
      ['agent-quick-chat', 'running', 'startingPrompt'],
      ['agent-quick-chat', 'success', 'startingPrompt'],
    ]);
    expect(progress.at(-1)?.payload).toMatchObject({ createProject: true, agentId: result.agent.id });
    expect(snapshot.activeAgentId).not.toBe(result.agent.id);
    expect(handle).toHaveBeenCalledWith(backendMethods.driverPromptSend, {
      agent: result.agent,
      prompt: 'Build the agreed product.',
      options: undefined,
    });
    await expect(server.createProjectFromQuickChat(result.agent.id, 'another-project', 'Start it.'))
      .rejects.toThrow('create-project is available only in a Quick Chat');
  });

  it('routes source repository discovery to selected SSH connections', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const repositories = [{
      name: 'agent-workspace',
      path: '/home/nicolas/src/agent-workspace',
      worktrees: [{ name: 'main', path: '/home/nicolas/src/agent-workspace' }],
    }];
    const remoteClients = {
      request: vi.fn().mockResolvedValue(repositories),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-source-repositories',
      method: 'source/repositories/list',
      params: { remoteConnectionId: 'connection-devbox' },
    })).resolves.toMatchObject({
      result: repositories,
    });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'source/repositories/list',
      { _clientId: 'remote-controller' },
      expect.any(Function),
    );
  });

  it('routes source repository creation to the selected SSH connection', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const repository = {
      name: 'fresh-project',
      path: '/home/nicolas/src/fresh-project',
      worktrees: [{ name: 'main', path: '/home/nicolas/src/fresh-project' }],
    };
    const remoteClients = {
      request: vi.fn().mockResolvedValue(repository),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-source-repository-create',
      method: backendMethods.sourceRepositoryCreate,
      params: { input: { name: 'fresh-project', remoteConnectionId: 'connection-devbox' } },
    })).resolves.toMatchObject({ result: repository });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      backendMethods.sourceRepositoryCreate,
      { ...{ input: { name: 'fresh-project' } }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.sourceFolder.recentRepoNames).toStrictEqual([]);
  });

  it('routes source repository cloning to the selected SSH connection', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const repository = {
      name: 'new-project',
      path: '/home/nicolas/src/new-project',
      worktrees: [{ name: 'main', path: '/home/nicolas/src/new-project' }],
    };
    const remoteClients = {
      request: vi.fn().mockResolvedValue(repository),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-source-repository-clone',
      method: backendMethods.sourceRepositoryClone,
      params: {
        input: {
          url: 'https://github.com/nbonamy/new-project',
          remoteConnectionId: 'connection-devbox',
        },
      },
    })).resolves.toMatchObject({ result: repository });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      backendMethods.sourceRepositoryClone,
      { ...{ input: { url: 'https://github.com/nbonamy/new-project' } }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.sourceFolder.recentRepoNames).toStrictEqual([]);
  });

  it('routes source folder listing to selected SSH connections', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const listing = {
      path: '/home/nicolas',
      parentPath: '/home',
      entries: [{
        name: 'src',
        path: '/home/nicolas/src',
      }],
    };
    const remoteClients = {
      request: vi.fn().mockResolvedValue(listing),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-source-folders',
      method: 'source/folders/list',
      params: { remoteConnectionId: 'connection-devbox', path: '/home/nicolas' },
    })).resolves.toMatchObject({
      result: listing,
    });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'source/folders/list',
      { ...{ path: '/home/nicolas' }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
  });

  it('detects a source folder before listing repositories when the saved path is empty', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = {
      path: '',
      initialized: true,
      recentRepoNames: [],
    };
    const repositories = [{
      name: 'witsy',
      path: '/home/mnmt/src/witsy',
      worktrees: [{ name: 'main', path: '/home/mnmt/src/witsy' }],
    }];
    const driverRpc = {
      handle: vi.fn(async (method: string, params: unknown) => {
        if (method === 'source/folder/detect') {
          return '~/src';
        }
        if (method === 'source/repositories/list') {
          expect(params).toStrictEqual({ sourceFolderPath: '~/src' });
          return repositories;
        }
        return undefined;
      }),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackendDriverRpc;
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'source-repositories',
      method: 'source/repositories/list',
    })).resolves.toMatchObject({
      result: repositories,
    });

    expect(driverRpc.handle).toHaveBeenNthCalledWith(1, 'source/folder/detect', undefined);
    expect(driverRpc.handle).toHaveBeenNthCalledWith(2, 'source/repositories/list', {
      sourceFolderPath: '~/src',
    });
    expect(snapshot.sourceFolder).toMatchObject({
      path: '~/src',
      initialized: true,
    });
  });

  it('owns source worktree path suggestions', async () => {
    const snapshot = createTestSnapshot();
    const driverRpc = {
      handle: vi.fn().mockResolvedValue('/Users/nbonamy/src/agent-workspace-backend-split'),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackendDriverRpc;
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc,
    });
    const input = {
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'backend-split',
    };

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'source-worktree-suggestion',
      method: 'source/worktree/path/suggest',
      params: { input },
    })).resolves.toMatchObject({
      result: '/Users/nbonamy/src/agent-workspace-backend-split',
    });

    expect(driverRpc.handle).toHaveBeenCalledWith('source/worktree/path/suggest', { input });
  });

  it('owns git worktree listing', async () => {
    const snapshot = createTestSnapshot();
    const worktrees: SourceWorktree[] = [
      { name: 'main', path: '/Users/nbonamy/src/agent-workspace' },
      { name: 'backend-split', path: '/Users/nbonamy/src/agent-workspace-backend-split' },
    ];
    const driverRpc = {
      handle: vi.fn().mockResolvedValue(worktrees),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackendDriverRpc;
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      driverRpc,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'source-worktrees',
      method: 'source/worktrees/list',
      params: { repoPath: '/Users/nbonamy/src/agent-workspace' },
    })).resolves.toMatchObject({
      result: worktrees,
    });

    expect(driverRpc.handle).toHaveBeenCalledWith('source/worktrees/list', {
      repoPath: '/Users/nbonamy/src/agent-workspace',
    });
  });

  it('records recent repositories when creating source worktrees', async () => {
    const snapshot = createTestSnapshot();
    snapshot.sourceFolder = {
      path: '/Users/nbonamy/src',
      initialized: true,
      recentRepoNames: ['id8'],
    };
    const worktree = {
      name: 'backend-split',
      path: '/Users/nbonamy/src/agent-workspace-backend-split',
    };
    const driverRpc = {
      handle: vi.fn().mockResolvedValue(worktree),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BackendDriverRpc;
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      driverRpc,
    });
    const input = {
      repoPath: '/Users/nbonamy/src/agent-workspace',
      branchName: 'backend-split',
    };

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'source-worktree',
      method: 'source/worktree/create',
      params: { input },
    })).resolves.toMatchObject({
      result: worktree,
    });

    expect(driverRpc.handle).toHaveBeenCalledWith('source/worktree/create', { input });
    expect(snapshot.sourceFolder.recentRepoNames).toStrictEqual(['agent-workspace', 'id8']);
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('routes source worktree creation to remote daemon without rebrokering metadata', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    const worktree = {
      name: 'remote-agent',
      path: '/home/nicolas/src/agent-workspace-remote-agent',
    };
    const remoteClients = {
      request: vi.fn().mockResolvedValue(worktree),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-source-worktree',
      method: 'source/worktree/create',
      params: {
        input: {
          repoPath: '/home/nicolas/src/agent-workspace',
          branchName: 'remote-agent',
          reuseExisting: true,
          fetchRemoteBranch: true,
          requireNewBranch: true,
          remoteConnectionId: 'connection-devbox',
        },
      },
    })).resolves.toMatchObject({
      result: worktree,
    });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'source/worktree/create',
      { ...{
        input: {
          repoPath: '/home/nicolas/src/agent-workspace',
          branchName: 'remote-agent',
          reuseExisting: true,
          fetchRemoteBranch: true,
          requireNewBranch: true,
        },
      }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.sourceFolder.recentRepoNames).toStrictEqual([]);
  });

  it('creates agents on a remote host using its SSH connection', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0].remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const remoteSnapshot = createRemoteTeamSnapshot([{
      ...createRemoteAgent(),
      name: 'Remote Dina',
      folder: '/home/nicolas/src/agent-workspace',
    }]);
    const remoteClients = {
      request: vi.fn().mockResolvedValue(remoteSnapshot),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      saveSnapshot,
      remoteClients: remoteClients as never,
    });

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'remote-agent',
      method: 'agent/create',
      params: {
        input: {
          name: 'Remote Dina',
          folder: '/home/nicolas/src/agent-workspace',
          backend: 'codex',
          remoteConnectionId: 'connection-devbox',
        },
      },
    })).resolves.toMatchObject({
      result: {
        teams: [{
          id: 'team-test',
          remoteLinks: [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }],
          agentIds: ['agent-remote'],
        }],
        agents: [{
          id: 'agent-remote',
          name: 'Remote Dina',
          folder: '/home/nicolas/src/agent-workspace',
          teamId: 'team-test',
        }],
      },
    });

    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'agent/create',
      { ...{
        input: {
          name: 'Remote Dina',
          folder: '/home/nicolas/src/agent-workspace',
          backend: 'codex',
          teamId: 'team-remote',
        },
      }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
    expect(snapshot.agents).toStrictEqual([]);
    expect(saveSnapshot).toHaveBeenCalledWith(snapshot);
  });

  it('does not wait for remote git status refresh before completing agent creation', async () => {
    const snapshot = createTestSnapshot();
    snapshot.remoteConnections.connections = [readyRemoteConnection()];
    snapshot.teams[0].remoteLinks = [{ connectionId: 'connection-devbox', remoteTeamId: 'team-remote' }];
    const remoteSnapshot = createRemoteTeamSnapshot([{
      ...createRemoteAgent(),
      name: 'Remote Dina',
      folder: '/home/nicolas/src/agent-workspace',
    }]);
    const remoteClients = {
      request: vi.fn().mockResolvedValue(remoteSnapshot),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = new AppBackendServer({
      version: 'test-version',
      pid: 123,
      snapshot,
      remoteClients: remoteClients as never,
    });

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const response = await Promise.race([
      server.handleMessage({
        jsonrpc: '2.0',
        id: 'remote-agent',
        method: 'agent/create',
        params: {
          input: {
            name: 'Remote Dina',
            folder: '/home/nicolas/src/agent-workspace',
            backend: 'codex',
            remoteConnectionId: 'connection-devbox',
          },
        },
      }),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve('timed-out'), 50);
      }),
    ]);
    if (timeout) {
      clearTimeout(timeout);
    }

    expect(response).toMatchObject({
      result: {
        agents: [{
          id: 'agent-remote',
          name: 'Remote Dina',
        }],
      },
    });
    expect(remoteClients.request).toHaveBeenCalledWith(
      snapshot.remoteConnections.connections[0],
      'agent/create',
      { ...{
        input: {
          name: 'Remote Dina',
          folder: '/home/nicolas/src/agent-workspace',
          backend: 'codex',
          teamId: 'team-remote',
        },
      }, _clientId: 'remote-controller' },
      expect.any(Function),
    );
  });
});

// Real Git/filesystem boundary: confirmation must bind the exact local checkout,
// worktree set and agents; another clone with the same remote must survive.
it.each([true, false])('deletes a confirmed repository and its worktrees without affecting another clone (remote: %s)', async hasRemote => {
  const root = await mkdtemp(path.join(tmpdir(), 'korus-delete-repository-'));
  const git = async (cwd: string, ...args: string[]) => promisify(execFile)('git', args, { cwd });
  const repo = path.join(root, 'repo');
  const worktree = path.join(root, 'worktree');
  const other = path.join(root, 'other');
  try {
    await mkdir(repo); await mkdir(other);
    await git(repo, 'init', '-b', 'main');
    await git(repo, 'config', 'user.name', 'Test'); await git(repo, 'config', 'user.email', 'test@example.com');
    await git(repo, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'initial');
    if (hasRemote) await git(repo, 'remote', 'add', 'origin', 'https://github.com/nbonamy/deletion-test.git');
    await git(other, 'init', '-b', 'main');
    if (hasRemote) await git(other, 'remote', 'add', 'origin', 'https://github.com/nbonamy/deletion-test.git');
    await git(repo, 'worktree', 'add', '-b', 'topic', worktree);
    await writeFile(path.join(repo, 'uncommitted'), 'discarded with confirmation');
    await writeFile(path.join(worktree, 'untracked'), 'discarded with confirmation');
    await writeFile(path.join(other, 'keep'), 'untouched');
    const snapshot = createInitialSnapshot();
    snapshot.agents = snapshot.agents.slice(0, 2);
    const identity = new AgentGitService();
    snapshot.agents[0]!.folder = repo; snapshot.agents[0]!.workspace = await identity.identity(repo);
    snapshot.agents[1]!.folder = worktree; snapshot.agents[1]!.workspace = await identity.identity(worktree);
    snapshot.agents.push({ ...snapshot.agents[0]!, id: 'other-clone', folder: other,
      workspace: await identity.identity(other) });
    const originalIds = snapshot.agents.map(a => a.id);
    const driverRpc = { handle: vi.fn().mockResolvedValue(undefined), onEvent: () => () => undefined, close: vi.fn() } as unknown as BackendDriverRpc;
    const server = new AppBackendServer({ version: 'test', pid: 1, snapshot, driverRpc, saveSnapshot: vi.fn().mockResolvedValue(undefined) });
    const request = (method: string, params: unknown) => server.handleMessage({ jsonrpc: '2.0', id: 'delete-test', method, params });
    const response = await request('repository/delete/preview', { agentId: originalIds[0] });
    expect(response).toHaveProperty('result');
    const preview = (response as { result: { confirmationName: string; fingerprint: string; paths: string[]; agents: { id: string }[] } }).result;
    expect(preview.confirmationName).toBe(hasRemote ? 'nbonamy/deletion-test' : 'repo');
    expect(preview.paths).toHaveLength(2);
    expect(preview.agents.map(a => a.id).sort()).toStrictEqual(originalIds.slice(0, 2).sort());
    const input = { confirmation: preview.confirmationName, fingerprint: preview.fingerprint };
    await expect(request('repository/delete', { agentId: originalIds[0], input: { ...input, confirmation: 'wrong-name' } })).rejects.toThrow('Type the repository name');
    await expect(request('repository/delete', { agentId: originalIds[0], input: { ...input, fingerprint: 'stale' } })).rejects.toThrow('changed');
    expect(snapshot.agents.map(a => a.id)).toStrictEqual(originalIds);
    expect((await stat(repo)).isDirectory()).toBe(true);
    expect(await request('repository/delete', { agentId: originalIds[0], input })).toHaveProperty('result');
    expect(snapshot.agents.map(a => a.id)).toStrictEqual(['other-clone']);
    await expect(stat(repo)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(worktree)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(other, 'keep'), 'utf8')).toBe('untouched');
  } finally { await rm(root, { recursive: true, force: true }); }
});
