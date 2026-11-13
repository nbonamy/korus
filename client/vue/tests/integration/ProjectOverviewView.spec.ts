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
    lead: 'Korus is a desktop app for coordinating teams of coding agents.',
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
    toolLinks: {
      backlog: { label: 'GitLab issues', url: 'https://gitlab.com/acme/api/-/issues', tool: 'gitlab' },
      ci: { label: 'GitLab CI', url: 'https://gitlab.com/acme/api/-/pipelines', tool: 'gitlab' },
    },
    repository: { name: 'korus', branch: 'feat/cursor-steering', baseBranch: 'main' },
    sources: { git: 'available', backlog: 'available', pullRequests: 'available', pipelines: 'available' },
    narrative: written,
    flow: {
      stations: [
        { kind: 'backlog', status: 'available', count: 47, note: 9, marks: [], stuck: [] },
        { kind: 'building', status: 'available', count: 2, note: 4, marks: [{ workstreamId: 'w1', units: 1 }, { workstreamId: null, units: 1 }], stuck: [] },
        {
          kind: 'review', status: 'available', count: 3, note: 3 * day, marks: [{ workstreamId: 'w1', units: 2 }, { workstreamId: 'w2', units: 1 }],
          stuck: [
            { branch: 'fix/cursor-resume', reason: 'overdue', target: { kind: 'url', url: 'https://gitlab.com/acme/api/-/merge_requests/7' } },
            { branch: 'feat/asks', reason: 'needsInput', target: { kind: 'agent', agentId: 'agent-7' } },
          ],
        },
        { kind: 'ci', status: 'available', count: 1, note: 1, marks: [{ workstreamId: null, units: 1 }], stuck: [{ branch: 'feat/ready', reason: 'failing', target: { kind: 'url', url: 'https://gitlab.com/acme/api/-/merge_requests/9' } }] },
        { kind: 'shipped', status: 'available', count: 31, note: null, marks: [], stuck: [] },
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

const progress = (root: { findAll: ReturnType<typeof mount>['findAll'] }) => root.findAll('.project-progress__step').map(step => [step.attributes('data-state'), step.text()]);
const station = (wrapper: ReturnType<typeof mount>, kind: string) => wrapper.get(`[data-station="${kind}"]`);
const mountView = (agentId = 'agent-1') => mount(ProjectOverviewView, { props: { agentId, activityKey: 'a' }, attachTo: document.body });

beforeEach(() => { vi.useFakeTimers({ now: start }); });
afterEach(() => { vi.useRealTimers(); });

describe('project overview page', () => {
  it('shows the written narrative above a flow of where the work is', async () => {
    const getProjectOverview = vi.fn(async () => overview());
    const refreshProjectNarrative = vi.fn();
    setElectronTestClient({ getProjectOverview, refreshProjectNarrative });
    const wrapper = mountView();
    // While the project is read, the page says what is being read and connected, all at once.
    expect(wrapper.get('[aria-label="Flow"]').attributes('aria-busy')).toBe('true');
    expect(progress(wrapper)).toStrictEqual([
      ['active', 'Reading the git history'],
      ['pending', 'Connecting to issues, reviews and CI'],
      ['pending', 'Mapping where the work is'],
      ['pending', 'Writing the narrative'],
    ]);
    expect(wrapper.find('.project-progress__conveyor').exists()).toBe(true);
    await flushPromises();
    expect(wrapper.get('[aria-label="Flow"]').attributes('aria-busy')).toBe('false');
    expect(wrapper.find('.project-progress').exists()).toBe(false);
    expect(wrapper.find('.project-flow__station--loading').exists()).toBe(false);

    // The repository answered with every source, so there is nothing more to wait for.
    expect(getProjectOverview).toHaveBeenCalledExactlyOnceWith('agent-1', []);
    expect(refreshProjectNarrative).not.toHaveBeenCalled();
    expect(wrapper.get('h1').text()).toBe('korus');
    expect(wrapper.get('.project-overview__live').text()).toBe('Live · updated 2m ago');

    const narrative = wrapper.get('[aria-label="Narrative"]');
    expect(narrative.get('.project-narrative__lead').text()).toBe('Korus is a desktop app for coordinating teams of coding agents.');
    // The title opens with the project's name in bold, spelled as the narrative wrote it.
    expect(narrative.get('.project-narrative__lead strong').text()).toBe('Korus');
    expect(narrative.findAll('.project-narrative__workstream').map(item => item.text())).toStrictEqual([
      'Cursor engineSettlingShipped, but fixes keep following.From the 0.56 release, 32 cursor fixes in 30 days',
      'SDK extractionWaitingOne branch gets harder to land every day.From refactor/sdk-extraction',
    ]);
    expect(narrative.get('.project-narrative__provenance').text()).toBe('Covers the last 90 daysWritten by Claude Code from the code and its issues · 3h');
    // A workstream wears the same mark beside its name and on its work in the flow.
    expect(narrative.get('[data-workstream="w2"] .project-mark').classes()).toContain('project-mark--1');
    expect(station(wrapper, 'review').findAll('.project-mark--1')).toHaveLength(1);

    expect(wrapper.findAll('.project-flow__station').map(item => item.text())).toStrictEqual(['Backlog47', 'Building2', 'Review3', 'CI1', 'Shipped31']);
    expect(wrapper.findAll('.project-flow__note').map(item => item.text())).toStrictEqual(['9 arrived this week', '4 agents working', 'oldest waiting 3d', '1 failing', 'merged this week']);
    // Stuck work is an icon on its station, never a sentence.
    expect(wrapper.text()).not.toContain('constraint');
    expect(wrapper.text()).not.toContain('Nothing is stuck');
    expect(wrapper.findAll('.project-flow__station--stuck').map(item => item.attributes('data-station'))).toStrictEqual(['review', 'ci']);
    expect(wrapper.findAll('.project-flow__legend li').map(item => item.text())).toStrictEqual(['Cursor engine', 'SDK extraction', 'Other work']);
    expect(wrapper.findAll('.project-flow__link').map(link => link.findAll('.project-flow__token').length)).toStrictEqual([1, 0, 1, 2]);
    // Stations link to the tool behind them, opened outside the app; a station with no tool has no link.
    const issues = station(wrapper, 'backlog').get('a.project-flow__tool');
    expect(issues.attributes()).toMatchObject({ href: 'https://gitlab.com/acme/api/-/issues', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open GitLab issues' });
    expect(station(wrapper, 'ci').get('a.project-flow__tool').attributes('href')).toBe('https://gitlab.com/acme/api/-/pipelines');
    expect(station(wrapper, 'review').find('a.project-flow__tool').exists()).toBe(false);
    expect(wrapper.find('.project-flow__hint').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the flow at once and asks for the narrative to be written when there is none', async () => {
    const rewrite = deferred<ProjectOverview>();
    const refreshProjectNarrative = vi.fn(() => rewrite.promise);
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ narrative: { status: 'missing' } })), refreshProjectNarrative });
    const wrapper = mountView();
    await flushPromises();

    // What was read is ticked off with what it found; the narrative is the one step still running.
    expect(progress(wrapper.get('[aria-label="Narrative"]'))).toStrictEqual([
      ['done', 'Read the last 90 days of history'],
      ['done', 'Connected to issues, reviews and CI'],
      ['done', 'Mapped where the work is'],
      ['active', 'Writing the narrative'],
    ]);
    expect(station(wrapper, 'backlog').text()).toContain('47');
    expect(refreshProjectNarrative).toHaveBeenCalledExactlyOnceWith('agent-1');

    rewrite.resolve(overview());
    await flushPromises();
    expect(wrapper.get('.project-narrative__lead').text()).toBe('Korus is a desktop app for coordinating teams of coding agents.');
    wrapper.unmount();
  });

  it('keeps a stale narrative in place while it is rewritten, and keeps it when the rewrite fails', async () => {
    const rewrite = deferred<ProjectOverview>();
    const stale = { status: 'stale' as const, narrative: written.narrative };
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ narrative: stale })), refreshProjectNarrative: vi.fn(() => rewrite.promise) });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.project-narrative__lead').text()).toBe('Korus is a desktop app for coordinating teams of coding agents.');
    expect(wrapper.get('.project-narrative__updating').text()).toBe('updating');
    rewrite.reject(new Error('backend went away'));
    await flushPromises();
    expect(wrapper.get('.project-narrative__lead').text()).toBe('Korus is a desktop app for coordinating teams of coding agents.');
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

  it('loads each station on its own as its tool answers, ends a tool that never answers on its own stations, and never reloads on refresh', async () => {
    const base = overview();
    const waitsOn = { backlog: ['backlog'], building: ['pullRequests'], review: ['pullRequests', 'pipelines'], ci: ['pullRequests', 'pipelines'], shipped: [] } as const;
    const partial = (sources: ProjectOverview['sources']) => overview({
      sources,
      narrative: { status: 'missing' },
      flow: { ...base.flow, constraint: null, stations: base.flow.stations.map(entry => waitsOn[entry.kind].some(source => sources[source] === 'loading') ? { ...entry, status: 'loading' as const, count: null, note: null, marks: [], stuck: [] } : entry) },
    });
    const repository = deferred<ProjectOverview>();
    const answers = { backlog: deferred<ProjectOverview>(), pullRequests: deferred<ProjectOverview>(), pipelines: deferred<ProjectOverview>() };
    const refresh = deferred<ProjectOverview>();
    const getProjectOverview = vi.fn((_agentId: string, wait?: (keyof typeof answers)[]) => wait === undefined ? refresh.promise : wait.length === 0 ? repository.promise : answers[wait[0]!].promise);
    const refreshProjectNarrative = vi.fn(() => new Promise<ProjectOverview>(() => {}));
    setElectronTestClient({ getProjectOverview, refreshProjectNarrative });
    const wrapper = mountView();
    const notes = () => wrapper.findAll('.project-flow__note').map(item => item.text());
    const loading = () => wrapper.findAll('.project-flow__station--loading').map(item => item.attributes('data-station'));

    // Before anything answers, the whole flow is drawn and says the repository is being read.
    expect(loading()).toStrictEqual(['backlog', 'building', 'review', 'ci', 'shipped']);
    expect(notes()).toStrictEqual(Array(5).fill('Reading git history…'));

    repository.resolve(partial({ git: 'available', backlog: 'loading', pullRequests: 'loading', pipelines: 'loading' }));
    await flushPromises();
    expect(getProjectOverview.mock.calls).toStrictEqual([['agent-1', []], ['agent-1', ['backlog']], ['agent-1', ['pullRequests']], ['agent-1', ['pipelines']]]);
    expect(loading()).toStrictEqual(['backlog', 'building', 'review', 'ci']);
    expect(notes()).toStrictEqual(['Asking GitLab for issues…', 'Asking GitLab for reviews…', 'Asking GitLab for reviews…', 'Asking GitLab for reviews…', 'merged this week']);
    expect(progress(wrapper).map(([state]) => state)).toStrictEqual(['done', 'active', 'active', 'pending']);

    // Reviews land first: Building is placed; Review and CI now wait on pipelines alone.
    answers.pullRequests.resolve(partial({ git: 'available', backlog: 'loading', pullRequests: 'available', pipelines: 'loading' }));
    await flushPromises();
    expect(loading()).toStrictEqual(['backlog', 'review', 'ci']);
    expect(notes()).toStrictEqual(['Asking GitLab for issues…', '4 agents working', 'Asking GitLab for pipelines…', 'Asking GitLab for pipelines…', 'merged this week']);

    // Issues never answer: only Backlog gives up.
    answers.backlog.reject(new Error('request timed out'));
    await flushPromises();
    expect(loading()).toStrictEqual(['review', 'ci']);
    expect(station(wrapper, 'backlog').text()).toBe('Backlog–');
    expect(notes()[0]).toBe('unavailable');

    // Pipelines land after; the daemon had not heard from issues yet, which does not bring Backlog back to loading.
    answers.pipelines.resolve(partial({ git: 'available', backlog: 'loading', pullRequests: 'available', pipelines: 'available' }));
    await flushPromises();
    expect(loading()).toStrictEqual([]);
    expect(notes()).toStrictEqual(['unavailable', '4 agents working', 'oldest waiting 3d', '1 failing', 'merged this week']);
    expect(progress(wrapper)).toStrictEqual([
      ['done', 'Read the last 90 days of history'],
      ['done', 'Connected to reviews and CI'],
      ['done', 'Mapped where the work is'],
      ['active', 'Writing the narrative'],
    ]);
    // The narrative is asked for only once every source has answered or given up.
    expect(refreshProjectNarrative).toHaveBeenCalledExactlyOnceWith('agent-1');

    // A refresh reads everything at once and keeps what is shown until it answers: no station goes back to loading.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getProjectOverview).toHaveBeenLastCalledWith('agent-1');
    expect(loading()).toStrictEqual([]);
    refresh.resolve(overview());
    await flushPromises();
    expect(notes()[0]).toBe('9 arrived this week');
    wrapper.unmount();
  });

  it('names only the sources it reached while the narrative is written, and the whole history when it read all of it', async () => {
    setElectronTestClient({
      getProjectOverview: vi.fn(async () => overview({
        lookback: { days: null, since: '2024-05-25T12:00:00.000Z' },
        sources: { git: 'available', backlog: 'available', pullRequests: 'notConnected', pipelines: 'failed' },
        narrative: { status: 'missing' },
      })),
      refreshProjectNarrative: vi.fn(() => new Promise<ProjectOverview>(() => {})),
    });
    const partial = mountView();
    await flushPromises();
    expect(progress(partial).map(([, text]) => text).slice(0, 2)).toStrictEqual(['Read the whole history', 'Connected to issues']);
    partial.unmount();

    setElectronTestClient({
      getProjectOverview: vi.fn(async () => overview({ sources: { git: 'available', backlog: 'notConnected', pullRequests: 'notConnected', pipelines: 'notConnected' }, narrative: { status: 'missing' } })),
      refreshProjectNarrative: vi.fn(() => new Promise<ProjectOverview>(() => {})),
    });
    const alone = mountView();
    await flushPromises();
    expect(progress(alone)[1]).toStrictEqual(['done', 'Repository only: no issues, reviews or CI connected']);
    alone.unmount();
  });

  it('draws unconnected stations dashed and says the narrative comes from the repository alone', async () => {
    const base = overview();
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({
      sources: { git: 'available', backlog: 'notConnected', pullRequests: 'notConnected', pipelines: 'notConnected' },
      flow: {
        stations: base.flow.stations.map(entry => ['building', 'shipped'].includes(entry.kind) ? entry : { ...entry, status: 'notConnected' as const, count: null, note: null, marks: [], stuck: [] }),
        links: base.flow.links,
        constraint: null,
      },
    })), refreshProjectNarrative: vi.fn() });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.get('.project-overview__live').text()).toBe('Live · updated 2m ago · repository only');
    expect(wrapper.get('.project-narrative__provenance').text()).toBe('Covers the last 90 daysWritten by Claude Code from the code alone · 3h');
    expect(station(wrapper, 'review').text()).toBe('Review–');
    expect(wrapper.findAll('.project-flow__note')[2]!.text()).toBe('not connected');
    expect(station(wrapper, 'review').classes()).toContain('project-flow__station--absent');
    expect(station(wrapper, 'building').classes()).not.toContain('project-flow__station--absent');
    expect(wrapper.find('.project-flow__stuck').exists()).toBe(false);
    expect(wrapper.get('.project-flow__hint').text()).toContain('Connect GitHub, GitLab or Linear in Settings');
    wrapper.unmount();
  });

  it('reports a project that cannot be read and a folder with no repository', async () => {
    setElectronTestClient({ getProjectOverview: vi.fn(async () => { throw new Error('Agent not found'); }), refreshProjectNarrative: vi.fn() });
    const failed = mountView();
    await flushPromises();
    expect(failed.get('[role="alert"]').text()).toBe('The flow could not be read. It will be tried again shortly.');
    failed.unmount();

    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ sources: { git: 'unavailable', backlog: 'notConnected', pullRequests: 'notConnected', pipelines: 'notConnected' }, narrative: { status: 'unavailable', reason: 'quiet' } })), refreshProjectNarrative: vi.fn() });
    const plain = mountView();
    await flushPromises();
    expect(plain.get('.project-overview__state').text()).toBe('This folder has no Git repository to read.');
    expect(plain.find('.project-flow').exists()).toBe(false);
    plain.unmount();
  });
});

