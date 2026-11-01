import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deleteSession } from '@anthropic-ai/claude-agent-sdk';
import { expect, it } from 'vitest';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { conversationRefFromAgent } from '@workspace/core/conversation-ref';
import type { BackendPublishedEvent } from '@workspace/core/contracts';
import { BackendDriverRpc } from '../../driver-rpc';
import { AppMcpService } from '../../mcp/service';
import { WorktreeManager } from '../../worktrees/worktree-manager';
import { ClaudeBackendDriver } from '../claude-driver';
import { ClaudeAgentSdkTransport } from '../agent-sdk-transport';

const exec = promisify(execFile);

// Authenticated, provider-owned fork; opt-in because it launches the native CLI.
it.skipIf(process.env.KORUS_DELEGATION_LIVE !== '1')('delegates from a running Claude turn and restores the worker in its own worktree', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'korus-claude-delegation-live-')));
  const repo = path.join(root, 'repo');
  const snapshot = createInitialSnapshot();
  const parent = snapshot.agents[0]!;
  parent.name = 'Claude live parent'; parent.folder = repo; parent.backend = 'claude'; parent.backendSession = undefined;
  parent.backendDefaults = { kind: 'claude', model: 'haiku', permissionMode: 'default' };
  snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
  snapshot.general.worktreeDelegationInstructions = 'Report the inherited marker, your own agent ID and your current working directory. Do not change files.';
  const events: BackendPublishedEvent[] = [];
  const service = new AppMcpService({ snapshot, worktreeManager: new WorktreeManager({ getInitializationMode: () => 'off' }), onEvent: event => events.push(event as BackendPublishedEvent) });
  let driver: ClaudeBackendDriver | undefined;
  try {
    await mkdir(repo); await exec('git', ['init', '-b', 'main', repo]);
    await writeFile(path.join(repo, 'README.md'), 'Temporary native delegation fixture\n');
    await exec('git', ['-C', repo, 'add', 'README.md']);
    await exec('git', ['-C', repo, '-c', 'user.name=Korus smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-m', 'chore: seed native fixture']);
    const url = await service.start();
    driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport(), undefined, { appMcpServerUrl: url });
    service.setDriverRpc(new BackendDriverRpc(new Map([['claude', driver]])));
    driver.onEvent(event => {
      const published = event as BackendPublishedEvent;
      events.push(published); service.handleBackendEvent(published);
      const owner = snapshot.agents.find(agent => agent.id === event.agentId);
      if (owner && providerConversationEventView(published).type === 'turn.completed') owner.status = { type: 'idle' };
    });
    const marker = `context-${randomUUID()}`;
    const seed = await driver.sendPrompt(parent, `Remember the design marker ${marker}. Reply ACK only. No tools.`);
    parent.backendSession = seed.backendSession;
    await expect.poll(() => events.some(event => event.agentId === parent.id && providerConversationEventView(event).type === 'turn.completed' && providerConversationEventView(event).turnId === seed.turnId), { timeout: 60000 }).toBe(true);
    const sourceSession = structuredClone(parent.backendSession);
    const input = { repoPath: repo, createWorktree: true, startingContext: 'conversation', branchName: 'feat/claude-live-worker', name: 'Claude live worker', prompt: 'Report the earlier design marker, your current folder and your own worker agent ID. Run pwd once without specifying a directory override. Call finish_turn.', instructions: 'Call set-status once to begin the context check, then finish_turn. Do not change files or create agents.' };
    await driver.sendPrompt(parent, `A focused native delegation check is authorized. Call the Korus create-agent tool once with exactly these arguments: ${JSON.stringify(input)}. Do not reconstruct the earlier marker in the handoff. Keep this parent open; after startup acceptance finish_turn.`);
    await expect.poll(() => snapshot.agents.some(agent => agent.name === 'Claude live worker'), { timeout: 60000 }).toBe(true);
    const worker = snapshot.agents.find(agent => agent.name === 'Claude live worker')!;
    await expect.poll(() => events.some(event => event.agentId === worker.id && providerConversationEventView(event).type === 'turn.completed'), { timeout: 60000 }).toBe(true);
    expect(worker.delegationContext).toStrictEqual({ requested: 'conversation', effective: 'conversation' });
    expect(worker.backendSession).toBeDefined(); expect(worker.backendSession).not.toStrictEqual(sourceSession);
    expect(parent.backendSession).toStrictEqual(sourceSession);
    expect(worker.folder).not.toBe(repo);
    expect((await exec('git', ['-C', worker.folder!, 'rev-parse', '--show-toplevel'])).stdout.trim()).toBe(worker.folder);
    expect(events.some(event => event.agentId === worker.id && event.type === 'agent.updated' && Boolean(event.payload.statusText))).toBe(true);
    expect(worker.statusText).toBeUndefined();
    await driver.releaseConversation(worker.id);
    const messages = await driver.readConversationMessages(conversationRefFromAgent(worker)!, worker.id);
    const text = messages.filter(message => message.role === 'assistant').flatMap(message => message.parts.flatMap(part => part.type === 'text' ? [part.text] : [])).join('\n');
    expect(text).toContain(marker); expect(text).toContain(worker.id); expect(text).toContain(worker.folder!);
    expect(messages.flatMap(message => message.parts).some(part => part.type === 'tool' && part.status === 'completed' && JSON.stringify(part).includes('pwd') && JSON.stringify(part.output ?? part.body).includes(worker.folder!))).toBe(true);
    expect(messages.flatMap(message => message.parts).some(part => part.type === 'tool' && part.status === 'completed' && part.title.includes('finish_turn'))).toBe(true);
    console.log(JSON.stringify({ nativeFork: true, completedBoundary: true, retainedContext: true, workerIdentity: true, isolatedWorktree: true, coldHistory: true }));
  } finally {
    for (const agent of snapshot.agents) if (agent.backendSession && driver) await driver.interrupt(agent).catch(() => undefined);
    await driver?.close(); await service.stop();
    for (const agent of snapshot.agents) if (agent.backendSession?.kind === 'claude') {
      await deleteSession(agent.backendSession.sessionId, { dir: agent.folder! }).catch(() => undefined);
      if (agent.folder !== repo) await deleteSession(agent.backendSession.sessionId, { dir: repo }).catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
