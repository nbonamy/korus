import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox, ElSegmented } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonStatus, SystemPermissionsStatus } from '@workspace/core/contracts';
import { defaultGeneralSettings } from '@workspace/core/settings';
import { setElectronTestClient } from '../../test/client';
import SettingsGeneralPanel from '../SettingsGeneralPanel.vue';

describe('SettingsGeneralPanel', () => {
  it('selects Queue by default and saves either follow-up choice from the segmented control', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({ updateSettings });
    await flushPromises();
    const control = wrapper.get('[aria-label="Follow-up behavior"]');
    const option = (label: string) => control.findAll('label').find((item) => item.text() === label)!.get('input');
    expect((option('Queue').element as HTMLInputElement).checked).toBe(true);
    await option('Steer').setValue(true);
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { followUpBehavior: 'steer' } });
    await wrapper.setProps({ settings: { ...defaultGeneralSettings, followUpBehavior: 'steer' } });
    expect((option('Steer').element as HTMLInputElement).checked).toBe(true);
    await option('Queue').setValue(true);
    expect(updateSettings).toHaveBeenLastCalledWith({ general: { followUpBehavior: 'queue' } });
  });

  beforeEach(() => { setElectronTestClient({}); });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates the prevent sleep setting', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({ updateSettings });

    await flushPromises();
    await wrapper.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', false);

    expect(wrapper.text()).toContain('Prevent sleep while agents run');
    expect(wrapper.text()).not.toContain('Worktree initialization');
    expect(updateSettings).toHaveBeenCalledWith({
      general: {
        preventSleepWhenAgentsRun: false,
      },
    });
  });

  it('lets the user disable model-triggered celebrations', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({ updateSettings });
    await flushPromises();

    const celebrationRow = wrapper.findAllComponents({ name: 'FormRow' })
      .find((row) => row.text().includes('Agent celebrations'));
    expect(celebrationRow).toBeDefined();
    await celebrationRow!.findComponent({ name: 'ElSwitch' }).vm.$emit('update:modelValue', false);

    expect(updateSettings).toHaveBeenCalledWith({
      general: { celebrationsEnabled: false },
    });
  });
  it('toggles the background service through Settings', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    let resolveInstall: () => void = () => undefined;
    const installing = new Promise<void>((resolve) => {
      resolveInstall = resolve;
    });
    const setDaemonEnabled = vi.fn().mockReturnValue(installing);
    const wrapper = mountPanel({
      daemonStatus: daemonStatus({ installed: false, running: false }),
      setDaemonEnabled,
    });

    await flushPromises();

    expect(wrapper.text()).toContain(`Keep ${product.name} ready in the background`);
    expect(wrapper.text()).toContain('Off');

    const daemonSwitch = wrapper.findAllComponents({ name: 'ElSwitch' })
      .find((candidate) => candidate.attributes('aria-label') === `Keep ${product.name} ready in the background`)!;
    await daemonSwitch.vm.$emit('update:modelValue', true);
    await wrapper.vm.$nextTick();

    expect(setDaemonEnabled).toHaveBeenCalledWith(true);
    expect(wrapper.text()).toContain('Installing…');
    expect(wrapper.find('.app-spinner').exists()).toBe(true);

    resolveInstall();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Installing…');
    expect(confirm).toHaveBeenCalledWith(
      `${product.name} needs to restart to connect to the background agent.`,
      `Restart ${product.name}?`,
      expect.objectContaining({
        cancelButtonText: 'Later',
        confirmButtonText: 'Restart now',
      }),
    );
  });

  it('uses a green status dot when the daemon is installed', async () => {
    const wrapper = mountPanel({
      daemonStatus: daemonStatus({ installed: true, running: false }),
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Installed');
    expect(wrapper.find('.settings-general-panel__status-icon--ok').exists()).toBe(true);
  });

  it('shows a loading indicator while uninstalling the daemon', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    let resolveUninstall: () => void = () => undefined;
    const uninstalling = new Promise<void>((resolve) => {
      resolveUninstall = resolve;
    });
    const setDaemonEnabled = vi.fn().mockReturnValue(uninstalling);
    const wrapper = mountPanel({
      daemonStatus: daemonStatus({ installed: true, running: true }),
      setDaemonEnabled,
    });

    await flushPromises();

    const daemonSwitch = wrapper.findAllComponents({ name: 'ElSwitch' })
      .find((candidate) => candidate.attributes('aria-label') === `Keep ${product.name} ready in the background`)!;
    await daemonSwitch.vm.$emit('update:modelValue', false);
    await wrapper.vm.$nextTick();

    expect(setDaemonEnabled).toHaveBeenCalledWith(false);
    expect(wrapper.text()).toContain('Uninstalling…');
    expect(wrapper.find('.app-spinner').exists()).toBe(true);

    resolveUninstall();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Uninstalling…');
  });

  it('restarts the app when the user accepts the daemon restart dialog', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const setDaemonEnabled = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({
      daemonStatus: daemonStatus({ installed: false, running: false }),
      restartApp,
      setDaemonEnabled,
    });

    await flushPromises();
    const daemonSwitch = wrapper.findAllComponents({ name: 'ElSwitch' })
      .find((candidate) => candidate.attributes('aria-label') === `Keep ${product.name} ready in the background`)!;
    await daemonSwitch.vm.$emit('update:modelValue', true);
    await flushPromises();

    expect(setDaemonEnabled).toHaveBeenCalledWith(true);
    expect(restartApp).toHaveBeenCalledOnce();
  });

  it('keeps the app running when the user postpones the daemon restart dialog', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    const restartApp = vi.fn().mockResolvedValue(undefined);
    const setDaemonEnabled = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({
      daemonStatus: daemonStatus({ installed: true, running: true }),
      restartApp,
      setDaemonEnabled,
    });

    await flushPromises();
    const daemonSwitch = wrapper.findAllComponents({ name: 'ElSwitch' })
      .find((candidate) => candidate.attributes('aria-label') === `Keep ${product.name} ready in the background`)!;
    await daemonSwitch.vm.$emit('update:modelValue', false);
    await flushPromises();

    expect(setDaemonEnabled).toHaveBeenCalledWith(false);
    expect(restartApp).not.toHaveBeenCalled();
  });

  it('disables daemon installation when the desktop adapter reports unsupported status', async () => {
    const wrapper = mountPanel({
      daemonStatus: daemonStatus({
        supported: false,
        detail: 'No packaged daemon runtime was found.',
      }),
      daemonStatusError: 'No packaged daemon runtime was found.',
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Unavailable');
    expect(wrapper.text()).toContain('No packaged daemon runtime was found.');
    const advanced = wrapper.findAllComponents({ name: 'FormSection' }).find((section) => section.text().includes('Advanced'))!;
    expect(advanced.text()).toContain(`Keep ${product.name} ready in the background`);
    expect(advanced.findComponent({ name: 'ElSwitch' }).props('disabled')).toBe(true);
  });

  it('chooses and clears the configured source folder', async () => {
    const chooseSourceFolder = vi.fn().mockResolvedValue('/Users/nbonamy/src');
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mountPanel({
      chooseSourceFolder,
      sourceFolder: {
        path: '',
        initialized: true,
        recentRepoNames: [],
      },
      updateSettings,
    });

    await flushPromises();
    expect(wrapper.text()).toContain('Source folder');
    expect(wrapper.text()).toContain('Not configured');

    await wrapper.findAll('button').find((button) => button.text() === 'Choose')?.trigger('click');
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith({
      sourceFolder: {
        path: '/Users/nbonamy/src',
      },
    });

    const configuredSourceFolder = {
      sourceFolder: {
        path: '~/src',
        initialized: true,
        recentRepoNames: ['agent-workspace'],
      },
    };
    await wrapper.setProps(configuredSourceFolder as never);
    await wrapper.findAll('button').find((button) => button.text() === 'Clear')?.trigger('click');

    expect(updateSettings).toHaveBeenCalledWith({
      sourceFolder: {
        path: '',
      },
    });
  });

  it('surfaces source folder chooser failures', async () => {
    const wrapper = mountPanel({
      chooseSourceFolder: vi.fn().mockRejectedValue(new Error('Dialog failed')),
      sourceFolder: {
        path: '',
        initialized: true,
        recentRepoNames: [],
      },
    });

    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === 'Choose')?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Dialog failed');
  });

  it('shows a grant action when macOS Accessibility is required', async () => {
    const getSystemPermissions = vi.fn().mockResolvedValue(permissionStatus({
      required: true,
      trusted: false,
    }));
    const openAccessibilitySettings = vi.fn().mockResolvedValue(permissionStatus({
      required: true,
      trusted: true,
    }));
    const wrapper = mountPanel({ getSystemPermissions, openAccessibilitySettings });

    await flushPromises();

    expect(wrapper.text()).toContain('System permissions');
    expect(wrapper.text()).toContain('Accessibility');
    expect(wrapper.text()).toContain('Required');

    await wrapper.findAll('button').find((button) => button.text() === 'Grant')?.trigger('click');
    await flushPromises();

    expect(openAccessibilitySettings).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Granted');
  });

  it('shows Screen Recording status and grants it through the helper', async () => {
    const getSystemPermissions = vi.fn().mockResolvedValue(permissionStatus(
      { required: true, trusted: true },
      { required: true, trusted: false },
    ));
    const openScreenRecordingSettings = vi.fn().mockResolvedValue(permissionStatus(
      { required: true, trusted: true },
      { required: true, trusted: true },
    ));
    const wrapper = mountPanel({ getSystemPermissions, openScreenRecordingSettings });

    await flushPromises();

    expect(wrapper.text()).toContain('Screen recording');
    expect(wrapper.text()).toContain('Required for screenshots to capture the frontmost window');

    const grantButtons = wrapper.findAll('button').filter((button) => button.text() === 'Grant');
    await grantButtons.at(-1)?.trigger('click');
    await flushPromises();

    expect(openScreenRecordingSettings).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Granted');
  });

  it('shows non-macOS permission status without an action', async () => {
    const getSystemPermissions = vi.fn().mockResolvedValue({
      platform: 'linux',
      accessibility: {
        required: false,
        trusted: true,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    } satisfies SystemPermissionsStatus);
    const wrapper = mountPanel({ getSystemPermissions });

    await flushPromises();

    expect(wrapper.text()).toContain('Not needed');
    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('Grant');
    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('Refresh');
  });
});

function mountPanel(props: Record<string, unknown>) {
  return mount(SettingsGeneralPanel, {
    props: {
      settings: defaultGeneralSettings,
      ...props,
    },
    global: {
      components: { ElSegmented },
    },
  });
}

function permissionStatus(
  accessibility: SystemPermissionsStatus['accessibility'],
  screenRecording: SystemPermissionsStatus['screenRecording'] = { required: true, trusted: true },
): SystemPermissionsStatus {
  return {
    platform: 'darwin',
    accessibility,
    screenRecording,
  };
}

function daemonStatus(overrides: Partial<DaemonStatus> = {}): DaemonStatus {
  return {
    supported: true,
    installed: false,
    running: false,
    socketPath: '/Users/nicolas/.agent-workspace/daemon.sock',
    launchAgentPath: '/Users/nicolas/Library/LaunchAgents/com.nabocorp.agent-workspace.daemon.plist',
    ...overrides,
  };
}
