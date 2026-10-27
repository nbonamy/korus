import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSummary } from '@workspace/core/usage';
import { configureAppClient } from '../../platform-api';
import { createClientApiMock } from '../../test/client-api-mock';
import AgentMoreMenu from '../AgentMoreMenu.vue';

const body = (selector: string) => Array.from(document.body.querySelectorAll(selector)).map(element => new DOMWrapper(element));
const rowText = () => body('.app-menu__info, [role="menuitem"]').map(row => Array.from(row.element.querySelectorAll('.app-menu__label, .app-menu__description, .app-menu__value')).map(part => part.textContent!.trim()).join(' '));
const usage = (rows: UsageSummary['rows']): UsageSummary => ({ rows, recordedSince: 0, retainedSince: 0 });
const row = (label: string, input: number, cacheRead: number, usd: number | null, coverage: 'complete' | 'partial' | 'unavailable' = 'complete'): UsageSummary['rows'][number] => ({
  label, started: 3, completed: 3, failed: 0, interrupted: 0, inProgress: 0, measuredTurns: 3,
  tokens: { input, output: 10, cacheRead, cacheWrite: null },
  cost: { usd, coverage, requests: 3, pricedRequests: 3, unpricedRequests: 0, unknownRequestExecutions: 0, reasons: [] },
});

let client: ReturnType<typeof createClientApiMock>;
const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => { client = createClientApiMock(); configureAppClient({ api: client.api, platform: 'desktop' }); });
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); client.dispose(); vi.restoreAllMocks(); });

function render(props = {}) {
  const wrapper = mount(AgentMoreMenu, { props: { agentId: 'agent-1', shareAvailable: true, ...props }, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
async function openMenu(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[aria-label="Agent actions"]').trigger('click');
  await flushPromises();
}

describe('AgentMoreMenu', () => {
  it('reads usage only when opened and shows this agent’s estimated cost and cached share next to Share', async () => {
    client.api.getUsage.mockResolvedValue(usage([row('agent-1', 1000, 900, 1.2345), row('agent-2', 50, 0, 9)]));
    const wrapper = render();
    expect(client.api.getUsage).not.toHaveBeenCalled();
    await openMenu(wrapper);
    expect(client.api.getUsage).toHaveBeenCalledExactlyOnceWith({ group: 'agentId' });
    expect(rowText()).toStrictEqual(['Share', 'Estimated cost $1.23', 'Cached input 90%']);
  });

  it('says the cost is unknown for an agent with no recorded usage and flags partial pricing', async () => {
    client.api.getUsage.mockResolvedValue(usage([row('agent-2', 50, 0, 9)]));
    const wrapper = render();
    await openMenu(wrapper);
    expect(rowText()).toStrictEqual(['Share', 'Estimated cost —']);
    client.api.getUsage.mockResolvedValue(usage([row('agent-1', 100, 0, 2, 'partial')]));
    await wrapper.get('[aria-label="Agent actions"]').trigger('click');
    await openMenu(wrapper);
    expect(rowText().join(' | ')).toContain('Estimated cost • Some usage could not be priced $2.00');
  });

  it('asks the parent to share', async () => {
    client.api.getUsage.mockResolvedValue(usage([]));
    const wrapper = render();
    await openMenu(wrapper);
    await body('[role="menuitem"]').find(item => item.text() === 'Share')!.trigger('click');
    expect(wrapper.emitted('share')).toStrictEqual([[]]);
  });

  it('leaves Share out when sharing is unavailable', async () => {
    client.api.getUsage.mockResolvedValue(usage([]));
    await openMenu(render({ shareAvailable: false }));
    expect(rowText()).toStrictEqual(['Estimated cost —']);
  });

  it('still opens when the usage read fails', async () => {
    client.api.getUsage.mockRejectedValue(new Error('unavailable'));
    const wrapper = render();
    await openMenu(wrapper);
    expect(rowText()).toContain('Estimated cost —');
  });
});