describe('stuck work in the flow', () => {
  it('goes straight to a single stuck request, and lists several to choose from, opening an agent thread in the app', async () => {
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview()), refreshProjectNarrative: vi.fn() });
    const wrapper = mountView();
    await flushPromises();

    // One stuck item: the icon itself is the link to its request.
    const failing = station(wrapper, 'ci').get('.project-flow__stuck');
    expect(failing.element.tagName).toBe('A');
    expect(failing.attributes()).toMatchObject({ href: 'https://gitlab.com/acme/api/-/merge_requests/9', target: '_blank', 'aria-label': 'feat/ready: CI failing' });

    // Several: the icon opens a list, each entry going to its request or its agent thread.
    const several = station(wrapper, 'review').get('button.project-flow__stuck');
    expect(several.attributes('aria-label')).toBe('2 need attention');
    expect(wrapper.find('.project-flow__stuck-list').exists()).toBe(false);
    await several.trigger('click');
    const list = wrapper.get('.project-flow__stuck-list');
    expect(list.findAll('li').map(item => item.text())).toStrictEqual(['fix/cursor-resumeOpen longer than usual', 'feat/asksWaiting for input']);
    expect(list.get('a').attributes('href')).toBe('https://gitlab.com/acme/api/-/merge_requests/7');
    await list.get('button').trigger('click');
    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-7']]);
    await several.trigger('click');
    expect(wrapper.find('.project-flow__stuck-list').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens the agent thread directly when the only stuck item is a teammate waiting for input', async () => {
    const base = overview();
    setElectronTestClient({ getProjectOverview: vi.fn(async () => overview({ flow: { ...base.flow, stations: base.flow.stations.map(entry => entry.kind === 'building'
      ? { ...entry, stuck: [{ branch: 'feat/asks', reason: 'needsInput' as const, target: { kind: 'agent' as const, agentId: 'agent-7' } }] }
      : { ...entry, stuck: [] }) } })), refreshProjectNarrative: vi.fn() });
    const wrapper = mountView();
    await flushPromises();
    await station(wrapper, 'building').get('button.project-flow__stuck').trigger('click');
    expect(wrapper.emitted('select-agent')).toStrictEqual([['agent-7']]);
    expect(wrapper.find('.project-flow__stuck-list').exists()).toBe(false);
    wrapper.unmount();
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
