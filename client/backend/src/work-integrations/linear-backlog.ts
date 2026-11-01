import type { GlobalWorkItemQuery, WorkItem, WorkItemPage, WorkItemQuery, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Linear returned malformed data.');
  return value as RecordValue;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Linear returned malformed data.');
  return value;
}
async function request(token: WorkProviderToken, query: string, variables: RecordValue = {}): Promise<RecordValue> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Linear request failed (${response.status}). Check the connection and retry.`);
  const payload = record(await response.json());
  if (payload.errors) throw new Error('Linear could not load this backlog. Check access and retry.');
  return record(payload.data);
}
const pageFields = 'pageInfo { hasNextPage endCursor }';
async function collect(load: (after: string | null) => Promise<unknown>): Promise<RecordValue[]> {
  const result: RecordValue[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const page = record(await load(after));
    if (!Array.isArray(page.nodes)) throw new Error('Linear returned malformed results.');
    result.push(...page.nodes.map(record));
    const info = record(page.pageInfo);
    if (info.hasNextPage === false) return result;
    if (info.hasNextPage !== true) throw new Error('Linear returned malformed pagination.');
    after = string(info.endCursor);
    if (seen.has(after)) throw new Error('Linear returned a repeated pagination cursor. Retry the request.');
    seen.add(after);
  }
}

export async function linearSources(token: WorkProviderToken): Promise<WorkSource[]> {
  const teams = await collect(async after => (await request(token, `query($after: String) { teams(first: 100, after: $after) { nodes { id name key organization { urlKey } } ${pageFields} } }`, { after })).teams);
  const sources: WorkSource[] = [];
  for (const team of teams) {
    const teamId = string(team.id);
    const teamName = string(team.name);
    const source: WorkSource = {
      provider: 'linear', id: `linear:${teamId}`, name: teamName, fullName: teamName,
      owner: string(team.key), url: `https://linear.app/${encodeURIComponent(string(record(team.organization).urlKey))}/team/${encodeURIComponent(String(team.key))}/all`, isPrivate: true,

    };
    sources.push(source);
    const projects = await collect(async after => record((await request(token, `query($teamId: String!, $after: String) { team(id: $teamId) { projects(first: 100, after: $after) { nodes { id name url } ${pageFields} } } }`, { teamId, after })).team).projects);
    for (const project of projects) {
      const projectId = string(project.id);
      const projectName = string(project.name);
      sources.push({ ...source, id: `${source.id}:${projectId}`, name: `${teamName} / ${projectName}`, fullName: `${teamName} / ${projectName}`, url: string(project.url) });
    }
  }
  return sources;
}

const issueFields = `id identifier number title description url createdAt updatedAt
  state { name type } team { id name } project { id name }
  creator { name } assignee { id name } labels(first: 50) { nodes { name color } ${pageFields} }`;

async function issues(token: WorkProviderToken, sourceId: string | undefined, query: GlobalWorkItemQuery, assigned = false, paged = false): Promise<WorkItemPage> {
  if (query.kind === 'pullRequest') return { items: [] };
  const viewerId = string(record((await request(token, '{ viewer { id } }')).viewer).id);
  const filter: RecordValue = {};
  if (sourceId) {
    const parts = sourceId.split(':');
    if (parts[0] !== 'linear' || !parts[1] || parts.length > 3 || (parts.length === 3 && !parts[2])) throw new Error('Invalid Linear backlog source.');
    filter.team = { id: { eq: parts[1] } };
    if (parts[2]) filter.project = { id: { eq: parts[2] } };
    const accessible = await request(token, `query($teamId: String!${parts[2] ? ', $projectId: String!' : ''}) { team(id: $teamId) { id } ${parts[2] ? 'project(id: $projectId) { id }' : ''} }`, { teamId: parts[1], ...(parts[2] ? { projectId: parts[2] } : {}) });
    if (record(accessible.team).id !== parts[1] || (parts[2] && record(accessible.project).id !== parts[2])) throw new Error('Linear source is no longer accessible. Choose another source.');
  }
  if (assigned) filter.assignee = { id: { eq: viewerId } };
  if (query.state !== 'all') filter.state = { type: { [query.state === 'closed' ? 'in' : 'nin']: ['completed', 'canceled'] } };
  const load = async (after: string | null) => (await request(token, `query($after: String, $filter: IssueFilter, $first: Int!) { issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) { nodes { ${issueFields} } ${pageFields} } }`, { after, filter, first: Math.max(1, Math.min(100, Math.trunc(query.pageSize ?? 50))) })).issues;
  let nextCursor: string | undefined;
  let values: RecordValue[];
  if (paged) {
    const page = record(await load(query.cursor ?? null));
    if (!Array.isArray(page.nodes)) throw new Error('Linear returned malformed results.');
    values = page.nodes.map(record);
    const info = record(page.pageInfo);
    if (info.hasNextPage === true) {
      nextCursor = string(info.endCursor);
      if (nextCursor === query.cursor) throw new Error('Linear returned a repeated pagination cursor. Retry the request.');
    } else if (info.hasNextPage !== false) throw new Error('Linear returned malformed pagination.');
  } else values = await collect(load);
  const items = await Promise.all(values.map(async (value): Promise<WorkItem> => {
    const id = string(value.id);
    const team = record(value.team);
    const state = record(value.state);
    const assignee = value.assignee ? record(value.assignee) : null;
    const initialLabels = record(value.labels);
    const labels = await collect(async after => after === null ? initialLabels : record((await request(token, `query($id: String!, $after: String) { issue(id: $id) { labels(first: 100, after: $after) { nodes { name color } ${pageFields} } } }`, { id, after })).issue).labels);
    if (!Number.isInteger(value.number) || Number(value.number) < 1) throw new Error('Linear returned an invalid issue number.');
    const nativeType = string(state.type);
    if (!['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'].includes(nativeType)) throw new Error('Linear returned an unknown workflow state.');
    return {
      provider: 'linear', id: `linear:${id}`, kind: 'issue', identifier: string(value.identifier), number: Number(value.number),
      sourceId: sourceId ?? `linear:${string(team.id)}`, sourceName: string(team.name),

      title: string(value.title), body: value.description == null || value.description === '' ? '' : string(value.description), url: string(value.url),
      state: nativeType === 'completed' || nativeType === 'canceled' ? 'closed' : 'open', nativeState: string(state.name),
      ...(value.creator ? { authorName: string(record(value.creator).name) } : {}),
      assignees: assignee ? [string(assignee.name)] : [], assignedToViewer: assignee?.id === viewerId,
      labels: labels.map(label => ({ name: string(label.name), ...(label.color ? { color: string(label.color).replace(/^#/, '') } : {}) })),
      createdAt: string(value.createdAt), updatedAt: string(value.updatedAt),
    };
  }));
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

export async function linearItems(token: WorkProviderToken, sourceId: string, query: WorkItemQuery = {}): Promise<WorkItem[]> {
  return (await issues(token, sourceId, query)).items;
}
export async function linearGlobalItems(token: WorkProviderToken, query: GlobalWorkItemQuery = {}): Promise<WorkItemPage> {
  return issues(token, undefined, query, query.assignment === 'viewer', true);
}
export async function linearAssignedItems(token: WorkProviderToken): Promise<WorkItem[]> {
  return (await issues(token, undefined, {}, true)).items;
}
