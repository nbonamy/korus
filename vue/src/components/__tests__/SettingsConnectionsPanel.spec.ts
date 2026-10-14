import { product } from '@workspace/core/product';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceFolderListInput } from '@workspace/core/contracts';
import type { CompanionControl } from '@workspace/core/companion-protocol';
import { codexPairingUrl } from '../../device-pairing';
import SettingsConnectionsPanel from '../SettingsConnectionsPanel.vue';
const installedCodexVersion = '0.159.3';

describe('codexPairingUrl', () => {
  it('wraps the opaque code in the ChatGPT Codex pairing deep link', () => {
    expect(codexPairingUrl('opaque code/+')).toBe(
      'https://chatgpt.com/codex/pair?pairing_code=opaque+code%2F%2B',
    );
  });
});

async function expandAll(wrapper: ReturnType<typeof mount>) {
  for (const toggle of wrapper.findAll('.settings-connections-panel__identity')) {
    if (toggle.attributes('aria-expanded') === 'false') await toggle.trigger('click');
  }
}

describe('SettingsConnectionsPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('updates the remote-access keep-awake setting', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        settings: { preventSleepWhenRemoteAccessEnabled: true },
        updateSettings,
        getRemoteControlStatus: async () => ({ status: 'connected' }),
      },
      global: {
        },
    });
    await flushPromises();

    await switchWithLabel(wrapper, 'Keep this Mac awake').vm.$emit('update:modelValue', false);

    expect(wrapper.text()).toContain('Keep this Mac awake');
    expect(updateSettings).toHaveBeenCalledWith({
      general: {
        preventSleepWhenRemoteAccessEnabled: false,
      },
    });
  });

  it('accepts the host companion control function without a prop type warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const companionControl = vi.fn(async () => ({ status: { enabled: false } }) as never);
    const wrapper = mount(SettingsConnectionsPanel, {
      props: { getRemoteControlStatus: async () => ({ status: 'connected' }), companionControl },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Mobile access');
    expect(companionControl).toHaveBeenCalledWith({ action: 'status' });
    expect(warn.mock.calls.flat().join(' ')).not.toContain('companionControl');
  });

  it('saves the mobile keep-awake preference while the relay reconnects and hides it when access is disabled', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const status = { configured: true, enabled: true, connected: false, hostId: 'host', relayOrigin: '', devices: [], pending: [] };
    const companionControl = vi.fn(async (input: CompanionControl) => {
      if (input.action === 'disable') status.enabled = false;
      return { status: { ...status } };
    });
    const wrapper = mount(SettingsConnectionsPanel, { props: {
      settings: { preventSleepWhenRemoteAccessEnabled: true }, updateSettings, companionControl,
    } });
    await flushPromises();
    const mobile = wrapper.get('[aria-labelledby="settings-mobile-title"]');
    const keepAwake = () => mobile.find('[role="switch"][aria-label="Keep this Mac awake"]');
    expect(keepAwake().exists()).toBe(true);
    await keepAwake().setValue(false);
    await flushPromises();
    expect(updateSettings).toHaveBeenCalledWith({ general: { preventSleepWhenRemoteAccessEnabled: false } });
    await wrapper.setProps({ settings: { preventSleepWhenRemoteAccessEnabled: false } });
    expect((keepAwake().element as HTMLInputElement).checked).toBe(false);
    await mobile.get('[role="switch"][aria-label="Allow connections"]').setValue(false);
    await flushPromises();
    expect(keepAwake().exists()).toBe(false);
    wrapper.unmount();
  });

  it('hides the remote-access keep-awake setting while device connections are disabled', async () => {
    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        getRemoteControlStatus: async () => ({ status: 'disabled' }),
      },
      global: {
        },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain('Keep this Mac awake');
  });

  it('lists saved remote connections and exposes row actions', async () => {
    const checkRemoteConnection = vi.fn().mockResolvedValue(undefined);
    const updateRemoteConnection = vi.fn().mockResolvedValue(undefined);
    const removeRemoteConnection = vi.fn().mockResolvedValue(undefined);
    const listSourceFolders = vi.fn(async (input?: SourceFolderListInput) => (
      input?.path === '/home/nicolas/src'
        ? { path: '/home/nicolas/src', parentPath: '/home/nicolas', entries: [] }
        : {
          path: '/home/nicolas',
          parentPath: '/home',
          entries: [{ name: 'src', path: '/home/nicolas/src' }],
        }
    ));
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        connections: [{
          id: 'connection-devbox',
          kind: 'ssh',
          name: 'devbox',
          host: 'devbox',
          hostName: 'devbox.internal',
          user: 'nicolas',
          status: 'ready',
          detail: 'Ready (daemon 0.1.0)',
          sourceFolderPath: '~/src',
          transport: {
            type: 'ssh-stdio',
            command: 'ssh',
            args: ['devbox', 'node ~/.agent-workspace/daemon.mjs --stdio'],
          },
          createdAt: '2026-06-14T10:00:00.000Z',
          updatedAt: '2026-06-14T10:00:00.000Z',
        }],
        teams: [{
          id: 'team-remote',
          name: 'Remote Team',
          color: '#1B4FB2',
          agentIds: [],
          remoteConnectionId: 'connection-devbox',
        }],
        checkRemoteConnection,
        listSourceFolders,
        updateRemoteConnection,
        removeRemoteConnection,
      },
      global: {
        },
    });

    expect(wrapper.text()).toContain('devbox');
    expect(wrapper.text()).toContain('nicolas@devbox.internal');
    expect(wrapper.text()).not.toContain('Ready (daemon 0.1.0)');
    await expandAll(wrapper);
    expect(wrapper.text()).toContain('Ready (daemon 0.1.0)');

    await wrapper.get('[aria-label="Connection settings for devbox"]').trigger('click');
    await flushPromises();
    expect([...document.body.querySelectorAll('.app-dialog__footer .app-button')].map((button) => [...button.classList])).toStrictEqual([
      ['app-button', 'app-button--tertiary'],
      ['app-button', 'app-button--primary'],
    ]);
    bodyButton('Browse')?.click();
    await flushPromises();
    bodyRemoteFolderRow('src')?.click();
    await flushPromises();
    await flushPromises();
    bodyButton('Select this folder')?.click();
    await flushPromises();
    bodyButton('Save')?.click();
    await flushPromises();

    await wrapper.get('[aria-label="devbox actions"]').trigger('click');
    await flushPromises();
    bodyButton('Sync')?.click();
    await flushPromises();

    await wrapper.get('[aria-label="devbox actions"]').trigger('click');
    await flushPromises();
    bodyButton('Delete')?.click();
    await flushPromises();

    expect(listSourceFolders).toHaveBeenCalledWith({ remoteConnectionId: 'connection-devbox', path: '~/src' });
    expect(listSourceFolders).toHaveBeenCalledWith({ remoteConnectionId: 'connection-devbox', path: '/home/nicolas/src' });
    expect(updateRemoteConnection).toHaveBeenCalledWith('connection-devbox', { sourceFolderPath: '/home/nicolas/src' });
    expect(checkRemoteConnection).toHaveBeenCalledWith('connection-devbox');
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(
      'devbox will be removed. This will also remove 1 connected team from this app: Remote Team. Remote agents, messages, and automations will keep running on the SSH host.',
      'Delete devbox?',
      {
        cancelButtonText: 'Cancel',
        confirmButtonText: 'Delete',
        type: 'warning',
      },
    );
    expect(removeRemoteConnection).toHaveBeenCalledWith('connection-devbox');
  });

  it('offers to upgrade an SSH connection when its daemon version differs', async () => {
    const checkRemoteConnection = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        appVersion: '0.19.1',
        connections: [{
          id: 'connection-outdated',
          kind: 'ssh',
          name: 'wall-e',
          host: 'wall-e',
          status: 'ready',
          detail: 'Ready (daemon 0.15.0)',
          createdAt: '2026-06-14T10:00:00.000Z',
          updatedAt: '2026-06-14T10:00:00.000Z',
        }, {
          id: 'connection-current',
          kind: 'ssh',
          name: 'eve',
          host: 'eve',
          status: 'ready',
          daemonVersion: '0.19.1',
          codexVersion: installedCodexVersion,
          detail: 'Ready (daemon 0.19.1)',
          createdAt: '2026-06-14T10:00:00.000Z',
          updatedAt: '2026-06-14T10:00:00.000Z',
        }],
        checkRemoteConnection,
      },
      global: {
        },
    });

    expect(wrapper.findAll('[aria-label="Upgrade available"]')).toHaveLength(1);
    expect(wrapper.find('.settings-connections-panel__upgrade').exists()).toBe(false);
    await expandAll(wrapper);
    const upgrade = wrapper.get('.settings-connections-panel__upgrade');
    expect(upgrade.text()).toBe('Upgrade');
    await upgrade.trigger('click');
    await flushPromises();

    expect(wrapper.findAll('.settings-connections-panel__upgrade')).toHaveLength(1);
    expect(checkRemoteConnection).toHaveBeenCalledWith('connection-current', true);
    expect(checkRemoteConnection).toHaveBeenCalledWith('connection-outdated');
    await wrapper.setProps({ connections: [{ ...wrapper.props('connections')![1]!, codexVersion: '0.143.0' }] });
    expect(wrapper.find('.settings-connections-panel__upgrade').exists()).toBe(false);
    await wrapper.setProps({ connections: [{ ...wrapper.props('connections')![0]!, codexVersion: '' }] });
    expect(wrapper.find('.settings-connections-panel__upgrade').exists()).toBe(false);
    await wrapper.setProps({ connections: [{ ...wrapper.props('connections')![0]!, codexVersion: installedCodexVersion }] });
    expect(wrapper.find('.settings-connections-panel__upgrade').exists()).toBe(false);
  });

  it('shows the inspected Claude version in remote connection settings', async () => {
    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        connections: [{
          id: 'connection-devbox',
          kind: 'ssh',
          name: 'devbox',
          host: 'devbox',
          status: 'ready',
          detail: 'Ready (daemon 0.21.1, Codex 0.155.1, Claude 2.1.283)',
          createdAt: '2026-06-14T10:00:00.000Z',
          updatedAt: '2026-06-14T10:00:00.000Z',
        }],
      },
    });

    await expandAll(wrapper);
    expect(wrapper.get('.settings-connections-panel__detail').text()).toContain('Claude 2.1.283');
  });

  it('shows both engine connections whenever the remote host is ready', async () => {
    const ready = {
      id: 'connection-devbox', kind: 'ssh' as const, name: 'devbox', host: 'devbox', status: 'ready' as const,
      createdAt: '2026-06-14T10:00:00.000Z', updatedAt: '2026-06-14T10:00:00.000Z',
    };
    const wrapper = mount(SettingsConnectionsPanel, {
      props: { connections: [ready], settings: { preventSleepWhenRemoteAccessEnabled: true } },
    });
    expect(wrapper.find('.remote-engine-connections').exists()).toBe(false);
    await expandAll(wrapper);
    expect(wrapper.find('.remote-engine-connections').exists()).toBe(true);
    await wrapper.setProps({ connections: [{ ...ready, status: 'error' }] });
    expect(wrapper.find('.remote-engine-connections').exists()).toBe(false);
  });

  it('loads ssh hosts and adds the selected connection', async () => {
    const listSshHosts = vi.fn().mockResolvedValue([{
      host: 'devbox',
      hostName: 'devbox.internal',
      user: 'nicolas',
      port: 2222,
    }]);
    const addSshConnection = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        connections: [],
        listSshHosts,
        addSshConnection,
      },
      global: {
        },
    });

    await wrapper.findAll('button').find((button) => button.text() === 'Add remote')?.trigger('click');
    await flushPromises();

    expect(listSshHosts).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('devbox');
    expect(document.body.textContent).toContain('nicolas@devbox.internal:2222');

    const connectButton = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Connect'));
    connectButton?.click();
    await flushPromises();

    expect(addSshConnection).toHaveBeenCalledWith({
      name: 'devbox',
      host: 'devbox',
      hostName: 'devbox.internal',
      user: 'nicolas',
      port: 2222,
    });
  });

  it('pairs and revokes Codex mobile devices', async () => {
    vi.useFakeTimers();
    const session = {
      pairingCode: 'opaque-pairing-payload',
      manualPairingCode: 'ABCD-EFGH',
      environmentId: 'environment-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const getRemoteControlStatus = vi.fn().mockResolvedValue({
      status: 'connected',
      serverName: `${product.name}`,
      installationId: 'installation-1',
      environmentId: 'environment-1',
      allowRemoteControl: true,
    });
    const startDevicePairing = vi.fn().mockResolvedValue(session);
    const checkDevicePairing = vi.fn().mockResolvedValue(true);
    const listPairedDevices = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        clientId: 'client-1',
        displayName: 'Nicolas’s iPhone',
        platform: 'iOS',
        appVersion: '1.0.0',
      }]);
    const revokePairedDevice = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);

    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        getRemoteControlStatus,
        startDevicePairing,
        checkDevicePairing,
        listPairedDevices,
        revokePairedDevice,
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('Codex device pairing');
    expect(wrapper.text()).toContain('No paired devices');
    await wrapper.findAll('button').find((button) => button.text() === 'Add device')?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('ABCD-EFGH');

    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(checkDevicePairing).toHaveBeenCalledWith(session);
    expect(wrapper.text()).not.toContain('Paired successfully');
    expect(wrapper.text()).not.toContain('ABCD-EFGH');
    expect(wrapper.find('img[alt="Codex device pairing QR code"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Nicolas’s iPhone');
    expect(wrapper.get('.settings-device-pairing__device-list').text()).toContain('Nicolas’s iPhone');
    expect(wrapper.find('.settings-device-pairing__device-divider').exists()).toBe(true);

    await wrapper.findAll('button').find((button) => button.text() === 'Revoke')?.trigger('click');
    await flushPromises();
    expect(revokePairedDevice).toHaveBeenCalledWith('environment-1', 'client-1');
    vi.useRealTimers();
  });

  it('toggles mobile connections through the device-pairing controls', async () => {
    const enableRemoteControl = vi.fn().mockResolvedValue({ status: 'connecting' });
    const disableRemoteControl = vi.fn().mockResolvedValue({ status: 'disabled' });
    const wrapper = mount(SettingsConnectionsPanel, {
      props: {
        getRemoteControlStatus: async () => ({ status: 'disabled' }),
        enableRemoteControl,
        disableRemoteControl,
      },
    });
    await flushPromises();

    await switchWithLabel(wrapper, 'Allow connections').vm.$emit('update:modelValue', true);
    await flushPromises();
    expect(enableRemoteControl).toHaveBeenCalledOnce();
    const refreshingButton = wrapper.findAllComponents({ name: 'ElButton' })
      .find((candidate) => candidate.text() === 'Refreshing');
    expect(refreshingButton?.props('loading')).toBe(true);
    expect(refreshingButton?.props('disabled')).toBe(true);
    expect(wrapper.findAll('button').some((button) => button.text() === 'Add device')).toBe(false);
    expect(wrapper.findAll('button').some((button) => button.text() === 'Refresh')).toBe(false);

    await switchWithLabel(wrapper, 'Allow connections').vm.$emit('update:modelValue', false);
    await flushPromises();
    expect(disableRemoteControl).toHaveBeenCalledOnce();
  });
});

function switchWithLabel(wrapper: ReturnType<typeof mount>, label: string) {
  const control = wrapper.findAllComponents({ name: 'ElSwitch' })
    .find((candidate) => (
      candidate.attributes('aria-label') === label || candidate.props('ariaLabel') === label
    ));
  if (!control) throw new Error(`Missing ${label} switch`);
  return control;
}

function bodyButton(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')]
    .find((button) => button.textContent?.includes(label));
}

function bodyRemoteFolderRow(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll<HTMLButtonElement>('.remote-folder-picker-dialog__row')]
    .find((button) => button.textContent?.includes(label));
}
