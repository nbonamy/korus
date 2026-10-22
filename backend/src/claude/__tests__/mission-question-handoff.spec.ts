import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createClaudeConversationReplica, type ClaudeConversationReplica } from '@workspace/core/claude-conversation-replica';
import type { AppBackendEvent } from '@workspace/core/backend-protocol/events';
import { MissionExecutionService } from '../../mission-execution-service';
import { MissionService } from '../../mission-service';
import { FileMissionArtifactStore } from '../../mission-artifact-store';
import { missionStageSkills } from '../../bundled-skills/catalog';
import { createMission } from '@workspace/core/missions';
import { applyMainEventToSnapshot } from '@workspace/core/snapshot';
import { BackendDriverRpc } from '../../driver-rpc';
import { ClaudeBackendDriver } from '../claude-driver';
import { ClaudeAgentSdkTransport } from '../agent-sdk-transport';
import { createQueryHarness } from './sdk-query-fixture';

vi.mock('@workspace/core/runtime-discovery', () => ({
  resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({ command, env: { ...process.env, ...env } }),
}));

// Mission approval must not release a provider turn that is still working or
// awaiting an answer. Existing Mission tests fake the driver, so cannot observe
// the resulting lost completion or dropped question. The Mission service,
// context refresh, Claude transport and replica are real; SDK output is scripted.
it.each(['idle', 'working', 'awaitingInput', 'cancelled'] as const)(
  'preserves the Mission handoff and question lifecycle (%s)',
  async scenario => {
    const approvalState = scenario === 'cancelled' ? 'working' : scenario;
    const root = await mkdtemp(path.join(tmpdir(), 'korus-mission-handoff-'));
    const snapshot = createInitialSnapshot();
    snapshot.general.claudeCodeEnabled = true;
    snapshot.providerConnections = [{ backend: 'claude', installed: true, connected: true, checking: false }];
    snapshot.agents[0]!.backend = 'claude';
    snapshot.agents[0]!.backendDefaults = { kind: 'claude', model: 'sonnet' };
    const sdk = createQueryHarness();
    const events: AppBackendEvent[] = [];
    let conversation: ClaudeConversationReplica | undefined;
    let service!: MissionExecutionService;
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }), undefined, {
      homeDir: root,
      appMcpServerUrl: 'http://mission.test/mcp',
      additionalDeveloperInstructions: agent => service.developerInstructionsForAgent(agent.id),
    });
    const artifactsStore = new FileMissionArtifactStore(async () => root);
    const rpc = new BackendDriverRpc(new Map([['claude', driver]]));
    service = new MissionExecutionService({
      snapshot, missions: new MissionService(snapshot, async () => {}), publish: async () => {},
      ensureMissionHome: async () => root,
      readArtifact: (id, stage) => artifactsStore.read(id, stage),
      writeArtifact: (id, stage, content) => artifactsStore.write(id, stage, content),
      validateRepository: async () => {}, refreshWorkspace: async () => {},
      createWorktree: async () => { throw new Error('No implementation worktree in this scenario'); },
      getHead: async () => { throw new Error('No Git work in this scenario'); },
      ensureStageSkills: async (_id, stage) => missionStageSkills(stage),
      refreshConversationContext: agent => rpc.refreshConversationContext(agent),
      continueStage: async (id, prompt) => {
        const agent = snapshot.agents.find(candidate => candidate.id === id)!;
        agent.backendSession = (await driver.sendPrompt(agent, prompt)).backendSession;
      },
      startRemediation: async () => { throw new Error('No review in this scenario'); },
      interrupt: agent => driver.interrupt(agent),
    });
    const completions: Promise<void>[] = [];
    driver.onEvent(event => {
      const fullEvent = { ...event, seq: events.length + 1, occurredAt: new Date().toISOString() };
      events.push(fullEvent);
      applyMainEventToSnapshot(snapshot, fullEvent);
      if (event.type === 'claude.conversationSnapshotChanged') conversation = createClaudeConversationReplica(event.payload.snapshot);
      if (event.type === 'claude.conversationEventReceived') {
        conversation?.apply(event.payload.event);
        if (event.payload.event.type === 'turn.completed' && event.agentId) completions.push(service.agentFinished(event.agentId, event.payload.event.turnId));
      }
    });
    const current = () => snapshot.missions![0]!;
    const sessionId = 'mission-handoff-session';
    const completeTurn = () => sdk.emit({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false });
    try {
      const mission = createMission(snapshot, {
        outcome: 'Configuration choices', workflowType: 'shapeAndShipFeature',
        teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id,
      });
      await service.execute({ action: 'run', id: mission.id, revision: mission.revision });
      await service.waitForLaunches();
      const requirementsRun = current().execution!.runs[0]!;
      const lead = snapshot.agents.find(agent => agent.id === requirementsRun.workerId)!;
      const sending = driver.sendPrompt(lead, 'Shape the requirements');
      await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
      sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
      lead.backendSession = (await sending).backendSession;
      await service.writeArtifact(lead.id, { stage: 'requirements', content: '# Requirements\nChoose configuration.' });
      const artifacts = structuredClone(current().artifacts);
      artifacts.requirements = { problem: 'Configuration choices', acceptance: 'The user can settle open choices' };
      await service.submit(lead.id, { summary: 'Ready for approval', artifacts });

      const questions = [{ header: 'Config', question: 'Which configuration should the tickets use?',
        options: [{ label: 'Local', description: 'Local configuration' }, { label: 'Shared', description: 'Shared configuration' }], multiSelect: false }];
      const ask = (requestId: string, queryIndex: number) => sdk.options[queryIndex]!.canUseTool!(
        'AskUserQuestion', { questions }, { signal: new AbortController().signal, toolUseID: `${requestId}-tool`, requestId },
      );
      const answer = async (requestId: string) => {
        await driver.respondToAgentRequest({
          agentId: lead.id, id: requestId, outcome: { kind: 'answered', answers: { [questions[0]!.question]: { answers: ['Local'] } } },
        });
      };
      const allowed = { behavior: 'allow', updatedInput: { questions, answers: { [questions[0]!.question]: 'Local' } } };
      const existingQuestion = approvalState === 'awaitingInput' ? ask('requirements-question', 0) : undefined;
      if (existingQuestion) await vi.waitFor(() => expect(lead.status.type).toBe('awaitingInput'));
      if (approvalState === 'idle') {
        completeTurn();
        await vi.waitFor(() => expect(lead.status.type).toBe('idle'));
      }

      await service.execute({
        id: current().id, revision: current().revision, action: 'accept', runId: requirementsRun.id,
      });
      await service.waitForLaunches();
      expect(current().stage).toBe('tickets');
      if (approvalState !== 'idle') {
        // Read the queued run after acceptance: approval does not
        // release the lead or submit the next stage while its old turn is live.
        expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'tickets', status: 'preparing', workerId: lead.id });
        expect(lead.status.type).toBe(approvalState);
        expect(sdk.inputs).toHaveLength(1);
        if (existingQuestion) {
          expect(conversation?.getSnapshot().answeredClientRequestIds).not.toContain('requirements-question');
          await answer('requirements-question');
          await expect(existingQuestion).resolves.toStrictEqual(allowed);
        }
        if (scenario === 'cancelled') {
          await service.execute({ action: 'cancel', id: current().id, revision: current().revision, runId: current().execution!.runs.at(-1)!.id });
          await Promise.all(completions);
          await service.waitForLaunches();
          expect(current().execution!.runs.at(-1)!.status).toBe('cancelled');
          expect(sdk.inputs).toHaveLength(1);
          expect(lead.status.type).toBe('idle');
          return;
        }
        completeTurn();
      }

      await vi.waitFor(() => expect(sdk.inputs).toHaveLength(2));
      expect(current().execution!.runs.at(-1)).toMatchObject({ stage: 'tickets', status: 'running', workerId: lead.id });
      expect(JSON.stringify(sdk.inputs[1]!.message.content)).toContain('Tickets stage');
      const ticketsQueryIndex = sdk.options.indexOf([...sdk.options].reverse().find(options => options.persistSession !== false)!);
      expect(sdk.options[ticketsQueryIndex]!.resume).toBe(sessionId);
      expect(sdk.options[ticketsQueryIndex]!.systemPrompt).toMatchObject({ append: expect.stringContaining('mission-to-tickets') });
      sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId }, ticketsQueryIndex);
      sdk.emit({ type: 'assistant', session_id: sessionId, message: { content: [
        { type: 'tool_use', id: 'tickets-question-tool', name: 'AskUserQuestion', input: { questions } },
      ] } }, ticketsQueryIndex);
      const question = ask('tickets-question', ticketsQueryIndex);
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'agentRequest.created', payload: { request: expect.objectContaining({ id: 'tickets-question', kind: 'question' }) } })));
      expect(lead.status.type).toBe('awaitingInput');
      expect(conversation?.getSnapshot()).toMatchObject({ busy: true, sessionId });
      expect(conversation?.getSnapshot().messages.some(message => message.parts.some(part => (
        part.type === 'tool' && part.metadata?.requestId === 'tickets-question'
      )))).toBe(true);
      await answer('tickets-question');
      await expect(question).resolves.toStrictEqual(allowed);
      sdk.emit({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false }, ticketsQueryIndex);
      await vi.waitFor(() => expect(lead.status.type).toBe('idle'));
      expect(conversation?.getSnapshot().answeredClientRequestIds).toContain('tickets-question');
      expect(conversation?.getSnapshot()).toMatchObject({ busy: false, activeTurnId: null });
    } finally {
      try {
        const evidenceDir = process.env.MISSION_HANDOFF_EVIDENCE_DIR;
        if (evidenceDir) {
          await mkdir(evidenceDir, { recursive: true });
          await writeFile(path.join(evidenceDir, `${scenario}.json`), JSON.stringify({
            mission: current(), events, conversation: conversation?.getSnapshot(),
            inputs: sdk.inputs, queries: sdk.options.map(options => ({ resume: options.resume, systemPrompt: options.systemPrompt })),
          }, null, 2));
        }
      } finally {
        try {
          await driver.close();
          await Promise.all(completions);
          await service.waitForLaunches();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  },
);
