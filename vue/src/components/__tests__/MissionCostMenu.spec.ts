import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mission } from '@workspace/core/missions';
import type { UsageSummary } from '@workspace/core/usage';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import MissionCostMenu from '../MissionCostMenu.vue';

const body = (selector: string) => Array.from(document.body.querySelectorAll(selector)).map(element => new DOMWrapper(element));
const rows = () => body('.app-menu__info').map(row => Array.from(row.element.querySelectorAll('.app-menu__label, .app-menu__description, .app-menu__value')).map(part => part.textContent!.trim()).join(' '));
const run = (stage: string, workerId: string, extra: Record<string, unknown> = {}) => ({ id: `run-${workerId}`, stage, memberId: 'member', workerId, status: 'running', skills: [], feedback: '', startedAt: '', ...extra });
const mission = { stageAgentIds: {}, artifacts: { tickets: [{ title: 'a', done: false, repositoryPath: '/src/api' }, { title: 'b', done: false, repositoryPath: '/src/web' }] },
  execution: { runs: [run('requirements', 'lead'), run('implementation', 'api-1', { ticketIndex: 0 }), run('implementation', 'web-1', { ticketIndex: 1 })] } } as unknown as Mission;
const row = (label: string, usd: number, coverage: 'complete' | 'partial' = 'complete'): UsageSummary['rows'][number] => ({
  label, started: 1, completed: 1, failed: 0, interrupted: 0, inProgress: 0, measuredTurns: 1, tokens: { input: 10, output: 1, cacheRead: 0, cacheWrite: null },
  cost: { usd, coverage, requests: 1, pricedRequests: 1, unpricedRequests: 0, unknownRequestExecutions: 0, reasons: [] },
});

let client: ReturnType<typeof createClientApiMock>;
const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => { client = createClientApiMock(); configureAppClient({ api: client.api, platform: 'desktop' }); });
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); client.dispose(); vi.restoreAllMocks(); });

async function openMenu() {
  const wrapper = mount(MissionCostMenu, { props: { mission }, attachTo: document.body });
  wrappers.push(wrapper);
  await wrapper.get('[aria-label="Mission cost"]').trigger('click');
  await flushPromises();
  return wrapper;
}

describe('MissionCostMenu', () => {
  it('reads usage when opened and lists the lead, each repository and the total', async () => {
    client.api.getUsage.mockResolvedValue({ rows: [row('lead', 1), row('api-1', 2.5), row('web-1', 4), row('stranger', 99)], recordedSince: 0, retainedSince: 0 } satisfies UsageSummary);
    const wrapper = mount(MissionCostMenu, { props: { mission }, attachTo: document.body });
    wrappers.push(wrapper);
    expect(client.api.getUsage).not.toHaveBeenCalled();
    await wrapper.get('[aria-label="Mission cost"]').trigger('click');
    await flushPromises();
    expect(client.api.getUsage).toHaveBeenCalledExactlyOnceWith({ group: 'agentId' });
    expect(rows()).toStrictEqual(['Lead $1.00', 'api $2.50', 'web $4.00', 'Total $7.50']);
  });

  it('says so when no agent of the Mission has recorded usage, and marks partial pricing', async () => {
    client.api.getUsage.mockResolvedValue({ rows: [], recordedSince: 0, retainedSince: 0 } satisfies UsageSummary);
    await openMenu();
    expect(rows()).toStrictEqual(['No usage yet']);
  });

  it('flags a total that includes usage which could not be priced', async () => {
    client.api.getUsage.mockResolvedValue({ rows: [row('lead', 1, 'partial')], recordedSince: 0, retainedSince: 0 } satisfies UsageSummary);
    await openMenu();
    expect(rows()).toStrictEqual(['Lead • Some usage could not be priced $1.00', 'Total • Some usage could not be priced $1.00']);
  });
});
