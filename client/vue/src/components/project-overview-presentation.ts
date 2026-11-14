import type { ProjectFlow, ProjectNarrative } from '@workspace/core/project-overview';

/** Marks tell workstreams apart by shape as well as colour. A null workstream is other work. */
export function projectMarkClass(workstreamId: string | null, narrative: ProjectNarrative | null): string {
  const index = workstreamId === null ? -1 : narrative?.workstreams.findIndex(workstream => workstream.id === workstreamId) ?? -1;
  return index < 0 ? 'project-mark project-mark--other' : `project-mark project-mark--${index % 4}`;
}

/** A wait as people read it at a glance: "45m", "5h" or "3d". */
export function compactDuration(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** The workstreams that have work somewhere in the flow, and whether any work belongs to none. */
export function flowLegend(flow: ProjectFlow): { workstreamIds: string[]; other: boolean } {
  const ids = [...flow.stations.flatMap(station => station.marks.map(mark => mark.workstreamId)), ...flow.links.flatMap(link => link.tokens)];
  return { workstreamIds: [...new Set(ids.filter((id): id is string => id !== null))].sort(), other: ids.includes(null) };
}
