import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectNarrativeState, ProjectOverview } from '@workspace/core/project-overview';
import { setElectronTestClient } from '../support/client';
import ProjectOverviewView from '../../src/components/ProjectOverviewView.vue';

const hour = 3_600_000;
const day = 24 * hour;
const start = new Date('2026-11-11T12:00:00Z');

const written: ProjectNarrativeState = {
  status: 'fresh',
  narrative: {
    lead: 'Cursor follow-up dominates while one large refactor waits.',
    workstreams: [
      { id: 'w1', name: 'Cursor engine', state: 'settling', analysis: 'Shipped, but fixes keep following.', basis: ['the 0.56 release', '32 cursor fixes in 30 days'] },
      { id: 'w2', name: 'SDK extraction', state: 'waiting', analysis: 'One branch gets harder to land every day.', basis: ['refactor/sdk-extraction'] },
    ],
    writtenBy: 'Claude Code',
    writtenAt: '2026-11-11T09:00:00.000Z',
  },
};

function overview(overrides: Partial<ProjectOverview> = {}): ProjectOverview {
  return {
    generatedAt: '2026-11-11T11:58:00.000Z',
    lookback: { days: 90, since: '2026-08-13T12:00:00.000Z' },
    repository: { name: 'korus', branch: 'feat/cursor-steering', baseBranch: 'main' },
    sources: { git: 'available', backlog: 'available', pullRequests: 'available', pipelines: 'available' },
    narrative: written,
    flow: {
      stations: [
        { kind: 'backlog', status: 'available', count: 47, note: 9, marks: [] },
        { kind: 'building', status: 'available', count: 2, note: 4, marks: [{ workstreamId: 'w1', units: 1 }, { workstreamId: null, units: 1 }] },
        { kind: 'review', status: 'available', count: 3, note: 3 * day, marks: [{ workstreamId: 'w1', units: 2 }, { workstreamId: 'w2', units: 1 }] },
        { kind: 'ci', status: 'available', count: 1, note: 1, marks: [{ workstreamId: null, units: 1 }] },
        { kind: 'shipped', status: 'available', count: 31, note: null, marks: [] },
      ],
      links: [{ to: 'building', tokens: ['w1'] }, { to: 'review', tokens: [] }, { to: 'ci', tokens: [null] }, { to: 'shipped', tokens: ['w1', null] }],
      constraint: { station: 'review', units: 3, oldestWaitMs: 3 * day, workstreamIds: ['w1', 'w2'] },
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

const station = (wrapper: ReturnType<typeof mount>, kind: string) => wrapper.get(`[data-station="${kind}"]`);
const mountView = (agentId = 'agent-1') => mount(ProjectOverviewView, { props: { agentId, activityKey: 'a' }, attachTo: document.body });

beforeEach(() => { vi.useFakeTimers({ now: start }); });
afterEach(() => { vi.useRealTimers(); });

describe('project overview page', () => {
  it('shows the written narrative above a flow of where the work is, with the constraint explained', async () => {
    const getProjectOverview = vi.fn(async () => overview());
    const refreshProjectNarrative = vi.fn();
    setElectronTestClient({ getProjectOverview, refreshProjectNarrative });
    const wrapper = mountView();
    expect(wrapper.get('[role="status"]').text()).toBe('Reading the project…');
    await flushPromises();

    expect(getProjectOverview).toHaveBeenCalledExactlyOnceWith('agent-1');
    expect(refreshProjectNarrative).not.toHaveBeenCalled();
    expect(wrapper.get('h1').text()).toBe('korus');
    expect(wrapper.get('.project-overview__live').text()).toBe('Live · updated 2m ago');

    const narrative = wrapper.get('[aria-label="Narrative"]');
    expect(narrative.get('.project-narrative__lead').text()).toBe('Cursor follow-up dominates while one large refactor waits.');
    expect(narrative.findAll('.project-narrative__workstream').map(item => item.text())).toStrictEqual([
      'Cursor engineSettlingShipped, but fixes keep following.From the 0.56 release, 32 cursor fixes in 30 days',
      'SDK extractionWaitingOne branch gets harder to land every day.From refactor/sdk-extraction',
    ]);
    expect(narrative.get('.project-narrative__provenance').text()).toBe('Covers the last 90 daysWritten by Claude Code from the code and its issues · 3h');
    // A workstream wears the same mark beside its name and on its work in the flow.
    expect(narrative.get('[data-workstream="w2"] .project-mark').classes()).toContain('project-mark--1');
    expect(station(wrapper, 'review').findAll('.project-mark--1')).toHaveLength(1);

    expect(wrapper.findAll('.project-flow__station').map(item => item.text())).toStrictEqual([
      'Backlog479 arrived this week',
      'Building24 agents working',
      'ConstraintReview3oldest waiting 3d',
      'CI11 failing',
      'Shipped31merged this week',
    ]);
    expect(station(wrapper, 'review').classes()).toContain('project-flow__station--constraint');
    expect(wrapper.findAll('.project-flow__legend li').map(item => item.text())).toStrictEqual(['Cursor engine', 'SDK extraction', 'Other work']);
    expect(wrapper.findAll('.project-flow__link').map(link => link.findAll('.project-flow__token').length)).toStrictEqual([1, 0, 1, 2]);
    expect(wrapper.get('.project-flow__sentence').text()).toBe('Review is the constraint: 3 changes are waiting, the oldest for 3d. Involved: Cursor engine, SDK extraction.');
    expect(wrapper.find('.project-flow__hint').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the flow at once and asks for the narrative to be written when there is none', async () => {
    const rewrite = deferred<ProjectOverview>();
    const refreshProjectNarrative = vi.fn(() => rewrite.promise);
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ narrative: { status: 'missing' } })), refreshProjectNarrative });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('[aria-label="Narrative"]').text()).toBe('Writing the narrative…');
    expect(station(wrapper, 'backlog').text()).toContain('47');
    expect(refreshProjectNarrative).toHaveBeenCalledExactlyOnceWith('agent-1');

    rewrite.resolve(overview());
    await flushPromises();
    expect(wrapper.get('.project-narrative__lead').text()).toBe('Cursor follow-up dominates while one large refactor waits.');
    wrapper.unmount();
  });

  it('keeps a stale narrative in place while it is rewritten, and keeps it when the rewrite fails', async () => {
    const rewrite = deferred<ProjectOverview>();
    const stale = { status: 'stale' as const, narrative: written.narrative };
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ narrative: stale })), refreshProjectNarrative: vi.fn(() => rewrite.promise) });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.project-narrative__lead').text()).toBe('Cursor follow-up dominates while one large refactor waits.');
    expect(wrapper.get('.project-narrative__updating').text()).toBe('updating');
    rewrite.reject(new Error('backend went away'));
    await flushPromises();
    expect(wrapper.get('.project-narrative__lead').text()).toBe('Cursor follow-up dominates while one large refactor waits.');
    expect(wrapper.find('.project-narrative__updating').exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([
    ['noEngine', 'No connected engine here can write the narrative.'],
    ['failed', 'The narrative could not be written. It will be tried again later.'],
    ['quiet', 'This repository has no history to write about yet.'],
  ] as const)('says why there is no narrative (%s) without asking for one', async (reason, message) => {
    const refreshProjectNarrative = vi.fn();
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ narrative: { status: 'unavailable', reason } })), refreshProjectNarrative });
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.get('[aria-label="Narrative"]').text()).toBe(message);
    expect(refreshProjectNarrative).not.toHaveBeenCalled();
    expect(wrapper.findAll('.project-flow__station')).toHaveLength(5);
    wrapper.unmount();
  });

  it('draws unconnected stations dashed and says the narrative comes from the repository alone', async () => {
    const base = overview();
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({
      sources: { git: 'available', backlog: 'notConnected', pullRequests: 'notConnected', pipelines: 'notConnected' },
      flow: {
        stations: base.flow.stations.map(entry => ['building', 'shipped'].includes(entry.kind) ? entry : { ...entry, status: 'notConnected' as const, count: null, note: null, marks: [] }),
        links: base.flow.links,
        constraint: null,
      },
    })), refreshProjectNarrative: vi.fn() });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.project-overview__live').text()).toBe('Live · updated 2m ago · repository only');
    expect(wrapper.get('.project-narrative__provenance').text()).toBe('Covers the last 90 daysWritten by Claude Code from the code alone · 3h');
    expect(station(wrapper, 'review').text()).toBe('Review–not connected');
    expect(station(wrapper, 'review').classes()).toContain('project-flow__station--absent');
    expect(station(wrapper, 'building').classes()).not.toContain('project-flow__station--absent');
    expect(wrapper.get('.project-flow__sentence').text()).toBe('Nothing is stuck.');
    expect(wrapper.get('.project-flow__hint').text()).toContain('Connect GitHub, GitLab or Linear in Settings');
    wrapper.unmount();
  });

  it('reports a project that cannot be read and a folder with no repository', async () => {
    setElectronTestClient({ getProjectOverview: vi.fn(async () => { throw new Error('Agent not found'); }), refreshProjectNarrative: vi.fn() });
    const failed = mountView();
    await flushPromises();
    expect(failed.get('[role="alert"]').text()).toBe('The project overview could not be read. It will be tried again shortly.');
    failed.unmount();

    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ sources: { git: 'unavailable', backlog: 'notConnected', pullRequests: 'notConnected', pipelines: 'notConnected' }, narrative: { status: 'unavailable', reason: 'quiet' } })), refreshProjectNarrative: vi.fn() });
    const plain = mountView();
    await flushPromises();
    expect(plain.get('.project-overview__state').text()).toBe('This folder has no Git repository to read.');
    expect(plain.find('.project-flow').exists()).toBe(false);
    plain.unmount();
  });
});

