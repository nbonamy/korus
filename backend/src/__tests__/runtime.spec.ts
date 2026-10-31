import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import type { Agent, AgentBackend, AppSnapshot } from '@workspace/core/contracts';
import type { ProviderLifecycle } from '../provider-lifecycle';
import type { ProviderSetup } from '../provider-setup';
import { createCodexLifecycle } from '../codex/provider-lifecycle';
import { buildAppMcpConfigOverrides } from '../mcp/codex-config';
import { ProviderUpdateRuntime } from '../provider-update-runtime';
import type { ProviderUpdates } from '../provider-updates';
import { RemoteTeamService } from '../connections/remote-team-service';
import { applyMainEventToSnapshot } from '@workspace/core/snapshot';
import type { DesignService } from '../design-service';
import { createTestSnapshot, createRemoteTeamSnapshot, gitWorkspace } from './server-test-fixtures';

const mocks = vi.hoisted(() => ({
  snapshot: {
    agents: [{
      id: 'agent-dina',
      teamId: 'team-app',
      name: 'Dina',
      avatar: 'DI',
      folder: '/src/app',
      backend: 'codex',
      backendDefaults: { kind: 'codex' },
      status: { type: 'idle' },
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    }],
    general: {},
    workBacklog: { providerSettings: { github: { oauthClientId: 'github-client' } } },
  },
  drivers: new Map<string, unknown>(),
  mcpOptions: [] as unknown[],
  serverOptions: [] as unknown[],
  automationRunnerOptions: [] as unknown[],
  schedulerOptions: [] as unknown[],
  schedulerTasks: [] as unknown[],
  remoteOptions: [] as unknown[],
  workIntegrationOptions: [] as unknown[],
  agentGitServices: [] as Array<{ identity: ReturnType<typeof vi.fn> }>,
  sendAgentPrompt: vi.fn(),
  loadBackendSnapshot: vi.fn(),
  ensureBackendCodexHome: vi.fn(),
  ensureBackendMissionHome: vi.fn(),
  deleteBackendMissionHome: vi.fn(),
  initializeProviderSetup: vi.fn(),
  loadPluginStatus: vi.fn(),
  saveBackendSnapshot: vi.fn(),
  backendCodexHomeDir: vi.fn(() => '/tmp/codex-home'),
  backendHomeDir: vi.fn(() => '/tmp/runtime-test-home'),
  backendProviderTokensFilePath: vi.fn(),
  mcpStart: vi.fn(),
  mcpStop: vi.fn(),
  mcpHostedServerUrls: vi.fn(),
  mcpSetDriverRpc: vi.fn(),
  mcpSetEventSink: vi.fn(),
  mcpHandleBackendEvent: vi.fn(),
  mcpSendMessage: vi.fn(),
  mcpRecordPromptInputMethod: vi.fn(),
  hydrateConnections: vi.fn(),
  githubConnected: vi.fn(),
  getPullRequest: vi.fn(),
  schedulerStart: vi.fn(),
  schedulerStop: vi.fn(),
  schedulerRegister: vi.fn(),
  automationRunAll: vi.fn(),
  serverEmitEvent: vi.fn(),
  serverClose: vi.fn(),
  remoteCollaborationCall: vi.fn(),
  missionDeveloperInstructions: vi.fn(),
  collaborationAgents: vi.fn(),
  createDefaultBackendDrivers: vi.fn(),
  createBackendDriver: vi.fn(),
  useRealDriverRpc: false,
  providerLifecycles: null as ReadonlyMap<AgentBackend, ProviderLifecycle> | null,
  runtimeGitHubOAuthClientId: vi.fn(),
  warnMain: vi.fn(),
}));

vi.mock('@workspace/core/agent-chat-service', () => ({
  sendAgentPrompt: mocks.sendAgentPrompt,
}));


vi.mock('../state', () => ({
  backendHomeDir: mocks.backendHomeDir,
  loadBackendTasks: vi.fn().mockResolvedValue([]),
  saveBackendTasks: vi.fn().mockResolvedValue(undefined),
  loadBackendSnapshot: mocks.loadBackendSnapshot,
  ensureBackendCodexHome: mocks.ensureBackendCodexHome,
  ensureBackendMissionHome: mocks.ensureBackendMissionHome,
  deleteBackendMissionHome: mocks.deleteBackendMissionHome,
  saveBackendSnapshot: mocks.saveBackendSnapshot,
  backendCodexHomeDir: mocks.backendCodexHomeDir,
  backendProviderTokensFilePath: mocks.backendProviderTokensFilePath,
}));

vi.mock('../provider-setup', async importOriginal => {
  const actual = await importOriginal<typeof import('../provider-setup')>();
  return { ProviderSetup: class {
    constructor(...args: ConstructorParameters<typeof actual.ProviderSetup>) {
      if (mocks.providerLifecycles) return new actual.ProviderSetup(args[0], args[1], args[2], mocks.providerLifecycles, args[4]);
    }
    initialize: () => Promise<void> = mocks.initializeProviderSetup;
    isChanging = () => false;
  } };
});

