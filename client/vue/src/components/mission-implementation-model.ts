import type { MissionTicket } from '@workspace/core/missions';
import type { MissionRun } from '@workspace/core/mission-execution';

export type MissionImplementationTicketItem = { ticket: MissionTicket; index: number; run?: MissionRun };
export type MissionImplementationTicketStatus = 'queued' | 'blocked' | MissionRun['status'];

export function implementationTicketStatus(
  item: MissionImplementationTicketItem,
  tickets: MissionTicket[],
): MissionImplementationTicketStatus {
  if (item.ticket.done) return 'accepted';
  if (item.run) return item.run.status;
  return (item.ticket.dependsOn ?? []).every(index => tickets[index]?.done) ? 'queued' : 'blocked';
}

export function missionTicketNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function missionRepositoryName(repositoryPath: string): string {
  return repositoryPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? repositoryPath;
}

export function missionTicketPreview(ticket: MissionTicket, fallback: string): string {
  return ticket.body
    ?.replace(/```[\s\S]*?```/gu, ' ')
    .replace(/[*_~`>|#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim() || fallback;
}
