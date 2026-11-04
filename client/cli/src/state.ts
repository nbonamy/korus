import path from 'node:path';
import { backendMethods } from '@workspace/core/backend-protocol/methods';
import { CliError, readJson, record, string, type CliOptions } from './context';
import { request } from './rpc';

export type AgentInfo = { id: string; name: string; backend: string; folder?: string; teamId?: string; status: string };
export type MissionInfo = { id: string; outcome: string; stage: string; status: string; tickets: { id?: string; title: string; done: boolean; state?: string; workerId?: string; recoveryAttempts?: number }[] };
function agents(value: unknown): AgentInfo[] {
  if (!Array.isArray(value)) throw new CliError('Agent roster is unavailable.');
  return value.filter(record).filter(agent => typeof agent.id === 'string').map(agent => ({ id: agent.id as string,
    name: string(agent.name) ?? string(agent.folder)?.split(/[\\/]/u).at(-1) ?? agent.id as string,
    backend: string(agent.backend) ?? (record(agent.engine) ? string(agent.engine.kind) : undefined) ?? 'unknown',
    ...(typeof agent.folder === 'string' ? { folder: agent.folder } : {}), ...(typeof agent.teamId === 'string' ? { teamId: agent.teamId } : {}),
    status: record(agent.status) ? string(agent.status.type) ?? 'unknown' : 'unknown' }));
}
function missions(value: unknown): MissionInfo[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record).filter(mission => typeof mission.id === 'string').map(mission => {
    const tickets = record(mission.artifacts) && Array.isArray(mission.artifacts.tickets) ? mission.artifacts.tickets : [];
    const runs = record(mission.execution) && Array.isArray(mission.execution.runs) ? mission.execution.runs.filter(record) : [];
    return { id: mission.id as string, outcome: string(mission.outcome) ?? '', stage: string(mission.stage) ?? 'unknown', status: string(mission.status) ?? 'unknown',
      tickets: tickets.filter(record).map((ticket, index) => {
        const run = runs.slice().reverse().find(run => ticket.id ? run.ticketId === ticket.id : run.ticketIndex === index);
        return { ...(typeof ticket.id === 'string' ? { id: ticket.id } : {}), title: string(ticket.title) ?? '', done: ticket.done === true,
          ...(run ? { state: string(run.status), workerId: string(run.workerId), recoveryAttempts: typeof run.recoveryAttempts === 'number' ? run.recoveryAttempts : undefined } : {}) };
      }) };
  });
}
export async function loadState(options: CliOptions) {
  if (!options.offline) {
    try {
      const result = await request(options, backendMethods.snapshotGet);
      if (!record(result) || !record(result.snapshot)) throw new CliError('Daemon returned an invalid snapshot.');
      return { source: 'live' as const, agents: agents(result.snapshot.agents), missions: missions(result.snapshot.missions) };
    } catch { /* Saved metadata remains available when the daemon cannot be reached. */ }
  }
  const envelope = await readJson(path.join(options.home, 'roster.json'));
  if (!record(envelope.data)) throw new CliError('roster.json has an invalid envelope; no migration was attempted.');
  return { source: 'saved' as const, agents: agents(envelope.data.agents), missions: missions(envelope.data.missions) };
}
