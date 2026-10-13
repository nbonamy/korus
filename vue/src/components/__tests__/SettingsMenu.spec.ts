import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsMenu from '../SettingsMenu.vue';
import type { AccountRateLimits, AgentBackend, AppSnapshot, CodexAccount } from '@workspace/core/contracts';
import { setElectronTestClient } from '../../test/client';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SettingsMenu', () => {
  it('loads subscription usage on opening without requiring a conversation, and hides API billing on reopening', async () => {
    const getProviderUsage = vi.fn().mockResolvedValue({
      limitId: 'claude', primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: null },
      secondary: { usedPercent: 0, windowDurationMins: 10_080, resetsAt: null },
    });
    setElectronTestClient({ getProviderUsage });
    const wrapper = mountMenu(undefined, { enabledBackends: ['claude'] });
    expect(getProviderUsage).not.toHaveBeenCalled();
    await openMenu(wrapper);
    await flushPromises();
    expect(getProviderUsage).toHaveBeenCalledWith('claude');
    expect(wrapper.get('[aria-label="Claude"]').text()).toContain('99%');
    expect(wrapper.get('[aria-label="Claude"]').text()).toContain('100%');
    await wrapper.setProps({ enabledBackends: ['claude'] }); // snapshot refresh, same engines
    await flushPromises();
    expect(getProviderUsage).toHaveBeenCalledTimes(1);
    await openMenu(wrapper); // close
    getProviderUsage.mockResolvedValue(null);
    await openMenu(wrapper);
    await flushPromises();
    expect(wrapper.find('[aria-label="Rate limits"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows a safe failure state and ignores a response after the menu closes', async () => {
    const getProviderUsage = vi.fn().mockImplementation(() => { throw new Error('private transport details'); });
    setElectronTestClient({ getProviderUsage });
    const wrapper = mountMenu(undefined, { enabledBackends: ['claude'] });
    await openMenu(wrapper);
    await flushPromises();
    expect(wrapper.get('[aria-label="Claude"]').text()).toContain('Couldn’t load usage');
    expect(wrapper.text()).not.toContain('private transport details');
    await openMenu(wrapper);
    let resolve!: (value: null) => void;
    getProviderUsage.mockImplementation(() => new Promise(done => { resolve = done; }));
    await openMenu(wrapper);
    await openMenu(wrapper);
    resolve(null);
    await flushPromises();
    expect(wrapper.find('[data-test="settings-popover-content"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders primary and weekly rate-limit rows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_781_140_878_000 - 29 * 60 * 60 * 1000);
    const wrapper = mountMenu({
      limitId: 'codex',
      limitName: null,
      primary: {
        usedPercent: 62,
        windowDurationMins: 300,
        resetsAt: (Date.now() + 3 * 60 * 60 * 1000) / 1000,
      },
      secondary: {
        usedPercent: 50,
        windowDurationMins: 10_080,
        resetsAt: 1_781_140_878,
      },
      credits: null,
      individualLimit: null,
      planType: 'pro',
      rateLimitReachedType: null,
    });

    await openMenu(wrapper);

    const rows = wrapper.findAll('.settings-menu__rate-limit');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.attributes('aria-label')).toBe('5h');
    expect(rows[0]?.text()).toContain('38%');
    expect(rows[0]?.get('.settings-menu__rate-limit-reset').text()).toBe('3h 0m');
    expect(rows[1]?.attributes('aria-label')).toBe('Weekly');
    expect(rows[1]?.text()).toContain('50%');
    expect(rows[1]?.get('.settings-menu__rate-limit-reset').text()).toBe('1d 5h');
    expect(wrapper.get('[aria-label="Usage actions divider"]').attributes('role')).toBe('separator');
    const header = wrapper.get('.settings-menu__rate-limits-header');
    expect(getComputedStyle(header.element).display).toBe('flex');
    const iconStyle = getComputedStyle(header.get('svg').element);
    expect(iconStyle.width).toBe('var(--icon-sm)');
    expect(iconStyle.height).toBe('var(--icon-sm)');

    vi.advanceTimersByTime(60 * 60 * 1000);
    await nextTick();
    expect(rows[1]?.get('.settings-menu__rate-limit-reset').text()).toBe('1d 4h');

    vi.advanceTimersByTime((26 * 60 + 22) * 60 * 1000);
    await nextTick();
    expect(rows[1]?.get('.settings-menu__rate-limit-reset').text()).toBe('1h 38m');
  });

  it('groups reported windows by enabled engine without borrowing another engine’s quota', async () => {
    const limits: AccountRateLimits = {
      limitId: null, limitName: null, primary: null, secondary: null, credits: null,
      individualLimit: null, planType: null, rateLimitReachedType: null,
    };
    const wrapper = mountMenu(undefined, { enabledBackends: ['codex', 'claude'], backendRateLimits: {
      codex: { ...limits, secondary: { usedPercent: 5, windowDurationMins: 10_080, resetsAt: null } },
      claude: { ...limits, primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: null }, secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: null } },
    } });
    await openMenu(wrapper);
    expect(wrapper.get('[aria-label="Codex"]').findAll('.settings-menu__rate-limit').map(row => row.text())).toEqual(['95%']);
    expect(wrapper.get('[aria-label="Claude"]').findAll('.settings-menu__rate-limit').map(row => row.text())).toEqual(['80%', '90%']);
    await wrapper.setProps({ enabledBackends: ['claude'], backendRateLimits: { codex: limits } });
    expect(wrapper.find('[aria-label="Codex"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Claude"]').exists()).toBe(false);
    expect(wrapper.find('.settings-menu__rate-limit').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Rate limits"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Usage actions divider"]').exists()).toBe(false);
    await wrapper.setProps({ enabledBackends: [] });
    expect(wrapper.find('[aria-label="Rate limits"]').exists()).toBe(false);
  });

  it('hides cached subscription quotas when Codex uses an API key', async () => {
    const wrapper = mountMenu({
      limitId: 'codex', limitName: null, primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null },
      secondary: null, credits: null, individualLimit: null, planType: 'pro', rateLimitReachedType: null,
    }, { account: { type: 'apiKey' }, enabledBackends: ['codex', 'claude'] });
    await openMenu(wrapper);
    expect(wrapper.find('[aria-label="Rate limits"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Usage actions divider"]').exists()).toBe(false);
    expect(wrapper.findAll('.app-menu__item')).not.toHaveLength(0);
  });

  it('offers navigation and quit, without a provider log-out action', async () => {
    setElectronTestClient({});
    const wrapper = mountMenu();

    await openMenu(wrapper);
    const actions = wrapper.findAll('.app-menu__item');
    expect(actions.map((button) => button.get('.app-menu__label').text())).toStrictEqual(['Settings', 'What’s New', 'Quit']);
    expect(actions.find(item => item.text().includes('Settings'))?.get('.app-menu__value').text()).toBe('⌘,');
    expect(actions.find(item => item.text() === 'Quit')?.classes()).toContain('app-menu__item--danger');
    await wrapper.findAll('button').find((button) => button.text() === 'What’s New')?.trigger('click');
    await openMenu(wrapper);
    await wrapper.findAll('button').find((button) => {
      const label = button.find('.app-menu__label');
      return label.exists() && label.text() === 'Settings';
    })?.trigger('click');
    await openMenu(wrapper);
    await wrapper.findAll('button').find((button) => button.text() === 'Quit')?.trigger('click');

    expect(wrapper.emitted('open-whats-new')).toStrictEqual([[]]);
    expect(wrapper.emitted('open-settings')).toStrictEqual([[]]);
    expect(wrapper.emitted('quit')).toStrictEqual([[]]);
  });

  it('keeps the product mark with or without a Codex account and omits its header', async () => {
    const wrapper = mountMenu(undefined, {
      account: { type: 'chatgpt', email: 'nico@example.com', planType: 'pro' },
    });

    await openMenu(wrapper);
    expect(wrapper.text()).not.toContain('nico@example.com');
    expect(wrapper.text()).not.toContain('pro');
    expect(wrapper.get('[aria-label="Account menu"]').element).toBeInstanceOf(HTMLElement);
    expect(wrapper.get('[aria-label="Account menu"] .product-mark-icon').attributes('aria-hidden')).toBe('true');
    await wrapper.setProps({ account: null });
    const mark = wrapper.get('[aria-label="Settings menu"] .product-mark-icon');
    expect(mark.attributes('fill')).toBe('none');
    expect(mark.attributes('stroke')).toBe('currentColor');
  });

  it('marks the trigger active when settings is selected', () => {
    const wrapper = mountMenu(undefined, { active: true });

    expect(wrapper.get('[aria-label="Settings menu"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[aria-label="Settings menu"]').classes()).toContain('settings-menu__trigger--active');
  });

  it('closes the popover when selecting a menu action', async () => {
    const wrapper = mountMenu();

    await openMenu(wrapper);
    expect(wrapper.find('[data-test="settings-popover-content"]').exists()).toBe(true);

    await wrapper.findAll('button').find((button) => {
      const label = button.find('.app-menu__label');
      return label.exists() && label.text() === 'Settings';
    })?.trigger('click');
    await nextTick();

    expect(wrapper.find('[data-test="settings-popover-content"]').exists()).toBe(false);
  });
});

function mountMenu(rateLimits?: AccountRateLimits, props: { active?: boolean; account?: CodexAccount; enabledBackends?: AgentBackend[]; backendRateLimits?: AppSnapshot['backendAccountRateLimits'] } = {}) {
  return mount(SettingsMenu, {
    attachTo: document.body,
    props: {
      enabledBackends: ['codex'],
      ...props,
      rateLimits,
    },
    global: {
      stubs: {
        ElPopover: {
          props: ['visible'],
          emits: ['update:visible'],
          template: `
            <div>
              <span @click="$emit('update:visible', !visible)">
                <slot name="reference" />
              </span>
              <section v-if="visible" data-test="settings-popover-content">
                <slot />
              </section>
            </div>
          `,
        },
      },
    },
  });
}

async function openMenu(wrapper: ReturnType<typeof mountMenu>): Promise<void> {
  await wrapper.get('[aria-label$="menu"]').trigger('click');
  await nextTick();
}