vi.mock('../plugin-status', () => ({
  loadPluginStatus: mocks.loadPluginStatus,
}));

vi.mock('../mcp/service', () => ({
  AppMcpService: class {
    constructor(options: unknown) { mocks.mcpOptions.push(options); }
    start = mocks.mcpStart;
    stop = mocks.mcpStop;
    hostedMcpServerUrls = mocks.mcpHostedServerUrls;
    setDriverRpc = mocks.mcpSetDriverRpc;
    setEventSink = mocks.mcpSetEventSink;
    handleBackendEvent = mocks.mcpHandleBackendEvent;
    sendMessage = mocks.mcpSendMessage;
    recordPromptInputMethod = mocks.mcpRecordPromptInputMethod;
  },
}));

vi.mock('../driver-rpc', async importOriginal => {
  const actual = await importOriginal<typeof import('../driver-rpc')>();
  return {
    BackendDriverRpc: class {
      constructor(...args: ConstructorParameters<typeof actual.BackendDriverRpc>) {
        if (mocks.useRealDriverRpc) return new actual.BackendDriverRpc(...args);
      }
    },
    createDefaultBackendDrivers: mocks.createDefaultBackendDrivers,
    createBackendDriver: mocks.createBackendDriver,
  };
});

vi.mock('../work-integrations/manager', () => ({
  WorkIntegrationManager: class {
    constructor(options: unknown) { mocks.workIntegrationOptions.push(options); }
    hydrateConnections = mocks.hydrateConnections;
    close = vi.fn();
    githubConnected = mocks.githubConnected;
    getPullRequest = mocks.getPullRequest;
  },
}));

vi.mock('../work-integrations/github-driver', () => ({
  GitHubWorkProviderDriver: class {
    constructor(readonly getClientId: unknown) {}
  },
}));

vi.mock('../work-integrations/file-token-store', () => ({
  FileWorkIntegrationTokenStore: class {
    constructor(readonly path: unknown) {}
  },
}));

vi.mock('../automations/runner', () => ({
  AutomationRunner: class {
    constructor(options: unknown) { mocks.automationRunnerOptions.push(options); }
    runAll = mocks.automationRunAll;
    recoverInterruptedRuns = vi.fn().mockResolvedValue(undefined);
    handleEvent = vi.fn();
  },
}));

vi.mock('../scheduling/runtime-scheduler', () => ({
  RuntimeScheduler: class {
    constructor(options: unknown) { mocks.schedulerOptions.push(options); }
    register = (task: unknown) => {
      mocks.schedulerRegister(task);
      mocks.schedulerTasks.push(task);
    };
    start = mocks.schedulerStart;
    stop = mocks.schedulerStop;
  },
}));

vi.mock('../server', () => ({
  AppBackendServer: class {
    initialize = vi.fn().mockResolvedValue(undefined);
    setCompanionAccessEnabled = vi.fn();
    requireConnectedEngine = vi.fn(async (backend: string) => backend);
    constructor(private options: { snapshot: AppSnapshot }) { mocks.serverOptions.push(options); }
    collaborationAgents = () => mocks.collaborationAgents(this.options.snapshot);
    emitEvent = mocks.serverEmitEvent;
    close = mocks.serverClose;
    missionDeveloperInstructions = mocks.missionDeveloperInstructions;
    handleRemoteCollaborationCall = mocks.remoteCollaborationCall;
  },
}));

vi.mock('../connections/remote-daemon-client', () => ({
  RemoteDaemonClientManager: class {
    constructor(options: unknown) { mocks.remoteOptions.push(options); }
  },
}));

vi.mock('../connections/ssh-connections', () => ({
  SshConnectionService: class {},
}));

vi.mock('../runtime-config', () => ({
  runtimeGitHubOAuthClientId: mocks.runtimeGitHubOAuthClientId,
}));

vi.mock('../log', () => ({ warnMain: mocks.warnMain }));

vi.mock('../git/agent-git-service', () => ({
  AgentGitService: class {
    identity = vi.fn().mockResolvedValue({ kind: 'folder', folder: '/src/app', label: 'app', updatedAt: '2026-09-02T00:00:00.000Z' });

    constructor() {
      mocks.agentGitServices.push(this);
    }
  },
}));

import { createDaemonRuntime } from '../runtime';

type McpOptions = {
  hostedMcpGateway?: unknown;
  resolveWorkspaceIdentity(folder: string): Promise<unknown>;
  queueSpokenAnnouncement(input: unknown): Promise<unknown>;
  computerUse?: {
    execute(input: unknown): Promise<unknown>;
    requestAccessibility(): Promise<unknown>;
    status(): Promise<unknown>;
    stop(): Promise<unknown>;
  };
  browser?: {
    open(input: unknown): Promise<unknown>;
    execute(input: unknown): Promise<unknown>;
  };
};

