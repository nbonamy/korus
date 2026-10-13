import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { createInitialSnapshot } from '@workspace/core/snapshot';
import { sendAgentPrompt } from '@workspace/core/agent-chat-service';
import type { BackendPublishedEvent } from '@workspace/core/contracts';
import { createCodexSurface } from '@codex-app-sdk/backend';
import { appSurfaceOptions, BackendDriverRpc } from '../../driver-rpc';
import { CodexSurfaceAgentAdapter } from '../codex-surface-adapter';
import { CodexBackendDriver } from '../codex-driver';
import { AppMcpService } from '../../mcp/service';
import { WorktreeManager } from '../../worktrees/worktree-manager';
import { DurableTaskService } from '../../agents/durable-task-service';
import { createTaskToolModuleProvider } from '../../mcp/task-tools';
import { AppStateStore } from '../../persistence/store';

const exec = promisify(execFile);

// Opt-in: uses authenticated native Codex, real Git and the identity-scoped MCP
// endpoint. Normal suites stay offline; no transcript simulator proves a fork.
it.skipIf(process.env.KORUS_DELEGATION_LIVE !== '1').each(['native-context', 'saved-handoff', 'saved-fork', 'user-override', 'durable-handoff', 'durable-fork'] as const)('delegates an isolated native Codex worker: %s', async scenario => {
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
  if (scenario !== 'native-context') snapshot.general.worktreeDelegationInstructions = 'Just say Hello\nDo not work on the request';
  if (scenario === 'user-override') parent.userDelegationOverrides = { startingContext: 'handoff', instructions: 'For this assignment, just say Bonjour instead of Hello. Do not work on the request.' };
  snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
  snapshot.general.providerHomes = { codex: { isolated: true, shareSkills: false, homePath: home } };
  let driver: CodexBackendDriver | undefined;
  const events: BackendPublishedEvent[] = [];
  const store = new AppStateStore(path.join(root, 'app-home'));
  const errors: unknown[] = [];
  const tasks = scenario.startsWith('durable-') ? new DurableTaskService({ tasks: [], save: value => store.saveTasks(value), agent: id => snapshot.agents.find(agent => agent.id === id),
    send: (agent, prompt) => new Promise((resolve, reject) => {
      sendAgentPrompt(snapshot, driver!, agent.id, prompt, undefined, event => events.push(event as BackendPublishedEvent), { onPromptStarted: receipt => resolve(receipt), onPromptFailed: error => reject(error) });
    }),
    interrupt: async (agent, turnId) => { await driver!.interrupt(agent, turnId); }, onError: error => errors.push(error),
  }) : undefined;
  const service = new AppMcpService({ snapshot, tasks, persistSnapshot: () => store.save(snapshot), toolModuleProviders: tasks ? [createTaskToolModuleProvider(tasks)] : [], worktreeManager: new WorktreeManager({ getInitializationMode: () => 'off' }), onEvent: event => events.push(event as BackendPublishedEvent) });
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
    const surface = createCodexSurface(appSurfaceOptions({ generalSettings: snapshot.general, appMcpServerUrl: url, additionalDeveloperInstructions: agent => tasks?.instructions(agent.id) }));
    driver = new CodexBackendDriver(new CodexSurfaceAgentAdapter(surface));
    service.setDriverRpc(new BackendDriverRpc(new Map([['codex', driver]])));
    driver.onEvent(event => {
      events.push(event as BackendPublishedEvent);
      service.handleBackendEvent(event as BackendPublishedEvent);
      const agent = snapshot.agents.find(agent => agent.id === event.agentId);
      if (agent && providerConversationEventView(event as BackendPublishedEvent).type === 'turn.completed') agent.status = { type: 'idle' };
      tasks?.handleEvent(event as BackendPublishedEvent);
    });
    const marker = `context-${randomUUID()}`;
    parent.status = { type: 'working' };
    const first = await driver.sendPrompt(parent, `Remember this design decision for our next assignment: the context marker is ${marker}. Reply with the marker only. Do not call tools.`);
    parent.backendSession = first.backendSession;
    await expect.poll(() => events.some(event => event.agentId === parent.id && providerConversationEventView(event).type === 'turn.completed' && providerConversationEventView(event).turnId === first.turnId), { timeout: 60000 }).toBe(true);
    const parentThread = first.backendSession;
    const arguments_ = { repoPath: repo, createWorktree: true, startingContext: scenario === 'saved-handoff' || scenario === 'durable-handoff' ? 'handoff' : 'conversation', branchName: 'feat/live-worker', name: 'Live worker',
      ...(tasks ? { requestId: 'live-readme-instructions', task: { title: 'Translate README into French', doneWhen: 'README prose is translated into French, preserving its technical content.' } } : {}),
      prompt: scenario === 'native-context' ? 'Report the design context marker from the earlier conversation, your current directory and your agent ID. Run pwd once without specifying a directory override. Then finish_turn.' : 'Translate the README into French.',
      instructions: scenario === 'native-context' ? 'Live task direction: call set-status once to begin the context check, then finish_turn. No file changes or extra agents.' : 'Translate README prose into natural French while preserving links, commands and technical identifiers. This task authorizes the documentation edit. Keep it scoped to the README and run the required checks.',
    };
    parent.status = { type: 'working' };
    await driver.sendPrompt(parent, `Use the Korus create-agent tool once with exactly these arguments: ${JSON.stringify(arguments_)}. A focused live delegation check is authorized. Keep this parent available; do not reconstruct the earlier design marker in the handoff. After startup acceptance, finish_turn.`);
    await expect.poll(() => snapshot.agents.some(agent => agent.name === 'Live worker'), { timeout: 60000 }).toBe(true);
    const worker = snapshot.agents.find(agent => agent.name === 'Live worker')!;
    await expect.poll(() => events.some(event => event.agentId === worker.id && providerConversationEventView(event).type === 'turn.completed'), { timeout: 60000 }).toBe(true);
    const context = scenario === 'saved-handoff' || scenario === 'durable-handoff' || scenario === 'user-override' ? 'handoff' : 'conversation';
    expect(worker.delegationContext).toStrictEqual({ requested: context, effective: context });
    expect(worker.backendSession).toBeDefined();
    expect(worker.backendSession).not.toStrictEqual(parentThread);
    expect(worker.folder).not.toBe(repo);
    expect((await exec('git', ['-C', worker.folder!, 'rev-parse', '--show-toplevel'])).stdout.trim()).toBe(worker.folder);
    expect(parent.backendSession).toStrictEqual(parentThread);
    const childMessages = await driver.readConversationMessages({ backend: 'codex', threadId: worker.backendSession!.kind === 'codex' ? worker.backendSession!.threadId : '' }, worker.id);
    if (scenario !== 'native-context') {
      expect(childMessages.filter(message => message.role === 'user').flatMap(message => message.parts).some(part => part.type === 'text' && part.text.replace(/<context>[\s\S]*?<\/context>\s*/gu, '').trim() === 'Translate the README into French.')).toBe(true);
      const lastAnswer = childMessages.filter(message => message.role === 'assistant').at(-1);
      const answer = lastAnswer?.parts.filter(part => part.type === 'text' && part.phase === 'final_answer').map(part => part.type === 'text' ? part.text : '').join('').trim();
      expect(answer).toMatch(scenario === 'user-override' ? /^Bonjour[.!]?$/ : /^Hello[.!]?$/);
      expect(await readFile(path.join(worker.folder!, 'README.md'), 'utf8')).toBe('Temporary live delegation fixture\n');
      const history = await surface.conversation(worker.backendSession!.kind === 'codex' ? worker.backendSession!.threadId : '').readHistory();
      expect(history.messages.flatMap(message => message.parts).filter(part => part.type === 'tool' && part.kind === 'command')).toStrictEqual([]);
      if (tasks) {
        await expect.poll(async () => {
          const task = (await store.loadTasks())[0];
          return { state: task?.state, submission: task?.submission?.summary, delivery: task?.delivery?.state };
        }, { timeout: 60000 }).toMatchObject({ state: 'completed', delivery: 'accepted' });
        const task = (await store.loadTasks())[0]!;
        expect(task.state).toBe('completed');
        expect(task.delegationUserInstructions).toStrictEqual({ saved: 'Just say Hello\nDo not work on the request' });
        expect(errors).toStrictEqual([]);
      }
      console.log(JSON.stringify({ scenario, userInstructionPriority: true, noAssignmentExecution: true }));
      return;
    }
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
    tasks?.close();
    await service.stop();
    if (originalShared === undefined) delete process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON;
    else process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON = originalShared;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
