import { closeAgentInSnapshot } from '@workspace/core/agent-manager';
import type { Agent, AppSnapshot } from '@workspace/core/contracts';
import { createMission, deleteMission, updateMission, type DeleteMissionInput, type Mission } from '@workspace/core/missions';
import { isMissionScreenshotAgent } from './mission-screenshot-fixture';

/** Serializes mission revisions and publishes them only after durable storage succeeds. */
export class MissionService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly snapshot: AppSnapshot, private readonly persist: (snapshot: AppSnapshot) => Promise<void>) {}

  mutate(action: 'create' | 'update', input: unknown): Promise<void> {
    return this.transaction(candidate => {
      if (action === 'create') createMission(candidate, input);
      else updateMission(candidate, input);
    });
  }

  change(id: string, mutate: (mission: Mission) => void): Promise<void> {
    return this.changeAsync(id, mission => { mutate(mission); });
  }

  changeAsync<T>(id: string, mutate: (mission: Mission) => T | Promise<T>): Promise<T> {
    return this.transaction(async candidate => {
      const mission = candidate.missions?.find(m => m.id === id);
      if (!mission) throw new Error('Mission not found.');
      const result = await mutate(mission);
      mission.revision++;
      mission.updatedAt = new Date().toISOString();
      return result;
    });
  }

  remove(input: DeleteMissionInput, cleanup: (mission: Mission, agents: Agent[]) => Promise<void>): Promise<void> {
    return this.transaction(async candidate => {
      const mission = deleteMission(candidate, input);
      const workerIds = new Set(mission.execution?.runs.flatMap(run => run.workerId ? [run.workerId] : []) ?? []);
      const retainedWorkerIds = new Set((candidate.missions ?? []).flatMap(other => (
        other.execution?.runs.flatMap(run => run.workerId ? [run.workerId] : []) ?? []
      )));
      const workers = candidate.agents.filter(agent => workerIds.has(agent.id) && !retainedWorkerIds.has(agent.id)
        && (!mission.execution?.debugFixture || isMissionScreenshotAgent(agent)));
      await cleanup(mission, workers);
      for (const worker of workers) closeAgentInSnapshot(candidate, worker.id);
    }, true);
  }

  private transaction<T>(mutate: (candidate: AppSnapshot) => T | Promise<T>, cloneSnapshot = false): Promise<T> {
    const operation = this.pending.then(async () => {
      const candidate = cloneSnapshot
        ? structuredClone(this.snapshot)
        : { ...this.snapshot, missions: structuredClone(this.snapshot.missions ?? []) };
      const result = await mutate(candidate);
      await this.persist(candidate);
      if (cloneSnapshot) Object.assign(this.snapshot, candidate);
      else this.snapshot.missions = candidate.missions;
      return result;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