type ServerOptions = {
  agentGitService: unknown;
  version: string;
  inspectPluginStatus(): Promise<{ chromeEnabled: boolean }>;
  onEvent(event: unknown): void;
  onBackendEventApplied(event: unknown): void;
  saveSnapshot(snapshot: unknown): Promise<unknown>;
  sendAgentMessage(fromAgentId: string, toAgentId: string, content: string): void;
  systemPermissions: {
    getStatus(): Promise<unknown>;
    openAccessibilitySettings(): Promise<unknown>;
    openScreenRecordingSettings(): Promise<unknown>;
  };
};

type AutomationRunnerOptions = {
  notifySnapshotUpdated(): void;
  saveSnapshot(): Promise<unknown>;
  sendPrompt(agentId: string, prompt: string): Promise<unknown>;
};

type SchedulerOptions = { onError(taskId: string, error: unknown): void };
type SchedulerTask = { id: string; intervalMs: number; runOnStart?: boolean; run(): Promise<unknown> };

type WorkIntegrationOptions = {
  drivers: Array<{ getClientId(): string }>;
  getSnapshot(): unknown;
  openExternal(url: string): Promise<unknown>;
  saveSnapshot(): Promise<unknown>;
};

type RemoteOptions = {
  requestHandlers: Record<string, (params: unknown, connectionId: string) => Promise<unknown>>;
};

