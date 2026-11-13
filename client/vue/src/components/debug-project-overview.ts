import type { ProjectFlowStation, ProjectOverview, ProjectOverviewOuterSource, ProjectOverviewSources } from '@workspace/core/project-overview';
import type { ProjectOverviewReads } from './use-project-overview';

const day = 86_400_000;
/** When each read lands, from the first request: the repository, then each tool, then the narrative. */
const lands = { git: 1_200, pullRequests: 2_400, pipelines: 3_600, backlog: 4_800, narrative: 8_000 } as const;
const outer: readonly ProjectOverviewOuterSource[] = ['backlog', 'pullRequests', 'pipelines'];
const waitsOn: Record<ProjectFlowStation['kind'], readonly ProjectOverviewOuterSource[]> = {
  backlog: ['backlog'], building: ['pullRequests'], review: ['pullRequests', 'pipelines'], ci: ['pullRequests', 'pipelines'], shipped: [],
};

function sample(name: string, now: number): ProjectOverview {
  return {
    generatedAt: new Date(now).toISOString(),
    lookback: { days: 90, since: new Date(now - 90 * day).toISOString() },
    toolLinks: {
      backlog: { label: 'GitLab issues', url: 'https://gitlab.com/example/project/-/issues', tool: 'gitlab' },
      building: { label: 'GitLab repository', url: 'https://gitlab.com/example/project', tool: 'gitlab' },
      ci: { label: 'GitLab CI', url: 'https://gitlab.com/example/project/-/pipelines', tool: 'gitlab' },
    },
    repository: { name, branch: 'main', baseBranch: 'main' },
    sources: { git: 'available', backlog: 'available', pullRequests: 'available', pipelines: 'available' },
    narrative: {
      status: 'fresh',
      narrative: {
        lead: `${name} is a sample project that shows how Flow loads, one tool at a time.`,
        workstreams: [
          { id: 'w1', name: 'Search engine', state: 'settling', analysis: 'Shipped in 0.4 and still settling as fixes follow on two branches.', basis: ['the 0.4 release'] },
          { id: 'w2', name: 'Export pipeline', state: 'waiting', analysis: 'One large branch rewrites the exporter and is waiting for review.', basis: ['feat/exporter'] },
        ],
        writtenBy: 'Claude Code',
        writtenAt: new Date(now).toISOString(),
      },
    },
    flow: {
      stations: [
        { kind: 'backlog', status: 'available', count: 23, note: 4, marks: [], stuck: [] },
        { kind: 'building', status: 'available', count: 2, note: 1, marks: [{ workstreamId: 'w1', units: 1 }, { workstreamId: null, units: 1 }], stuck: [] },
        { kind: 'review', status: 'available', count: 2, note: 3 * day, marks: [{ workstreamId: 'w2', units: 1 }, { workstreamId: 'w1', units: 1 }], stuck: [{ branch: 'feat/exporter', reason: 'overdue', target: null }] },
        { kind: 'ci', status: 'available', count: 1, note: 0, marks: [{ workstreamId: 'w1', units: 1 }], stuck: [] },
        { kind: 'shipped', status: 'available', count: 6, note: null, marks: [], stuck: [] },
      ],
      links: [{ to: 'building', tokens: ['w1'] }, { to: 'review', tokens: ['w2'] }, { to: 'ci', tokens: [] }, { to: 'shipped', tokens: ['w1'] }],
      constraint: null,
    },
  };
}

/** The sample as the daemon would answer at `elapsed` ms: sources not yet landed are loading, and so are the stations they place. */
function at(full: ProjectOverview, elapsed: number, narrativeWritten: boolean): ProjectOverview {
  const sources: ProjectOverviewSources = { ...full.sources };
  for (const source of outer) if (elapsed < lands[source]) sources[source] = 'loading';
  // Work is tied to workstreams only once a narrative names them, as the daemon does.
  const unnamed = (marks: ProjectFlowStation['marks']) => marks.length ? [{ workstreamId: null, units: marks.reduce((sum, mark) => sum + mark.units, 0) }] : [];
  return {
    ...full,
    sources,
    narrative: narrativeWritten ? full.narrative : { status: 'missing' },
    flow: {
      ...full.flow,
      links: narrativeWritten ? full.flow.links : full.flow.links.map(link => ({ ...link, tokens: link.tokens.map(() => null) })),
      stations: full.flow.stations.map(station => waitsOn[station.kind].some(source => sources[source] === 'loading')
        ? { ...station, status: 'loading', count: null, note: null, marks: [], stuck: [] }
        : narrativeWritten ? station : { ...station, marks: unnamed(station.marks) }),
    },
  };
}

/**
 * Scripted reads for the Flow loading preview, timed like a real first read so every state can be seen:
 * the repository, then reviews, pipelines and issues on their own, then the narrative. Nothing is read.
 */
export function debugProjectOverviewReads(name: string): ProjectOverviewReads {
  const full = sample(name, Date.now());
  let started: number | null = null;
  const elapsed = () => Date.now() - (started ??= Date.now());
  const until = (time: number) => new Promise<void>(resolve => { setTimeout(resolve, Math.max(0, time - elapsed())); });
  return {
    async getProjectOverview(_agentId, wait) {
      elapsed();
      const time = wait === undefined ? Math.max(...outer.map(source => lands[source])) : Math.max(lands.git, ...wait.map(source => lands[source]));
      await until(time);
      return at(full, elapsed(), elapsed() >= lands.narrative);
    },
    async refreshProjectNarrative() {
      await until(lands.narrative);
      return at(full, elapsed(), true);
    },
  };
}
