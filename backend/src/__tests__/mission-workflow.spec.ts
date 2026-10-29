import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { createInitialSnapshot } from '@workspace/core/snapshot-construction';
import { createMission, type MissionArtifacts } from '@workspace/core/missions';
import type { MissionExecutionInput, MissionRun } from '@workspace/core/mission-execution';
import { MissionService } from '../mission-service';
import { MissionExecutionService } from '../mission-execution-service';
import { missionStageSkills, readBundledSkill } from '../bundled-skills/catalog';
import { createSourceWorktree, readWorktreeHead } from '../git-worktrees';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';
const exec = promisify(execFile);


it.each([
  { backend: 'codex', parallel: false },
  { backend: 'antigravity', parallel: false },
  { backend: 'codex', parallel: true },
] as const)('keeps $backend workers through the full Mission (parallel: $parallel)', async ({ backend, parallel }) => {
  const folder = await mkdtemp(join(tmpdir(), 'app-mission-workflow-'));
  const repo = join(folder, 'repo');
  await exec('git', ['init', repo]);
  const git = (cwd: string, args: string[]) => exec('git', args, { cwd });
  try {
    await git(repo, ['config', 'user.email', 'test@example.com']);
    await git(repo, ['config', 'user.name', 'Mission test']);
    await writeFile(join(repo, 'billing.txt'), 'original\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'initial']);
    const baseline = await readWorktreeHead(repo);
    const snapshot = createInitialSnapshot();
    snapshot.agents[0]!.folder = repo;
    snapshot.agents[0]!.backend = backend;
    snapshot.agents[0]!.backendDefaults = { kind: backend, model: 'selected-model' };
    const prompts: string[] = [];
    const mission = createMission(snapshot, { outcome: 'Team billing', workflowType: 'shapeAndShipFeature', teamId: snapshot.teams[0]!.id, orchestratorMemberId: snapshot.agents[0]!.id });
    let disk: unknown;
    const store = new MissionService(snapshot, async value => { disk = persistedStateFromSnapshot(value); });
    const artifactContents = new Map<string, string>();
    const service = new MissionExecutionService({ snapshot, missions: store, publish: async () => {}, ensureMissionHome: async () => folder,
      readArtifact: async (_missionId, stage) => artifactContents.get(stage) ?? '',
      writeArtifact: async (_missionId, stage, content) => { artifactContents.set(stage, content); return { size: content.length }; },
      validateRepository: async path => { await readWorktreeHead(path); }, refreshWorkspace: async () => {}, refreshConversationContext: async () => {},
      continueStage: async (id, prompt) => {
        const worker = snapshot.agents.find(agent => agent.id === id)!;
        expect(worker.backend).toBe(backend);
        expect(worker.backendDefaults).toEqual({ kind: backend, model: 'selected-model' });
        worker.backendSession = backend === 'codex' ? { kind: backend, threadId: id } : { kind: backend, sessionId: id };
        prompts.push(prompt);
      }, startRemediation: async () => {},
      createWorktree: createSourceWorktree, getHead: readWorktreeHead,
      ensureStageSkills: async (_missionId, stage) => missionStageSkills(stage),
      interrupt: async () => {},
    });
    const current = () => snapshot.missions![0]!;
    const command = (input: Omit<MissionExecutionInput, 'id' | 'revision'> | Record<string, unknown>) => service.execute({ ...input, id: mission.id, revision: current().revision } as MissionExecutionInput);
    await command({ action: 'attachRepository', repoPath: repo });
    const submit = async (artifacts: MissionArtifacts, run: MissionRun = current().execution!.runs.at(-1)!) => {
      if (run.stage !== 'tickets' && run.stage !== 'implementation') await service.writeArtifact(run.workerId!, { stage: run.stage, content: `# ${run.stage}\nMission artifact.` });
      const result = await service.submit(run.workerId!, { summary: `${run.stage} ready`, artifacts });
      if (run.stage === 'implementation') {
        expect(result.status).toBe('accepted');
        expect(current().execution!.runs.find(candidate => candidate.id === run.id)!.status).toBe('accepted');
        await service.agentFinished(run.workerId!);
      } else {
        expect(result.status).toBe('awaitingReview');
        expect(current().execution!.runs.find(candidate => candidate.id === run.id)!.status).toBe('awaitingReview');
        await command({ action: 'accept', runId: run.id, ...(run.stage === 'tickets' ? { parallelImplementation: parallel } : {}) });
      }
    };
    await command({ action: 'run' });
    for (const stage of ['requirements', 'tickets', 'implementation', 'review'] as const) {
      expect(current().stage).toBe(stage);
      const count = stage === 'implementation' ? (parallel ? 3 : 2) : 1;
      for (let attempt = 0; attempt < count; attempt++) {
        await service.waitForLaunches();
        const run = stage === 'implementation' && parallel
          ? current().execution!.runs.find(candidate => candidate.stage === 'implementation' && candidate.ticketIndex === [0, 2, 1][attempt])!
          : current().execution!.runs.at(-1)!;
        expect(run.status).toBe('running');
        expect(run.skills).toHaveLength(1);
        expect(run.skills[0]).not.toHaveProperty('path');
        expect(readBundledSkill(run.skills[0]!.name, { missionStage: stage }).markdown).toContain('---\nname:');
        const artifacts = structuredClone(current().artifacts);
        if (stage === 'requirements') {
          await service.agentFinished(run.workerId!); // Question/answer rounds remain part of the same stage.
          artifacts.requirements = { problem: 'Team billing', acceptance: 'An owner can buy seats' };
        } else if (stage === 'tickets') {
          const account = await service.upsertTicket(run.workerId!, { title: 'Billing account', body: 'Create the billing account.', repositoryPath: repo, reference: 'https://example.com/issues/1' });
          await service.upsertTicket(run.workerId!, { title: 'Owner checkout', body: 'Add owner checkout.', repositoryPath: repo, reference: 'https://example.com/issues/2', blockedByTicketIds: [account.ticketId] });
          if (parallel) await service.upsertTicket(run.workerId!, { title: 'Invoices', body: 'Add invoices.', repositoryPath: repo });
        } else if (stage === 'implementation') {
          expect(run.ticketIndex).toBe(parallel ? [0, 2, 1][attempt] : attempt);
          const workspace = current().execution!.workspaces![0]!.path;
          if (parallel && attempt === 0) {
            const active = current().execution!.runs.filter(candidate => candidate.stage === 'implementation');
            expect(active.map(candidate => candidate.ticketIndex)).toStrictEqual([0, 2]);
            expect(active.every(candidate => candidate.status === 'running')).toBe(true);
            expect(new Set(active.map(candidate => candidate.workerId)).size).toBe(2);
            expect(active.map(candidate => snapshot.agents.find(agent => agent.id === candidate.workerId)!.folder)).toStrictEqual([workspace, workspace]);
          }
          await writeFile(join(workspace, `ticket-${run.ticketIndex}.txt`), 'implemented\n');
          await git(workspace, ['add', `ticket-${run.ticketIndex}.txt`]);
          await git(workspace, ['commit', '-m', `feat: implement ticket ${run.ticketIndex}`]);
          artifacts.tickets[run.ticketIndex!]!.done = true;
          artifacts.implementation = { changes: `ticket-${run.ticketIndex}.txt`, tests: `verification ${run.ticketIndex} passed` };
        } else artifacts.review = { summary: 'Acceptance checked against the mission baseline and both commits.', pullRequestUrl: '' };
        await submit(artifacts, run);
      }
      if (stage === 'implementation') {
        expect(current().stage).toBe('implementation');
        expect(current().execution!.runs.filter(run => run.stage === 'review')).toHaveLength(0);
        await command({ action: 'continueToReview' });
      }
    }
    expect(current().stage).toBe('ship');
    expect(current().status).toBe('active');
    expect(current().execution!.deliveries).toEqual([expect.objectContaining({ repositoryPath: repo, status: 'pending' })]);
    await command({ action: 'recordDelivery', repositoryPath: repo, result: { kind: 'merge' } });
    expect(current().status).toBe('completed');
    expect(current().execution!.workspaces![0]!.baseSha).toBe(baseline);
    expect(current().execution!.runs[0]!.workerId).toBe(current().execution!.runs[1]!.workerId);
    if (parallel) expect(new Set(current().execution!.runs.filter(run => run.stage === 'implementation').map(run => run.workerId)).size).toBe(3);
    else expect(current().execution!.runs[2]!.workerId).toBe(current().execution!.runs[3]!.workerId);
    expect(current().execution!.runs[2]!.workerId).not.toBe(current().execution!.runs[1]!.workerId);
    expect(current().execution!.runs.at(-1)!.workerId).toBe(current().execution!.runs[1]!.workerId);
    expect(new Set(current().execution!.runs.map(run => run.workerId)).size).toBe(parallel ? 4 : 2);
    expect(await readWorktreeHead(repo)).toBe(baseline);
    expect(await readFile(join(repo, 'billing.txt'), 'utf8')).toBe('original\n');
    expect((await git(repo, ['status', '--porcelain'])).stdout).toBe('');
    const restored = snapshotFromPersistedState(disk);
    expect(restored.missions).toEqual(snapshot.missions);
    expect(restored.missions![0]!.execution!.parallelImplementation).toBe(parallel);
    expect(restored.missions![0]!.artifacts.tickets[1]!.reference).toBe('https://example.com/issues/2');
    expect(restored.missions![0]!.execution!.runs.every(run => run.status === 'accepted')).toBe(true);
    expect(prompts.includes('/compact')).toBe(false);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