describe('daemon runtime', () => {
  const driver = {
    generateText: vi.fn(),
    setConversationTitle: vi.fn(),
  };
  const emitEvent = vi.fn();
  const requestClient = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.serverEmitEvent.mockReset();
    mocks.useRealDriverRpc = false;
    mocks.collaborationAgents.mockImplementation((snapshot: AppSnapshot) => snapshot.agents);
    mocks.providerLifecycles = null;
    mocks.mcpOptions.length = 0;
    mocks.serverOptions.length = 0;
    mocks.automationRunnerOptions.length = 0;
    mocks.schedulerOptions.length = 0;
    mocks.schedulerTasks.length = 0;
    mocks.remoteOptions.length = 0;
    mocks.workIntegrationOptions.length = 0;
    mocks.agentGitServices.length = 0;
    mocks.snapshot.general = {};
    mocks.drivers.clear();
    mocks.drivers.set('codex', driver);
    mocks.loadBackendSnapshot.mockResolvedValue(mocks.snapshot);
    mocks.ensureBackendCodexHome.mockResolvedValue(undefined);
    mocks.initializeProviderSetup.mockResolvedValue(undefined);
    mocks.loadPluginStatus.mockResolvedValue({ chromeEnabled: false });
    mocks.saveBackendSnapshot.mockResolvedValue(undefined);
    mocks.backendProviderTokensFilePath.mockReturnValue('/tmp/provider-tokens.json');
    mocks.backendHomeDir.mockReturnValue('/tmp/runtime-test-home');
    mocks.mcpStart.mockResolvedValue('http://127.0.0.1:4242/mcp');
    mocks.mcpStop.mockResolvedValue(undefined);
    mocks.mcpHostedServerUrls.mockReturnValue({
      github: 'http://127.0.0.1:4242/mcp/providers/github',
    });
    mocks.hydrateConnections.mockResolvedValue(undefined);
    mocks.githubConnected.mockResolvedValue(false);
    mocks.serverClose.mockResolvedValue(undefined);
    mocks.missionDeveloperInstructions.mockReturnValue('<context>\nMission contract\n</context>');
    mocks.createDefaultBackendDrivers.mockReturnValue(mocks.drivers);
    mocks.runtimeGitHubOAuthClientId.mockReturnValue('github-client');
    requestClient.mockImplementation(async (method: string, params?: unknown) => ({ method, params }));
    mocks.automationRunAll.mockResolvedValue(undefined);
    driver.generateText.mockResolvedValue({ text: '{"workItemIds":["github:nbonamy/agent-workspace#12"]}' });
  });

  it('waits for local work, replaces only the upgraded provider and reloads the same conversation', async () => {
    const snapshot: AppSnapshot = createTestSnapshot();
    const agent: Agent = { ...mocks.snapshot.agents[0]!, backend: 'codex', backendDefaults: { kind: 'codex' }, status: { type: 'working' }, backendSession: { kind: 'codex', threadId: 'existing-thread' } };
    snapshot.agents = [agent];
    const events: string[] = [];
    const driver = {
      backend: 'codex', onEvent: () => () => {},
      assertHandoffReady: vi.fn(async () => { events.push('ready'); }),
      close: vi.fn(async () => { events.push('closed'); }),
    };
    const replacement = { backend: 'codex', onEvent: () => () => {}, loadConversation: vi.fn(async () => { events.push('restored'); }) };
    const claude = { backend: 'claude', onEvent: () => () => {}, close: vi.fn() };
    const installation = { executable: '/test/codex', version: '1.0.0', latestVersion: '1.1.0', method: 'native' as const, identity: 'original', command: { file: '/test/codex', args: ['update'] } };
    const inspect = vi.spyOn(ProviderUpdateRuntime.prototype, 'inspect').mockImplementation(async () => installation);
    const upgrade = vi.spyOn(ProviderUpdateRuntime.prototype, 'upgrade').mockImplementation(async () => { events.push('upgraded'); installation.version = '1.1.0'; });
    mocks.loadBackendSnapshot.mockResolvedValue(snapshot);
    mocks.useRealDriverRpc = true;
    mocks.drivers.set('codex', driver);
    mocks.drivers.set('claude', claude);
    mocks.createBackendDriver.mockReturnValue(replacement);
    let updates: ProviderUpdates | undefined;
    try {
      await createDaemonRuntime({ emitEvent, requestClient, version: 'test' });
      updates = (mocks.serverOptions[0] as { providerUpdates: ProviderUpdates }).providerUpdates;
      const checked = await updates.get('codex');
      expect(updates.request('codex', { action: 'upgrade', confirmed: true, token: checked.token })).toMatchObject({ status: 'waiting' });
      expect(driver.close).not.toHaveBeenCalled();
      agent.status = { type: 'idle' };
      const task = (mocks.schedulerTasks as SchedulerTask[]).find(task => task.id === 'provider-updates')!;
      await task.run();
      expect(events).toEqual(['ready', 'closed', 'upgraded', 'restored']);
      expect(replacement.loadConversation).toHaveBeenCalledWith(agent);
      expect(agent.backendSession).toEqual({ kind: 'codex', threadId: 'existing-thread' });
      expect(claude.close).not.toHaveBeenCalled();
      expect(await updates.get('codex')).toMatchObject({ status: 'current', installedVersion: '1.1.0' });
    } finally { await updates?.close(); inspect.mockRestore(); upgrade.mockRestore(); }
  });

  it('constructs the runtime services and forwards client-owned operations', async () => {
    await createDaemonRuntime({ emitEvent, requestClient, version: '1.2.3' });

    expect(mocks.loadBackendSnapshot).toHaveBeenCalledOnce();
    expect(mocks.initializeProviderSetup).toHaveBeenCalledOnce();
    expect(mocks.ensureBackendCodexHome).toHaveBeenCalledOnce();
    expect(mocks.mcpStart).toHaveBeenCalledOnce();
    expect(mocks.createDefaultBackendDrivers).toHaveBeenCalledWith(expect.objectContaining({
      appMcpServerUrl: 'http://127.0.0.1:4242/mcp',
      generalSettings: mocks.snapshot.general,
      pluginSettings: expect.any(Function),
    }));
    expect(mocks.hydrateConnections).toHaveBeenCalledOnce();
    expect(mocks.schedulerStart).toHaveBeenCalledOnce();
    expect(mocks.schedulerTasks).toEqual([
      expect.objectContaining({ id: 'automations', intervalMs: 60_000, runOnStart: true }),
      expect.objectContaining({ id: 'provider-updates', intervalMs: 2_000 }),
      expect.objectContaining({ id: 'pull-request-monitor', intervalMs: 300_000, runOnStart: true }),
    ]);
    expect(mocks.mcpSetDriverRpc).toHaveBeenCalledOnce();
    expect(mocks.mcpSetEventSink).toHaveBeenCalledOnce();

    const mcp = mocks.mcpOptions[0] as McpOptions;
    expect(mcp.hostedMcpGateway).toBeDefined();
    await mcp.resolveWorkspaceIdentity('/src/app');
    expect(mocks.agentGitServices[0]?.identity).toHaveBeenCalledWith('/src/app');
    await mcp.computerUse!.execute({ command: 'click' });
    await mcp.computerUse!.requestAccessibility();
    await mcp.computerUse!.status();
    await mcp.computerUse!.stop();
    await mcp.browser!.open({ url: 'https://example.com' });
    await mcp.browser!.execute({ command: 'dom' });
    await mcp.queueSpokenAnnouncement({
      agentId: 'agent-dina', phase: 'start', text: 'On it.', voice: 'af_heart',
    });
    expect(requestClient.mock.calls.map(([method]) => method)).toStrictEqual([
      backendMethods.clientComputerUseExecute,
      backendMethods.clientComputerUseRequestAccessibility,
      backendMethods.clientComputerUseStatusGet,
      backendMethods.clientComputerUseStop,
      backendMethods.clientBrowserOpen,
      backendMethods.clientBrowserExecute,
      backendMethods.clientSpokenAnnouncementQueue,
    ]);

    const driverOptions = mocks.createDefaultBackendDrivers.mock.calls[0]?.[0] as {
      hostedMcpServerUrls(): Record<string, string>;
      additionalDeveloperInstructions(agent: { id: string }): string | undefined;
    };
    expect(driverOptions.hostedMcpServerUrls()).toStrictEqual({
      github: 'http://127.0.0.1:4242/mcp/providers/github',
    });
    const instructions = driverOptions.additionalDeveloperInstructions(mocks.snapshot.agents[0]!);
    expect(instructions?.startsWith('<context>\nMission contract\n</context>\n\n')).toBe(true);
    expect(instructions).toContain('korus-visualize');
    expect(mocks.missionDeveloperInstructions).toHaveBeenCalledWith('agent-dina');

    const server = mocks.serverOptions[0] as ServerOptions;
    expect(server.agentGitService).toBe(mocks.agentGitServices[0]);
    expect(server.version).toBe('1.2.3');
    server.onEvent({ type: 'test' });
    expect(emitEvent).toHaveBeenCalledWith({ type: 'test' });
    server.onBackendEventApplied({ type: 'backend' });
    expect(mocks.mcpHandleBackendEvent).toHaveBeenCalledWith({ type: 'backend' });
    await server.saveSnapshot({ next: true });
    expect(mocks.saveBackendSnapshot).toHaveBeenCalledWith({ next: true });
    server.sendAgentMessage('agent-dina', 'agent-jesse', 'hello');
    expect(mocks.mcpSendMessage).toHaveBeenCalledWith('agent-dina', 'agent-jesse', 'hello');
    await server.systemPermissions.getStatus();
    await server.systemPermissions.openAccessibilitySettings();
    await server.systemPermissions.openScreenRecordingSettings();
    expect(requestClient).toHaveBeenCalledWith(backendMethods.clientSystemPermissionsGet);
    expect(requestClient).toHaveBeenCalledWith(backendMethods.clientSystemPermissionsAccessibilityOpen);
    expect(requestClient).toHaveBeenCalledWith(backendMethods.clientSystemPermissionsScreenRecordingOpen);

    const workIntegrations = mocks.workIntegrationOptions[0] as WorkIntegrationOptions;
    expect(workIntegrations.getSnapshot()).toBe(mocks.snapshot);
    expect(workIntegrations.drivers[0]?.getClientId()).toBe('github-client');
    expect(mocks.runtimeGitHubOAuthClientId).toHaveBeenCalledWith({ oauthClientId: 'github-client' });
    await workIntegrations.saveSnapshot();
    expect(workIntegrations).not.toHaveProperty('openExternal');
    expect(mocks.saveBackendSnapshot).toHaveBeenCalledWith(mocks.snapshot);

    const remote = mocks.remoteOptions[0] as RemoteOptions;
    for (const [method, handler] of Object.entries(remote.requestHandlers)) {
      if (method === backendMethods.clientCollaborationCall) {
        mocks.remoteCollaborationCall.mockResolvedValue({ content: [] });
        const input = { ownerId: 'controller', agentId: 'worker', name: 'list-agents', arguments: {} };
        expect(await handler(input, 'host-one')).toStrictEqual({ ownerId: 'controller', result: { content: [] } });
        expect(mocks.remoteCollaborationCall).toHaveBeenCalledExactlyOnceWith('host-one', input);
        continue;
      }
      await handler({ request: method }, 'host-one');
      expect(requestClient).toHaveBeenCalledWith(method, { request: method });
    }

    const sink = mocks.mcpSetEventSink.mock.calls[0]?.[0] as (event: unknown) => void;
    sink({ type: 'sink-event' });
    expect(mocks.serverEmitEvent).toHaveBeenCalledWith({ type: 'sink-event' });

    const automationTask = mocks.schedulerTasks[0] as SchedulerTask;
    await automationTask.run();
    expect(mocks.automationRunAll).toHaveBeenCalledOnce();
  });

  it('publishes local Design changes without removing projected SSH agents from the client roster', async () => {
    const snapshot = createTestSnapshot();
    const local: Agent = { ...mocks.snapshot.agents[0]!, teamId: 'team-test' } as Agent;
    snapshot.agents = [local];
    snapshot.teams[0]!.agentIds = [local.id];
    snapshot.teams[0]!.remoteLinks = [{ connectionId: 'devbox', remoteTeamId: 'team-remote' }];
    const remoteTeams = new RemoteTeamService({ getSnapshot: () => snapshot, clients: {} as never,
      onForwardedEvent: vi.fn(), onProjectedSnapshotChanged: vi.fn() });
    remoteTeams.rememberSnapshot('devbox', createRemoteTeamSnapshot([{ ...local, id: 'remote', teamId: 'team-remote' }]));
    const client = structuredClone(remoteTeams.clientSnapshotFromKnownRemotes());
    expect(client.agents.map(agent => agent.id)).toStrictEqual([local.id, 'remote']);
    mocks.loadBackendSnapshot.mockResolvedValue(snapshot);
    mocks.serverEmitEvent.mockImplementation(event => applyMainEventToSnapshot(client, event));
    const runtime = await createDaemonRuntime({ emitEvent, requestClient, version: 'test' });
    try {
      const design = (mocks.serverOptions[0] as { designService: DesignService }).designService;
      for (const type of ['open', 'close'] as const) {
        await design.execute(local.id, { type });
        expect(client.agents.map(agent => agent.id)).toStrictEqual([local.id, 'remote']);
        expect(client.teams[0]!.agentIds).toStrictEqual([local.id, 'remote']);
        expect(client.agents[0]!.designWorkspace?.isOpen).toBe(type === 'open');
        expect(snapshot.agents.map(agent => agent.id)).toStrictEqual([local.id]);
      }
    } finally { await runtime.stop(); }
  });

  it('gives Quick Chats a current team project catalog without importing other conversations or teams', async () => {
    const snapshot = createTestSnapshot();
    const project: Agent = { ...mocks.snapshot.agents[0]!, teamId: 'team-test', workspace: gitWorkspace('/src/app', 'App', 'main') } as Agent;
    const chat: Agent = { ...project, id: 'quick', name: null, folder: null, workspace: undefined, sessionKind: 'quickChat' };
    snapshot.agents = [project, chat, { ...project, id: 'private', teamId: 'other-team', folder: '/private/project' }];
    snapshot.teams[0]!.agentIds = [project.id, chat.id];
    // Remote projects belong to their owning daemon, never the persisted local roster.
    snapshot.teams[0]!.remoteLinks = [{ connectionId: 'devbox', remoteTeamId: 'team-remote' }];
    const remoteTeams = new RemoteTeamService({
      getSnapshot: () => snapshot, clients: {} as never,
      onForwardedEvent: vi.fn(), onProjectedSnapshotChanged: vi.fn(),
    });
    mocks.collaborationAgents.mockImplementation(() => remoteTeams.clientSnapshotFromKnownRemotes().agents);
    mocks.loadBackendSnapshot.mockResolvedValue(snapshot);
    const runtime = await createDaemonRuntime({ emitEvent, requestClient, version: 'test' });
    try {
      const options = mocks.createDefaultBackendDrivers.mock.calls[0]![0] as import('../driver-rpc').BackendDriverRegistryOptions;
      const context = (agent: Agent) => {
        const instructions = options.additionalDeveloperInstructions!(agent)!;
        const data = instructions.match(/<team_context>\n(.*?)\n<\/team_context>/s)?.[1];
        expect(data).toBeDefined();
        expect(instructions).not.toContain('/private/project');
        expect(instructions).not.toContain('Dina');
        return JSON.parse(data!);
      };
      expect(context(chat)).toStrictEqual({
        team: { id: 'team-test', name: 'Test Team' },
        projects: [{ name: 'App', locations: [{ folder: '/src/app' }] }],
      });
      // A linked worktree stays part of its repository; folders and remote locations remain distinct.
      snapshot.agents.push(
        { ...project, id: 'worktree', folder: '/src/app-fix', workspace: { ...project.workspace!, folder: '/src/app-fix', isLinkedWorktree: true } as Agent['workspace'] },
        { ...project, id: 'notes', folder: '/src/notes', workspace: { kind: 'folder', folder: '/src/notes', label: 'Notes', updatedAt: '' } },
      );
      remoteTeams.rememberSnapshot('devbox', createRemoteTeamSnapshot([
        { ...project, id: 'remote', teamId: 'team-remote', folder: '/srv/app', workspace: gitWorkspace('/srv/app', 'Remote App', 'main') },
      ]));
      expect(context({ ...chat, backend: 'claude' }).projects).toStrictEqual([
        { name: 'App', locations: [{ folder: '/src/app' }, { folder: '/src/app-fix' }] },
        { name: 'Notes', locations: [{ folder: '/src/notes' }] },
        { name: 'Remote App', locations: [{ folder: '/srv/app', remoteConnectionId: 'devbox' }] },
      ]);
      expect(options.additionalDeveloperInstructions!(project)).not.toContain('<team_context>');
      snapshot.agents = [chat];
      expect(context(chat).projects).toStrictEqual([
        { name: 'Remote App', locations: [{ folder: '/srv/app', remoteConnectionId: 'devbox' }] },
      ]);
      snapshot.teams[0]!.remoteLinks = [];
      expect(context(chat).projects).toStrictEqual([]);
      expect(options.additionalDeveloperInstructions!({ ...chat, teamId: 'missing' })).not.toContain('<team_context>');
    } finally { await runtime.stop(); }
  });

  it('removes desktop-owned tools from a web-hosted runtime', async () => {
    mocks.snapshot.general = {
      plugins: { computerUseEnabled: true, chromeEnabled: true },
    };
    mocks.loadPluginStatus.mockResolvedValueOnce({ chromeEnabled: true });

    await createDaemonRuntime({
      emitEvent,
      features: { computerUse: false, embeddedBrowser: false },
      requestClient,
      version: '1.2.3',
    });

    const mcp = mocks.mcpOptions[0] as McpOptions & { computerUseEnabled(): boolean };
    expect(mcp.computerUse).toBeUndefined();
    expect(mcp.browser).toBeUndefined();
    expect(mcp.computerUseEnabled()).toBe(false);

    const driverOptions = mocks.createDefaultBackendDrivers.mock.calls[0]?.[0] as {
      pluginSettings(): { computerUseEnabled: boolean; chromeEnabled: boolean };
    };
    expect(driverOptions.pluginSettings()).toEqual({
      computerUseEnabled: false,
      chromeEnabled: true,
    });
    expect(requestClient).not.toHaveBeenCalled();
  });

  it('uses the installed Chrome plugin status for Codex sessions and refreshes it from settings', async () => {
    mocks.snapshot.general = {
      plugins: { computerUseEnabled: false, chromeEnabled: false },
    };
    mocks.loadPluginStatus.mockResolvedValueOnce({ chromeEnabled: true });

    await createDaemonRuntime({ emitEvent, requestClient, version: '1.2.3' });

    const driverOptions = mocks.createDefaultBackendDrivers.mock.calls[0]?.[0] as {
      pluginSettings(): { computerUseEnabled: boolean; chromeEnabled: boolean };
    };
    expect(driverOptions.pluginSettings()).toStrictEqual({
      computerUseEnabled: false,
      chromeEnabled: true,
    });

    mocks.loadPluginStatus.mockResolvedValueOnce({ chromeEnabled: false });
    const server = mocks.serverOptions[0] as ServerOptions;
    await expect(server.inspectPluginStatus()).resolves.toStrictEqual({ chromeEnabled: false });
    expect(driverOptions.pluginSettings()).toStrictEqual({
      computerUseEnabled: false,
      chromeEnabled: false,
    });
  });

  it('uses the selected home Chrome configuration when switching Codex homes and rolling back a failed save', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'korus-home-switch-'));
    const existingHome = path.join(root, 'existing');
    const isolatedHome = path.join(root, 'app', 'codex-home');
    vi.stubEnv('APP_HOME', path.join(root, 'app'));
    vi.stubEnv('CODEX_HOME', existingHome);
    mocks.backendHomeDir.mockReturnValue(path.join(root, 'app'));
    try {
      await mkdir(existingHome);
      await writeFile(path.join(existingHome, 'config.toml'), '[plugins."chrome@openai-bundled"]\nenabled = true\n');
      const snapshot = createTestSnapshot();
      snapshot.general.providerHomes = { codex: { isolated: false, shareSkills: false, homePath: existingHome } };
      mocks.loadBackendSnapshot.mockResolvedValue(snapshot);
      mocks.providerLifecycles = new Map([['codex', createCodexLifecycle()]]);
      mocks.useRealDriverRpc = true;
      const { loadPluginStatus } = await vi.importActual<typeof import('../plugin-status')>('../plugin-status');
      mocks.loadPluginStatus.mockImplementation(loadPluginStatus);
      const host = () => ({ backend: 'codex', onEvent: () => () => {}, close: vi.fn() });
      mocks.drivers.set('codex', host());
      const launches: Array<{ home: string; chromeEnabled: boolean; configOverrides: string[] }> = [];
      mocks.createBackendDriver.mockImplementation((_backend, options) => {
        const settings = options.pluginSettings();
        launches.push({
          home: options.generalSettings.providerHomes.codex.homePath,
          chromeEnabled: settings.chromeEnabled,
          configOverrides: buildAppMcpConfigOverrides(settings),
        });
        return host();
      });
      const runtime = await createDaemonRuntime({ emitEvent, requestClient, version: 'test' });
      try {
        const setup = (mocks.serverOptions[0] as { providerSetup: ProviderSetup }).providerSetup;
        await setup.configure('codex', { isolated: true, shareSkills: false });
        expect(launches[0]).toMatchObject({ home: isolatedHome, chromeEnabled: false });
        expect(launches[0]!.configOverrides).not.toContain('mcp_servers.node_repl.enabled=true');

        await setup.configure('codex', { isolated: false, shareSkills: false });
        expect(launches[1]).toMatchObject({ home: existingHome, chromeEnabled: true });

        mocks.saveBackendSnapshot.mockRejectedValueOnce(new Error('save failed'));
        await expect(setup.configure('codex', { isolated: true, shareSkills: false })).rejects.toThrow('save failed');
        expect(launches.slice(2).map(({ home, chromeEnabled }) => ({ home, chromeEnabled }))).toStrictEqual([
          { home: isolatedHome, chromeEnabled: false },
          { home: existingHome, chromeEnabled: true },
        ]);
        expect(snapshot.general.providerHomes.codex).toMatchObject({ homePath: existingHome });
      } finally { await runtime.stop(); }
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs automation prompts, records new conversations, and emits snapshot updates', async () => {
    let titlePromise: Promise<void> | undefined;
    let startedPromise: Promise<void> | undefined;
    mocks.sendAgentPrompt.mockImplementation((_snapshot, _driver, _agentId, _prompt, _options, emit, hooks) => {
      emit({ agentId: 'agent-dina', type: 'agent.statusChanged', payload: { type: 'working' } });
      titlePromise = hooks.onBackendSessionUpdated({
        backendSession: { kind: 'codex', threadId: 'thread-42' },
      }, true);
      startedPromise = hooks.onPromptStarted({
        backendSession: { kind: 'codex', threadId: 'thread-42' },
      });
    });

    await createDaemonRuntime({ emitEvent, requestClient, version: '1.2.3' });
    const automations = mocks.automationRunnerOptions[0] as AutomationRunnerOptions;
    await expect(automations.sendPrompt('missing', 'ignore'))
      .rejects.toThrow('unavailable or busy');
    expect(mocks.sendAgentPrompt).not.toHaveBeenCalled();

    await expect(automations.sendPrompt('agent-dina', 'run tests'))
      .resolves.toEqual({ backend: 'codex', threadId: 'thread-42' });
    await titlePromise;
    await startedPromise;
    expect(mocks.sendAgentPrompt).toHaveBeenCalledWith(
      mocks.snapshot,
      driver,
      'agent-dina',
      'run tests',
      undefined,
      expect.any(Function),
      expect.any(Object),
    );
    expect(driver.setConversationTitle).toHaveBeenCalledWith(
      mocks.snapshot.agents[0],
      'Dina',
    );

    automations.notifySnapshotUpdated();
    await automations.saveSnapshot();
    expect(mocks.serverEmitEvent).toHaveBeenLastCalledWith({
      type: 'snapshot.updated',
      payload: mocks.snapshot,
    });
  });

  it('handles lifecycle shutdown and nonfatal scheduler/title failures', async () => {
    let hooks: { onBackendSessionUpdated(result: unknown, isNew: boolean): Promise<void> } | undefined;
    mocks.sendAgentPrompt.mockImplementation((_snapshot, _driver, _agentId, _prompt, _options, _emit, value) => {
      hooks = value;
      value.onPromptStarted({ backendSession: { kind: 'codex', threadId: 'thread' } });
    });
    driver.setConversationTitle.mockRejectedValue('rename failed');
    const runtime = await createDaemonRuntime({ emitEvent, requestClient, version: '1.2.3' });
    const automations = mocks.automationRunnerOptions[0] as AutomationRunnerOptions;
    await automations.sendPrompt('agent-dina', 'run');
    await hooks?.onBackendSessionUpdated({ backendSession: { kind: 'codex', threadId: 'thread' } }, false);
    await hooks?.onBackendSessionUpdated({ backendSession: { kind: 'codex', threadId: 'thread' } }, true);
    expect(mocks.warnMain).toHaveBeenCalledWith('conversation-title', 'failed', {
      agentId: 'agent-dina',
      message: 'rename failed',
    });

    const scheduler = mocks.schedulerOptions[0] as SchedulerOptions;
    scheduler.onError('automations', new Error('automation failed'));
    scheduler.onError('pull-request-monitor', 'github string failure');
    expect(mocks.warnMain).toHaveBeenCalledWith('runtime-scheduler', 'task failed', { taskId: 'automations', message: 'automation failed' });
    expect(mocks.warnMain).toHaveBeenCalledWith('runtime-scheduler', 'task failed', { taskId: 'pull-request-monitor', message: 'github string failure' });

    await runtime.stop();
    expect(mocks.schedulerStop).toHaveBeenCalledOnce();
    expect(mocks.serverClose).toHaveBeenCalledOnce();
    expect(mocks.mcpStop).toHaveBeenCalledOnce();
  });

  it('rejects automation prompts when a backend driver is not configured', async () => {
    const runtime = await createDaemonRuntime({ emitEvent, requestClient, version: '1.2.3' });
    mocks.drivers.clear();
    const automations = mocks.automationRunnerOptions[0] as AutomationRunnerOptions;

    await expect(automations.sendPrompt('agent-dina', 'run'))
      .rejects.toThrowError('Backend driver is not configured: codex');
    await runtime.stop();
  });
});
