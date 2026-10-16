import { mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderSetup } from '../provider-setup';
import { createTestSnapshot, createRemoteAgent } from './server-test-fixtures';
import { AppBackendServer } from '../server';
import { backupProviderSetup, loadBackendSnapshot, saveBackendSnapshot } from '../state';
import type { Agent } from '@workspace/core/contracts';
import { createMission } from '@workspace/core/missions';

const cli = vi.hoisted(() => ({ installed: new Set<string>(), fail: false, installs: 0 }));
vi.mock('@workspace/core/runtime-discovery', () => ({
  resolveRuntimeExecutable: (command: string) => cli.installed.has(command) ? command : null,
  withDiscoveredRuntimePath: () => ({}),
  resolveRuntimeLaunch: (command: string) => ({ command, env: {} }),
}));
vi.mock('../claude/claude-command', async original => ({
  ...await original<typeof import('../claude/claude-command')>(),
  resolveClaudeExecutable: () => cli.installed.has('claude') ? 'claude' : null,
}));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: Object.assign(() => undefined, {
    [Symbol.for('nodejs.util.promisify.custom')]: async () => {
      cli.installs++;
      if (cli.fail) throw new Error('private installer output');
      cli.installed.add('claude');
      return { stdout: '', stderr: '' };
    },
  }),
}));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'app-provider-setup-'));
  vi.stubEnv('APP_HOME', path.join(root, 'app'));
  vi.stubEnv('CODEX_HOME', path.join(root, 'codex'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(root, 'claude'));
  vi.stubEnv('GEMINI_HOME', path.join(root, 'gemini'));
  vi.stubEnv('APP_BUNDLED_CODEX_PATH', '');
  vi.stubEnv('APP_CLAUDE_COMMAND', '');
  cli.installed.clear(); cli.installs = 0; cli.fail = false;
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

function addRosterLinks(snapshot: import('@workspace/core/contracts').AppSnapshot, removedId: string, survivingId: string) {
  const survivor = snapshot.agents.find(agent => agent.id === survivingId)!;
  survivor.delegatedByAgentId = removedId;
  snapshot.agentGitStatuses[removedId] = { folder: '/repo', ahead: 0, behind: 0, changedFiles: 0, addedLines: 0, removedLines: 0, hasUntracked: false, state: 'clean', updatedAt: 'now' };
  snapshot.turnGitDiffs['removed-turn'] = { agentId: removedId, turnId: 'removed-turn', addedLines: 1, removedLines: 0, updatedAt: 'now' };
  snapshot.subagentTrees[removedId] = { rootConversationId: 'thread-parent', nodes: {}, operations: {}, activities: {} };
  snapshot.backendApprovals[removedId] = [];
  snapshot.agentRequests = { [removedId]: [] };
  snapshot.workBacklog.assignments['github:issue'] = { provider: 'github', itemId: 'issue', agentId: removedId, assignedAt: 'now', policy: 'review', status: 'inProgress' };
  snapshot.clientPreferences = { desktop: {
    activeAgentId: removedId, activeAgentByTeam: { 'team-test': removedId }, agentOrderByTeam: { 'team-test': [removedId, survivingId] },
    externalApplications: { [removedId]: 'vscode' }, general: { savedPromptDrafts: [{ id: 'draft', agentId: removedId, text: 'draft', createdAt: 1 }] },
  } };
  snapshot.automations = [{ id: 'automation-test', name: 'Issues',  enabled: true, prompt: 'Check tasks', target: { kind: 'agent' as const, agentId: removedId },  schedule: { intervalMinutes: 60 }, createdAt: 'now', updatedAt: 'now', executionLog: [{
    id: 'execution-test', automationId: 'automation-test', startedAt: 'now', status: 'working',
    agentId: removedId, agentName: 'Old agent',
  }] }];
  const mission = createMission(snapshot, { outcome: 'Ship a feature', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: survivingId });
  mission.stageAgentIds = { requirements: removedId };
  mission.execution!.runs = [{ id: 'run-old', memberId: survivingId, workerId: removedId, stage: 'requirements', status: 'accepted', skills: [], feedback: '', startedAt: 'now' }];
  mission.execution!.deliveries = [{ repositoryPath: '/repo', agentId: removedId, status: 'merged' }];
  return mission;
}

describe('provider onboarding setup', () => {
  it('installs only on explicit RPC request, serializes setup, and publishes detected availability', async () => {
    const snapshot = createTestSnapshot();
    let installed = false;
    let finish!: () => void;
    const install = vi.fn(async () => { await new Promise<void>(resolve => { finish = resolve; }); installed = true; });
    const lifecycle = { home: () => ({ isolated: true, shareSkills: false, homePath: root }), installed: () => installed,
      prepareHome: vi.fn(), install, applyHome: vi.fn() };
    const reconnect = vi.fn();
    const setup = new ProviderSetup(snapshot, vi.fn(), reconnect, new Map([['antigravity', lifecycle]]));
    await setup.initialize();
    const server = new AppBackendServer({ version: 'test', snapshot, providerSetup: setup });
    try {
      expect(install).not.toHaveBeenCalled();
      const request = server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/install', params: { backend: 'antigravity' } });
      await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
      await expect(setup.refresh('antigravity')).rejects.toThrow('already in progress');
      finish();
      expect(await request).toMatchObject({ result: { backend: 'antigravity', installed: true } });
      expect(setup.list()[0]?.installed).toBe(true);
      expect(reconnect).toHaveBeenCalledWith('antigravity');
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'provider/install', params: { backend: 'antigravity' } });
      expect(install).toHaveBeenCalledOnce();
    } finally { await server.close(); }
  });
  it('requires exact confirmation, then removes only local engine agents and keeps provider history across reload', async () => {
    const snapshot = createTestSnapshot();
    const local = { ...createRemoteAgent(), id: 'local', teamId: 'team-test', backend: 'claude' as const, status: { type: 'idle' as const } };
    const quick = { ...local, id: 'quick', folder: null, sessionKind: 'quickChat' as const };
    const other = { ...local, id: 'other', backend: 'codex' as const };
    const remote = { ...local, id: 'remote', teamId: 'team-remote' };
    snapshot.agents = [local, quick, other, remote];
    snapshot.teams[0]!.agentIds = ['local', 'quick', 'other'];
    snapshot.teams[0]!.activeAgentId = 'local';
    snapshot.teams.push({ id: 'team-remote', name: 'Remote', remoteConnectionId: 'remote-host', agentIds: ['remote'] });
    snapshot.activeAgentId = 'local';
    snapshot.queuedPrompts = [{ id: 'queued', agentId: 'quick', text: 'later', createdAt: 'now' }];
    snapshot.general.savedPromptDrafts = [{ id: 'draft', agentId: 'quick', text: 'draft', createdAt: 1 }];
    const mission = addRosterLinks(snapshot, 'quick', 'other');
    const setup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), vi.fn(), undefined, () => backupProviderSetup(snapshot));
    await setup.initialize();
    const oldHome = snapshot.general.providerHomes!.claude!.homePath;
    await writeFile(path.join(oldHome, 'conversation.jsonl'), 'keep provider history');
    const choice = { isolated: true, shareSkills: true };
    await expect(setup.configure('claude', choice)).rejects.toThrow('already has chats');
    await expect(setup.configure('claude', { ...choice, removeAgentIds: ['local'] })).rejects.toThrow('changed');
    expect(snapshot.agents).toHaveLength(4);
    await setup.configure('claude', { ...choice, removeAgentIds: ['quick', 'local'] });
    expect(snapshot.agents.map(agent => agent.id)).toEqual(['other', 'remote']);
    expect(snapshot.teams[0]).toMatchObject({ agentIds: ['other'], activeAgentId: 'other' });
    expect(snapshot.queuedPrompts).toEqual([]);
    expect(snapshot.general.savedPromptDrafts).toEqual([]);
    expect(snapshot.clientPreferences?.desktop).toMatchObject({ activeAgentId: 'other', activeAgentByTeam: {}, agentOrderByTeam: { 'team-test': ['other'] } });
    expect(mission.stageAgentIds).toEqual({});
    expect(mission.execution!.memberIds).toEqual(['other']);
    expect(mission.execution!.runs).toEqual([]);
    expect(mission.execution!.deliveries).toEqual([]);
    expect(snapshot.automations[0]!.executionLog).toEqual([]);
    expect(snapshot.workBacklog.assignments).toEqual({});
    expect(snapshot.agentGitStatuses).toEqual({});
    expect(snapshot.turnGitDiffs).toEqual({});
    expect(snapshot.subagentTrees).toEqual({});
    expect(other.delegatedByAgentId).toBeUndefined();
    expect((await loadBackendSnapshot()).agents.map(agent => agent.id)).toEqual(['other', 'remote']);
    expect(await readFile(path.join(oldHome, 'conversation.jsonl'), 'utf8')).toBe('keep provider history');
    const backup = (await readdir(path.join(root, 'app/backups'))).find(file => file.startsWith('provider-setup-roster'))!;
    expect(JSON.parse(await readFile(path.join(root, 'app/backups', backup), 'utf8')).data.agents).toHaveLength(4);
  });

  it('does not touch the home or roster if its verified backup cannot be made', async () => {
    const snapshot = createTestSnapshot();
    snapshot.agents = [{ ...createRemoteAgent(), backend: 'claude' }];
    const reconnect = vi.fn();
    const setup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), reconnect, undefined, async () => { throw new Error('backup failed'); });
    await setup.initialize();
    const before = structuredClone(snapshot);
    await expect(setup.configure('claude', { isolated: true, shareSkills: true, removeAgentIds: ['agent-remote'] })).rejects.toThrow('backup failed');
    expect(snapshot).toEqual(before);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('rechecks consent after preparation and refuses a newly active agent without removing it', async () => {
    const snapshot = createTestSnapshot();
    const agent: Agent = { ...createRemoteAgent(), backend: 'claude' };
    snapshot.agents = [agent];
    const reconnect = vi.fn().mockImplementationOnce(async () => { agent.status = { type: 'working' }; });
    const setup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), reconnect);
    await setup.initialize();
    const previous = snapshot.general.providerHomes!.claude;
    await expect(setup.configure('claude', { isolated: true, shareSkills: true, removeAgentIds: [agent.id] })).rejects.toThrow('idle');
    expect(snapshot.agents).toEqual([agent]);
    expect(snapshot.general.providerHomes!.claude).toEqual(previous);
    expect(agent.status.type).toBe('working');
  });

  it('rejects an active agent and rolls back the roster/home if saving the switch fails', async () => {
    const snapshot = createTestSnapshot();
    const agent: Agent = { ...createRemoteAgent(), id: 'local', teamId: 'team-test', backend: 'claude', status: { type: 'working' } };
    const other: Agent = { ...agent, id: 'other', backend: 'codex', status: { type: 'working' } };
    snapshot.agents = [agent, other];
    snapshot.teams[0]!.agentIds = [agent.id, other.id];
    snapshot.activeAgentId = agent.id;
    snapshot.teams[0]!.activeAgentId = agent.id;
    addRosterLinks(snapshot, agent.id, other.id);
    let fail = false;
    const setup = new ProviderSetup(snapshot, async () => {
      if (fail) {
        fail = false;
        other.status = { type: 'working', detail: 'Still running' };
        snapshot.turnGitDiffs['other-turn'] = { agentId: other.id, turnId: 'other-turn', addedLines: 10, removedLines: 1, updatedAt: 'now' };
        throw new Error('disk full');
      }
      await saveBackendSnapshot(snapshot);
    }, vi.fn());
    await setup.initialize();
    const originalLinks = structuredClone({ missions: snapshot.missions, automations: snapshot.automations, workBacklog: snapshot.workBacklog, clientPreferences: snapshot.clientPreferences, teams: snapshot.teams });
    const previous = snapshot.general.providerHomes!.claude;
    const choice = { isolated: true, shareSkills: true, removeAgentIds: [agent.id] };
    await expect(setup.configure('claude', choice)).rejects.toThrow('idle');
    agent.status = { type: 'idle' };
    fail = true;
    await expect(setup.configure('claude', choice)).rejects.toThrow('disk full');
    expect(snapshot.agents).toEqual([agent, other]);
    expect(other.status).toEqual({ type: 'working', detail: 'Still running' });
    expect(snapshot.turnGitDiffs['other-turn']).toMatchObject({ addedLines: 10 });
    expect(snapshot.turnGitDiffs['removed-turn']).toMatchObject({ agentId: agent.id });
    expect({ missions: snapshot.missions, automations: snapshot.automations, workBacklog: snapshot.workBacklog, clientPreferences: snapshot.clientPreferences, teams: snapshot.teams }).toEqual(originalLinks);
    expect(other.delegatedByAgentId).toBe(agent.id);
    expect(snapshot.general.providerHomes!.claude).toEqual(previous);
    expect((await loadBackendSnapshot()).agents.map(agent => agent.id)).toEqual(['local', 'other']);
  });

  it.each(['review', 'mission'] as const)('requires finishing linked %s work before resetting its engine', async kind => {
    const snapshot = createTestSnapshot();
    const agent: Agent = { ...createRemoteAgent(), id: 'local', teamId: 'team-test', backend: 'claude' };
    const other: Agent = { ...agent, id: 'other', backend: 'codex' };
    snapshot.agents = [agent, other]; snapshot.teams[0]!.agentIds = [agent.id, other.id];
    if (kind === 'review') other.codeReview = { id: 'review', targetAgentId: agent.id, reviewerAgentId: other.id, scope: { type: 'uncommitted' }, threadMode: 'independent', status: 'ready', activeRoundId: 'round', rounds: [], createdAt: 'now', updatedAt: 'now' };
    else addRosterLinks(snapshot, agent.id, other.id).execution!.runs[0]!.status = 'awaitingReview';
    const reconnect = vi.fn();
    const setup = new ProviderSetup(snapshot, vi.fn(), reconnect);
    await setup.initialize();
    await expect(setup.configure('claude', { isolated: true, shareSkills: true, removeAgentIds: [agent.id] })).rejects.toThrow(kind === 'review' ? 'code reviews' : 'Mission');
    expect(snapshot.agents).toHaveLength(2);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('restores a sparse roster after a failed switch without reviving consumed prompts or discarding new background agents', async () => {
    const snapshot = createTestSnapshot();
    const agent: Agent = { ...createRemoteAgent(), id: 'local', teamId: 'team-test', backend: 'claude' };
    const other: Agent = { ...agent, id: 'other', backend: 'codex' };
    snapshot.agents = [agent, other];
    snapshot.teams[0]!.agentIds = [agent.id, other.id];
    snapshot.teams[0]!.activeAgentId = other.id;
    snapshot.activeAgentId = other.id;
    snapshot.queuedPrompts = [{ id: 'consumed', agentId: other.id, text: 'work', createdAt: 'now' }];
    delete snapshot.clientPreferences;
    delete snapshot.agentRequests;
    const mission = createMission(snapshot, { outcome: 'Prepare work', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: other.id });
    delete mission.execution;
    let fail = false;
    const setup = new ProviderSetup(snapshot, async () => {
      if (!fail) return;
      fail = false;
      snapshot.queuedPrompts = [];
      snapshot.agents.push({ ...other, id: 'background', status: { type: 'working' } });
      snapshot.teams[0]!.agentIds.push('background');
      createMission(snapshot, { outcome: 'New background work', workflowType: 'shapeAndShipFeature', teamId: 'team-test', orchestratorMemberId: 'background' });
      throw new Error('save failed');
    }, vi.fn());
    await setup.initialize();
    const previous = snapshot.general.providerHomes!.claude;
    fail = true;
    await expect(setup.configure('claude', { isolated: true, shareSkills: true, removeAgentIds: [agent.id] })).rejects.toThrow('save failed');
    expect(snapshot.agents.map(item => item.id)).toEqual(['local', 'other', 'background']);
    expect(snapshot.teams[0]).toMatchObject({ activeAgentId: 'other', agentIds: ['local', 'other', 'background'] });
    expect(snapshot.queuedPrompts).toEqual([]);
    expect(snapshot.missions?.map(item => item.outcome)).toEqual(['Prepare work', 'New background work']);
    expect(snapshot.general.providerHomes!.claude).toEqual(previous);
  });
  it('redetects an externally installed CLI without replacing an already available driver', async () => {
    const snapshot = createTestSnapshot();
    let installed = false;
    const prepareHome = vi.fn();
    const applyHome = vi.fn();
    const lifecycle: import('../provider-lifecycle').ProviderLifecycle = {
      home: (_snapshot, choice = { isolated: true, shareSkills: false }) => ({ ...choice, homePath: '/engine-owned/home' }),
      installed: () => installed,
      prepareHome, applyHome,
    };
    const reconnect = vi.fn();
    const setup = new ProviderSetup(snapshot, vi.fn(), reconnect, new Map([['claude', lifecycle]]));
    await setup.initialize();
    expect(setup.list()).toEqual([{ backend: 'claude', installed: false, locked: false, affectedAgentIds: [], homePath: '/engine-owned/home', isolated: true, shareSkills: false }]);
    expect(await setup.refresh('claude')).toMatchObject({ installed: false });
    expect(reconnect).not.toHaveBeenCalled();
    installed = true;
    expect(await setup.refresh('claude')).toMatchObject({ installed: true });
    expect(await setup.refresh('claude')).toMatchObject({ installed: true });
    expect(reconnect).toHaveBeenCalledOnce();
    const result = await setup.configure('claude', { isolated: false, shareSkills: true });
    expect(result).toMatchObject({ homePath: '/engine-owned/home', isolated: false, shareSkills: true });
    expect(prepareHome).toHaveBeenLastCalledWith(snapshot.general.providerHomes?.claude, true);
    expect(applyHome).toHaveBeenLastCalledWith(snapshot.general.providerHomes?.claude);
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it.each(['codex', 'claude'] as const)('changes %s skills reuse without removing chats, but rejects running agents', async backend => {
    const snapshot = createTestSnapshot();
    const setup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), vi.fn());
    await mkdir(path.join(root, backend, 'skills'), { recursive: true });
    await writeFile(path.join(root, backend, 'skills/existing.md'), 'keep my skill');
    await setup.initialize();
    const agent: Agent = { ...createRemoteAgent(), id: 'local', teamId: 'team-test', backend, status: { type: 'working' } };
    snapshot.agents = [agent];
    snapshot.teams[0]!.agentIds = [agent.id];
    snapshot.teams[0]!.activeAgentId = agent.id;
    snapshot.activeAgentId = agent.id;
    const home = snapshot.general.providerHomes![backend]!;
    await writeFile(path.join(home.homePath, 'conversation.txt'), 'keep my chats');
    const choice = { isolated: true, shareSkills: false };
    await expect(setup.configure(backend, choice)).rejects.toThrow('idle');
    expect(await readFile(path.join(home.homePath, 'skills/existing.md'), 'utf8')).toBe('keep my skill');
    agent.status = { type: 'idle' };
    await setup.configure(backend, choice);
    expect((await loadBackendSnapshot()).agents).toHaveLength(1);
    expect(snapshot.agents).toEqual([agent]);
    expect(snapshot.teams[0]!.activeAgentId).toBe(agent.id);
    expect(snapshot.general.providerHomes![backend]).toEqual({ ...home, shareSkills: false });
    await expect(readlink(path.join(home.homePath, 'skills'))).rejects.toBeDefined();
    expect(await readFile(path.join(root, backend, 'skills/existing.md'), 'utf8')).toBe('keep my skill');
    expect(await readFile(path.join(home.homePath, 'conversation.txt'), 'utf8')).toBe('keep my chats');
    await setup.configure(backend, { isolated: true, shareSkills: true });
    expect(await readFile(path.join(home.homePath, 'skills/existing.md'), 'utf8')).toBe('keep my skill');
    expect(snapshot.agents).toEqual([agent]);
  });

  it.each(['codex', 'claude'] as const)('restores %s skills reuse if saving the change fails', async backend => {
    const snapshot = createTestSnapshot();
    let fail = false;
    const setup = new ProviderSetup(snapshot, async () => {
      if (fail) { fail = false; throw new Error('disk full'); }
      await saveBackendSnapshot(snapshot);
    }, vi.fn());
    await mkdir(path.join(root, backend, 'skills'), { recursive: true });
    await writeFile(path.join(root, backend, 'skills/existing.md'), 'keep my skill');
    await setup.initialize();
    const home = { ...snapshot.general.providerHomes![backend]! };
    fail = true;
    await expect(setup.configure(backend, { isolated: true, shareSkills: false })).rejects.toThrow('disk full');
    expect((await loadBackendSnapshot()).general.providerHomes![backend]).toEqual(home);
    expect(await readFile(path.join(home.homePath, 'skills/existing.md'), 'utf8')).toBe('keep my skill');
  });

  it('keeps Customize and Settings sharing consistent across a saved reload', async () => {
    const snapshot = createTestSnapshot();
    const setup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), vi.fn());
    await setup.initialize();
    await setup.configure('codex', { isolated: true, shareSkills: false });
    const reloaded = await loadBackendSnapshot();
    const restarted = new ProviderSetup(reloaded, vi.fn(), vi.fn());
    await restarted.initialize();
    const server = new AppBackendServer({ version: 'test', snapshot: reloaded, providerSetup: restarted, saveSnapshot: saveBackendSnapshot });
    try {
      expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'settings/codexResourceSharing/get' }))
        .toMatchObject({ result: { enabled: false, migrationRequired: false } });
      expect(restarted.list().find(home => home.backend === 'codex')?.shareSkills).toBe(false);
      expect(reloaded.general).not.toHaveProperty('shareCodexSkillsAndPlugins');
      await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'settings/codexResourceSharing/set', params: { input: { enabled: true } } });
      expect((await loadBackendSnapshot()).general.providerHomes?.codex?.shareSkills).toBe(true);
      expect(path.resolve(path.join(root, 'app/codex-home'), await readlink(path.join(root, 'app/codex-home/skills')))).toBe(path.join(root, 'codex/skills'));
    } finally { await server.close(); }
  });
  it('persists separate homes and shares skills without copying credentials; reload keeps the choices', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.providerEnabled = { codex: true, claude: false };
    await mkdir(path.join(root, 'claude/skills'), { recursive: true });
    await writeFile(path.join(root, 'claude/skills/example.md'), 'my skill');
    await writeFile(path.join(root, 'claude/auth.json'), 'private');
    const setup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), vi.fn());
    await setup.initialize();
    expect(await readFile(path.join(root, 'app/claude-home/skills/example.md'), 'utf8')).toBe('my skill');
    await expect(readFile(path.join(root, 'app/claude-home/auth.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const reloaded = await loadBackendSnapshot();
    expect(reloaded.general.providerEnabled).toEqual({ codex: true, claude: false });
    expect(reloaded.general.providerHomes).toStrictEqual({
      codex: { isolated: true, shareSkills: true, homePath: path.join(root, 'app/codex-home') },
      claude: { isolated: true, shareSkills: true, homePath: path.join(root, 'app/claude-home') },
      antigravity: { isolated: true, shareSkills: false, homePath: path.join(root, 'app/antigravity-home') },
    });
    await setup.configure('claude', { isolated: false, shareSkills: true });
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(path.join(root, 'claude'));
    expect((await loadBackendSnapshot()).general.providerHomes?.claude?.homePath).toBe(path.join(root, 'claude'));
    await setup.configure('claude', { isolated: true, shareSkills: false });
    await expect(readlink(path.join(root, 'app/claude-home/skills'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(root, 'claude/skills/example.md'), 'utf8')).toBe('my skill');
  });

  it('preserves an existing Claude setup and rejects changing a provider that owns chats', async () => {
    const snapshot = createTestSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.agents = [{ ...createRemoteAgent(), backend: 'claude' }];
    const reconnect = vi.fn();
    const setup = new ProviderSetup(snapshot, vi.fn(), reconnect);
    await setup.initialize();
    expect(setup.list().find(item => item.backend === 'claude')).toMatchObject({ isolated: false, homePath: path.join(root, 'claude'), locked: true });
    await expect(setup.configure('claude', { isolated: true, shareSkills: true })).rejects.toThrow('already has chats');
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('never replaces existing private skills', async () => {
    const privateSkills = path.join(root, 'app/claude-home/skills');
    await mkdir(privateSkills, { recursive: true });
    await writeFile(path.join(privateSkills, 'mine.md'), 'keep');
    const setup = new ProviderSetup(createTestSnapshot(), vi.fn(), vi.fn());
    await setup.initialize();
    expect(await readFile(path.join(privateSkills, 'mine.md'), 'utf8')).toBe('keep');
    expect(setup.list().find(item => item.backend === 'claude')?.shareSkills).toBe(false);
    await expect(setup.configure('claude', { isolated: true, shareSkills: true })).rejects.toThrow('private skills');
    expect(await readFile(path.join(privateSkills, 'mine.md'), 'utf8')).toBe('keep');
  });

  it('restores the persisted home when driver replacement fails and prevents overlapping setup', async () => {
    const snapshot = createTestSnapshot();
    let release!: () => void;
    const reconnect = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockRejectedValueOnce(new Error('driver failed')).mockResolvedValue(undefined);
    const setup = new ProviderSetup(snapshot, () => saveBackendSnapshot(snapshot), reconnect);
    await setup.initialize();
    const changing = setup.configure('claude', { isolated: false, shareSkills: true });
    await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
    const server = new AppBackendServer({ version: 'test', snapshot, providerSetup: setup });
    await expect(server.requireConnectedEngine('claude')).rejects.toThrow('Engine setup is changing');
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'provider/setup/get' })).toHaveProperty('result');
    expect(await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'settings/update', params: { input: { general: { theme: 'dark' } } } })).toMatchObject({ error: { message: 'Engine setup is changing. Try again when it finishes.' } });
    await expect(setup.configure('codex', { isolated: false, shareSkills: true })).rejects.toThrow('already in progress');
    await expect(setup.refresh('claude')).rejects.toThrow('already in progress');
    release();
    await changing;
    await server.close();
    await expect(setup.configure('claude', { isolated: true, shareSkills: false })).rejects.toThrow('driver failed');
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(path.join(root, 'claude'));
    expect((await loadBackendSnapshot()).general.providerHomes?.claude).toStrictEqual({ isolated: false, shareSkills: true, homePath: path.join(root, 'claude') });
  });

  it('refreshes external installation over RPC without installing providers that lack a managed installer', async () => {
    const snapshot = createTestSnapshot();
    cli.installed.add('codex');
    const setup = new ProviderSetup(snapshot, vi.fn(), vi.fn());
    await setup.initialize();
    const server = new AppBackendServer({ version: 'test', snapshot, providerSetup: setup });
    const request = (method: string, params?: unknown) => server.handleMessage({ jsonrpc: '2.0', id: 1, method, params });
    expect(await request('provider/setup/get')).toMatchObject({ result: [expect.objectContaining({ backend: 'codex', installed: true }), expect.objectContaining({ backend: 'claude', installed: false }), expect.objectContaining({ backend: 'antigravity', installed: false })] });
    expect(cli.installs).toBe(0);
    expect(await request('provider/refresh', { backend: 'claude' })).toMatchObject({ result: { backend: 'claude', installed: false } });
    cli.installed.add('claude');
    expect(await request('provider/refresh', { backend: 'claude' })).toMatchObject({ result: { backend: 'claude', installed: true } });
    expect(await request('provider/connections/get')).toMatchObject({ result: expect.arrayContaining([expect.objectContaining({ backend: 'claude', installed: true })]) });
    await expect(request('provider/install', { backend: 'claude' })).rejects.toThrow('official instructions');
    expect(cli.installs).toBe(0);
    await expect(request('provider/setup/configure', { backend: 'claude', choice: { isolated: 'yes' } })).rejects.toThrow('Invalid provider setup');
    await expect(request('settings/update', { input: { general: { providerHomes: { claude: { homePath: '/arbitrary' } } } } })).rejects.toThrow('provider setup');
  });
});