describe('project overview liveness', () => {
  it('refreshes once a minute and soon after activity while visible, never while hidden, and stops when closed', async () => {
    const getProjectOverview = vi.fn(async () => overview());
    setElectronTestClient({ getProjectOverview, refreshProjectNarrative: vi.fn() });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const wrapper = mountView();
    try {
      await flushPromises();
      expect(getProjectOverview).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(getProjectOverview).toHaveBeenCalledTimes(2);

      // Several status changes in quick succession are one refresh.
      await wrapper.setProps({ activityKey: 'b' });
      await vi.advanceTimersByTimeAsync(1_000);
      await wrapper.setProps({ activityKey: 'c' });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(getProjectOverview).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(getProjectOverview).toHaveBeenCalledTimes(3);

      hidden.mockReturnValue(true);
      await wrapper.setProps({ activityKey: 'd' });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(getProjectOverview).toHaveBeenCalledTimes(3);

      hidden.mockReturnValue(false);
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(getProjectOverview).toHaveBeenCalledTimes(3);
    } finally { hidden.mockRestore(); }
  });

  it('shows the repository asked for last when an earlier answer arrives late', async () => {
    const first = deferred<ProjectOverview>();
    const getProjectOverview = vi.fn((agentId: string) => agentId === 'agent-1' ? first.promise : Promise.resolve(overview({ repository: { name: 'other', branch: 'main', baseBranch: 'main' } })));
    setElectronTestClient({ getProjectOverview, refreshProjectNarrative: vi.fn() });
    const wrapper = mountView();
    await wrapper.setProps({ agentId: 'agent-2' });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('other');

    first.resolve(overview());
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('other');
    wrapper.unmount();
  });
});

it('says when the narrative covers the whole history because the project has been quiet', async () => {
  vi.useFakeTimers({ now: start });
  try {
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ lookback: { days: null, since: '2024-05-25T12:00:00.000Z' } })), refreshProjectNarrative: vi.fn() });
    const wrapper = mountView();
    await flushPromises();
    expect(wrapper.get('.project-narrative__period').text()).toBe(`Covers the whole history, since ${new Date('2024-05-25T12:00:00.000Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
    wrapper.unmount();
  } finally { vi.useRealTimers(); }
});
