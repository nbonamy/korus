import { describe, expect, it } from 'vitest';
import type { Agent, WorkItem } from '../contracts';
import { assignedAgentsByWorkItemKey, findAssignedAgentForWorkItem, isSameWorkItem, sanitizeWorkItemAssignmentSource, workBacklogAssignmentFromWorkItem, workItemAssignmentKey } from '../work-assignments';

describe('work assignments', () => {
  it('persists a provider-neutral item without a numeric issue or repository identity', () => {
    const item = { provider: 'linear' as const, id: 'opaque-task-id', sourceId: 'opaque-source-id', sourceName: 'Product', identifier: 'TASK-blue', title: 'Shared task', body: 'Details', url: 'https://example.test/task' };
    const reference = sanitizeWorkItemAssignmentSource(item);
    expect(reference).toEqual(item);
    expect(workBacklogAssignmentFromWorkItem(reference!, 'agent-dina', 'now')).toMatchObject({ item });
    expect(sanitizeWorkItemAssignmentSource({ ...item, provider: 'github' })).toEqual({ ...item, provider: 'github' });
  });
  it('retains a Linear issue reference in its assignment without colliding with equal issue numbers', () => {
    const item = { ...workItem(12), provider: 'linear' as const, id: 'linear:eng-uuid', identifier: 'ENG-12', sourceId: 'linear:team', sourceName: 'Engineering', body: 'Reproduction' };
    const source = sanitizeWorkItemAssignmentSource(item);
    expect(source).toMatchObject({ identifier: 'ENG-12', body: 'Reproduction', sourceId: item.sourceId });
    expect(workBacklogAssignmentFromWorkItem(source!, 'agent-dina', 'now')).toMatchObject({ item: source });
    expect(isSameWorkItem(item, { ...item, id: 'linear:ops-uuid' })).toBe(false);
  });
  it('uses provider-aware keys and finds the assigned agent', () => {
    const item = workItem(12);
    const assignment = workBacklogAssignmentFromWorkItem(item, 'agent-dina', '2026-06-09T13:00:00.000Z');
    const assignments = {
      [workItemAssignmentKey(item)]: assignment,
    };
    const agent = assignedAgent();

    expect(workItemAssignmentKey(item)).toBe('github:nbonamy/agent-workspace#12');
    expect(isSameWorkItem(assignment, item)).toBe(true);
    expect(findAssignedAgentForWorkItem([agent], assignments, item)).toBe(agent);
    expect(assignedAgentsByWorkItemKey([agent], assignments)).toStrictEqual({
      'github:nbonamy/agent-workspace#12': agent,
    });
  });

  it('treats assignments with missing agents as unassigned', () => {
    const item = workItem(12);
    const assignments = {
      [workItemAssignmentKey(item)]: workBacklogAssignmentFromWorkItem(item, 'missing-agent', '2026-06-09T13:00:00.000Z'),
    };

    expect(findAssignedAgentForWorkItem([assignedAgent()], assignments, item)).toBeNull();
    expect(assignedAgentsByWorkItemKey([assignedAgent()], assignments)).toStrictEqual({});
  });

  it('does not match different item ids', () => {
    expect(isSameWorkItem(workItem(12), workItem(13))).toBe(false);
  });

  it('sanitizes assignable work item payloads before they cross the main-process boundary', () => {
    expect(sanitizeWorkItemAssignmentSource(workItem(12))).toStrictEqual({
      provider: 'github',
      id: 'nbonamy/agent-workspace#12',
      sourceId: 'nbonamy/agent-workspace',
      sourceName: 'nbonamy/agent-workspace',
      number: 12,
      title: 'Fix cockpit drag target',
      url: 'https://github.com/nbonamy/agent-workspace/issues/12',
    });
    expect(sanitizeWorkItemAssignmentSource({
      ...workItem(12),
      number: '12',
    })).toBeNull();
    expect(sanitizeWorkItemAssignmentSource({
      ...workItem(12),
      provider: 'jira',
    })).toBeNull();
  });
});

function workItem(number: number): WorkItem {
  return {
    provider: 'github',
    id: `nbonamy/agent-workspace#${number}`,
    sourceId: 'nbonamy/agent-workspace',
    sourceName: 'nbonamy/agent-workspace',
    number,
    title: 'Fix cockpit drag target',
    url: `https://github.com/nbonamy/agent-workspace/issues/${number}`,
    state: 'open',
    labels: [],
    authorName: 'nbonamy',
    createdAt: '2026-06-09T12:00:00.000Z',
    updatedAt: '2026-06-09T12:30:00.000Z',
  };
}

function assignedAgent(): Agent {
  return {
    id: 'agent-dina',
    teamId: 'team-app',
    name: 'Dina',
    avatar: 'DI',
    folder: '~/src/agent-workspace',
    provider: 'codex',
    providerDefaults: { kind: 'codex' },
    status: { type: 'idle' },
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  };
}
