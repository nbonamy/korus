import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import type { BackendPublishedEvent } from '@workspace/core/contracts';
import { createCodexSurface } from '@codex-app-sdk/backend';
import { appSurfaceOptions, BackendDriverRpc } from '../../driver-rpc';
import { CodexSurfaceAgentAdapter } from '../codex-surface-adapter';
import { CodexBackendDriver } from '../codex-driver';
import { AppMcpService } from '../../mcp/service';
import { WorktreeManager } from '../../worktrees/worktree-manager';

const exec = promisify(execFile);

// Opt-in: uses authenticated native Codex, real Git and the identity-scoped MCP
// endpoint. Normal suites stay offline; no transcript simulator proves a fork.
it.skipIf(process.env.KORUS_DELEGATION_LIVE !== '1')('delegates from a running native Codex turn into an isolated worker with retained context', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'korus-delegation-live-')));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'codex-home');
  const snapshot = createInitialSnapshot();
  const parent = snapshot.agents[0]!;
  parent.name = 'Live parent';
  parent.folder = repo;
  parent.backendSession = undefined;
  parent.backendDefaults = { kind: 'codex', model: process.env.KORUS_DELEGATION_MODEL ?? 'gpt-5.6-luna', reasoningEffort: 'low', approvalPreset: 'ask-for-approval' };
  snapshot.general.worktreeDelegationInstructions = 'Live saved direction: report the context marker, current folder and your own agent ID. Do not modify files or create further agents.';
  snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
  snapshot.general.providerHomes = { codex: { isolated: true, shareSkills: false, homePath: home } };
  let driver: CodexBackendDriver | undefined;
  const events: BackendPublishedEvent[] = [];
  const service = new AppMcpService({ snapshot, worktreeManager: new WorktreeManager({ getInitializationMode: () => 'off' }), onEvent: event => events.push(event as BackendPublishedEvent) });
  const originalShared = process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
  process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON = '0';
  try {
    await mkdir(repo); await mkdir(home, { mode: 0o700 });
    // Copy credentials without reading/logging them; remove the isolated home in finally.
    await copyFile(path.join(os.homedir(), '.korus', 'codex-home', 'auth.json'), path.join(home, 'auth.json'));
    await exec('git', ['init', '-b', 'main', repo]);
    await writeFile(path.join(repo, 'README.md'), 'Temporary live delegation fixture\n');
    await exec('git', ['-C', repo, 'add', 'README.md']);
    await exec('git', ['-C', repo, '-c', 'user.name=Korus smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'chore: seed live fixture']);
    const url = await service.start();
    const surface = createCodexSurface(appSurfaceOptions({ generalSettings: snapshot.general, appMcpServerUrl: url }));
    driver = new CodexBackendDriver(new CodexSurfaceAgentAdapter(surface));
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', driver]])));
    driver.onEvent(event => {
      events.push(event as BackendPublishedEvent);
      service.handleBackendEvent(event as BackendPublishedEvent);
      const agent = snapshot.agents.find(agent => agent.id === event.agentId);
      if (agent && providerConversationEventView(event as BackendPublishedEvent).type === 'turn.completed') agent.status = { type: 'idle' };
    });
    const marker = `marker-${path.basename(root)}`;
    const first = await driver.sendPrompt(parent, `Remember this design decision for our next assignment: the context marker is ${marker}. Reply with the marker only. Do not call tools.`);
    parent.backendSession = first.backendSession;
    await expect.poll(() => events.some(event => event.agentId === parent.id && providerConversationEventView(event).type === 'turn.completed' && providerConversationEventView(event).turnId === first.turnId), { timeout: 60000 }).toBe(true);
    const parentThread = first.backendSession;
    const arguments_ = { repoPath: repo, createWorktree: true, branchName: 'feat/live-worker', name: 'Live worker', prompt: 'Report the design context marker from the earlier conversation, your current directory and your agent ID. Run pwd once without specifying a directory override. Then finish_turn.', instructions: 'Live task direction: call set-status once to begin the context check, then finish_turn. No file changes or extra agents.' };
    await driver.sendPrompt(parent, `Use the Korus create-agent tool once with exactly these arguments: ${JSON.stringify(arguments_)}. A focused live delegation check is authorized. Keep this parent available; do not reconstruct the earlier design marker in the handoff. After startup acceptance, finish_turn.`);
    await expect.poll(() => snapshot.agents.some(agent => agent.name === 'Live worker'), { timeout: 60000 }).toBe(true);
    const worker = snapshot.agents.find(agent => agent.name === 'Live worker')!;
    await expect.poll(() => events.some(event => event.agentId === worker.id && providerConversationEventView(event).type === 'turn.completed'), { timeout: 60000 }).toBe(true);
    expect(worker.delegationContext).toStrictEqual({ requested: 'conversation', effective: 'conversation' });
    expect(worker.backendSession).toBeDefined();
    expect(worker.backendSession).not.toStrictEqual(parentThread);
    expect(worker.folder).not.toBe(repo);
    expect((await exec('git', ['-C', worker.folder!, 'rev-parse', '--show-toplevel'])).stdout.trim()).toBe(worker.folder);
    expect(parent.backendSession).toStrictEqual(parentThread);
    const childMessages = await driver.readConversationMessages({ backend: 'codex', threadId: worker.backendSession!.kind === 'codex' ? worker.backendSession!.threadId : '' }, worker.id);
    const childText = childMessages.filter(message => message.role === 'assistant' && !message.turnId?.includes(first.turnId ?? 'no-seed-turn')).flatMap(message => message.parts.filter(part => part.type === 'text').map(part => part.type === 'text' ? part.text : '')).join('\n');
    expect(childText).toContain(marker);
    expect(childText).toContain(worker.id);
    expect(childText).toContain(worker.folder!);
    expect(events.some(event => event.agentId === worker.id && event.type === 'agent.updated' && Boolean(event.payload.statusText))).toBe(true);
    // Read the provider-owned execution record; the historical app DTO omits
    // full output and exit codes. Its cwd is recorded by the native runtime.
    const nativeHistory = await surface.conversation(worker.backendSession!.kind === 'codex' ? worker.backendSession!.threadId : '').readHistory();
    expect(nativeHistory.messages.flatMap(message => message.parts)).toContainEqual(expect.objectContaining({
      type: 'tool', kind: 'command', status: 'completed',
      input: expect.objectContaining({ command: expect.stringContaining('pwd'), cwd: worker.folder }),
      output: expect.objectContaining({ exitCode: 0 }),
    }));
    expect(worker.statusText).toBeUndefined();
    expect(childMessages.flatMap(message => message.parts).some(part => part.type === 'tool' && part.status === 'completed' && part.title.includes('finish_turn'))).toBe(true);
    console.log(JSON.stringify({ nativeFork: true, parentIntact: true, distinctIdentity: true, isolatedWorktree: true, contextRecall: true, workerFinished: true }));
  } finally {
    for (const agent of snapshot.agents) {
      if (agent.backendSession && driver) {
        await driver.interrupt(agent).catch(() => undefined);
      }
    }
    await driver?.close();
    await service.stop();
    if (originalShared === undefined) delete process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
    else process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON = originalShared;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
