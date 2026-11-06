import type { MissionTicket } from '@workspace/core/missions';
import { implementationTicketStatus, type MissionImplementationTicketItem } from './mission-implementation-model';

export const missionTaskStatuses = ['next', 'active', 'review', 'blocked', 'done'] as const;
export type MissionTaskStatus = typeof missionTaskStatuses[number];
export function missionTaskStatus(item: MissionImplementationTicketItem, tickets: readonly MissionTicket[]): MissionTaskStatus {
  switch (implementationTicketStatus(item, tickets)) {
    case 'queued': return 'next';
    case 'preparing': case 'running': return 'active';
    case 'awaitingReview': return 'review';
    case 'accepted': return 'done';
    default: return 'blocked';
  }
}
export function matchesMissionTaskFilters(item: MissionImplementationTicketItem, tickets: readonly MissionTicket[], statuses: readonly MissionTaskStatus[]): boolean {
  return !statuses.length || statuses.includes(missionTaskStatus(item, tickets));
}
