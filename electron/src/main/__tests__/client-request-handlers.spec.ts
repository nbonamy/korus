import { product } from '@workspace/core/product';
import { describe, expect, it, vi } from 'vitest';
import { createClientRequestHandlers } from '../client-request-handlers';

const computerUseMocks = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue({ clicked: true }),
  requestAccessibility: vi.fn().mockResolvedValue({ accessibilityTrusted: true }),
  stop: vi.fn(),
  getStatus: vi.fn().mockResolvedValue({
    accessibilityTrusted: true,
    screenCaptureTrusted: false,
    available: true,
    platform: 'darwin',
  }),
  requestScreenCapture: vi.fn().mockResolvedValue({
    accessibilityTrusted: true,
    screenCaptureTrusted: true,
    available: true,
    platform: 'darwin',
  }),
}));

vi.mock('../computer-use-tools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../computer-use-tools')>(),
  getComputerUseStatus: computerUseMocks.getStatus,
  requestComputerUseScreenCapture: computerUseMocks.requestScreenCapture,
  executeComputerUseCommand: computerUseMocks.execute,
  requestComputerUseAccessibility: computerUseMocks.requestAccessibility,
  stopComputerUseHelper: computerUseMocks.stop,
}));

const computerUseOptions = () => ({
  appPath: `/Applications/${product.name}.app/Contents/Resources/app.asar`,
  isPackaged: true,
  platform: 'darwin' as const,
  resourcesPath: `/Applications/${product.name}.app/Contents/Resources`,
});

vi.mock('electron', () => ({
  safeStorage: {
    decryptString: vi.fn(),
    encryptString: vi.fn(),
    isEncryptionAvailable: vi.fn(() => true),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

describe('createClientRequestHandlers', () => {
  it('reads current desktop focus for push decisions instead of retaining a stale focus state', async () => {
    let focused = true;
    const handlers = createClientRequestHandlers({ openExternal: vi.fn(), getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings: vi.fn(), computerUseOptions, desktopFocused: () => focused });
    expect(handlers['client/focus/get']!({})).toStrictEqual({ focused: true });
    focused = false;
    expect(handlers['client/focus/get']!({})).toStrictEqual({ focused: false });
  });

  it('validates browser execution identity and arguments before invoking the desktop port', async () => {
    const browserExecute = vi.fn().mockResolvedValue({ clicked: '#save' });
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(), getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings: vi.fn(), computerUseOptions, browserExecute,
    });
    const execute = handlers['client/browser/execute']!;
    await expect(execute({ agentId: 'agent-one', browserId: 'secondary', command: 'click', arguments: { selector: '#save' } }))
      .resolves.toStrictEqual({ clicked: '#save' });
    expect(browserExecute).toHaveBeenCalledWith('agent-one', 'secondary', 'click', { selector: '#save' });
    for (const input of [null, [], { agentId: ' ', browserId: 'secondary', command: 'click', arguments: {} },
      { agentId: 'agent-one', browserId: 'secondary', command: 'click', arguments: [] }]) {
      await expect(execute(input)).rejects.toThrow('Invalid');
    }
    expect(browserExecute).toHaveBeenCalledOnce();
    browserExecute.mockRejectedValueOnce(new Error('guest closed'));
    await expect(execute({ agentId: 'agent-one', browserId: 'secondary', command: 'click', arguments: {} })).rejects.toThrow('guest closed');
  });

  it('dispatches validated Computer Use commands and lifecycle actions to the helper boundary', async () => {
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(), getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings: vi.fn(), computerUseOptions,
    });
    await expect(handlers['client/computerUse/execute']!({ command: 'click', arguments: { x: 10, y: 20 } }))
      .resolves.toStrictEqual({ clicked: true });
    expect(computerUseMocks.execute).toHaveBeenCalledWith({ command: 'click', arguments: { x: 10, y: 20 }, options: computerUseOptions() });
    await expect(handlers['client/computerUse/execute']!({ command: 'shell', arguments: {} })).rejects.toThrow('Invalid Computer Use command');
    await expect(handlers['client/computerUse/execute']!({ command: 'click', arguments: null })).rejects.toThrow('Invalid client request params');
    expect(computerUseMocks.execute).toHaveBeenCalledOnce();
    await expect(handlers['client/computerUse/requestAccessibility']!({})).resolves.toMatchObject({ accessibilityTrusted: true });
    expect(handlers['client/computerUse/stop']!({})).toStrictEqual({ stopped: true });
    expect(computerUseMocks.stop).toHaveBeenCalledOnce();
  });

  it('opens external URLs through the desktop port', async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    const handlers = createClientRequestHandlers({
      openExternal,
      getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings: vi.fn(),
      computerUseOptions,
    });

    await expect(handlers['client/external/open']?.({ url: 'https://example.com' })).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('routes simulator actions to the authenticated agent desktop port and rejects malformed envelopes', async () => {
    const mobileSimulator = vi.fn().mockResolvedValue({ attachment: null });
    const handlers = createClientRequestHandlers({ openExternal: vi.fn(), getSystemPermissionsStatus: vi.fn(), openAccessibilitySettings: vi.fn(), computerUseOptions, mobileSimulator });
    await expect(handlers['client/mobileSimulator/execute']?.({ agentId: 'agent-dina', input: { action: 'status' } })).resolves.toStrictEqual({ attachment: null });
    expect(mobileSimulator).toHaveBeenCalledWith('agent-dina', { action: 'status' });
    expect(() => handlers['client/mobileSimulator/execute']?.({ input: { action: 'status' } })).toThrow('agentId');
  });

  it('opens the agent-scoped in-app browser through the desktop port', async () => {
    const browserState = {
      url: 'https://example.com/',
      title: 'Example',
      canGoBack: false,
      canGoForward: false,
    };
    const browserOpen = vi.fn().mockResolvedValue(browserState);
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(),
      getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings: vi.fn(),
      computerUseOptions,
      browserOpen,
    });

    await expect(handlers['client/browser/open']?.({
      agentId: 'agent-dina',
      browserId: 'primary',
      url: 'https://example.com',
    })).resolves.toStrictEqual(browserState);
    expect(browserOpen).toHaveBeenCalledWith('agent-dina', 'primary', 'https://example.com');
  });

  it('validates and queues a bounded provider-neutral spoken announcement', async () => {
    const queue = vi.fn().mockReturnValue({ queued: true });
    let voice: 'bf_emma' | 'af_heart' = 'bf_emma';
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(),
      getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings: vi.fn(),
      computerUseOptions,
      spokenAnnouncements: { queue },
      spokenAnnouncementVoice: () => voice,
    });

    expect(await handlers['client/spokenAnnouncement/queue']?.({
      agentId: 'agent-dina',
      phase: 'finish',
      text: '  Wrapped up.  ',
      voice: 'bf_emma',
    })).toStrictEqual({ queued: true });
    expect(queue).toHaveBeenCalledWith({
      agentId: 'agent-dina',
      phase: 'finish',
      text: 'Wrapped up.',
      voice: 'bf_emma',
    });
    await expect(async () => handlers['client/spokenAnnouncement/queue']?.({
      agentId: 'agent-dina',
      phase: 'middle',
      text: 'Nope.',
      voice: 'af_heart',
    })).rejects.toThrowError('Invalid phase.');
    await expect(async () => handlers['client/spokenAnnouncement/queue']?.({
      agentId: 'agent-dina',
      phase: 'start',
      text: 'x'.repeat(161),
      voice: 'af_heart',
    })).rejects.toThrowError('Invalid text.');
    expect(await handlers['client/spokenAnnouncement/queue']?.({
      agentId: 'agent-dina',
      phase: 'start',
      text: 'Nope.',
      voice: 'robot',
    })).toStrictEqual({ queued: true });
    expect(queue).toHaveBeenLastCalledWith({ agentId: 'agent-dina', phase: 'start', text: 'Nope.', voice: 'bf_emma' });
    voice = 'af_heart';
    expect(await handlers['client/spokenAnnouncement/queue']?.({
      agentId: 'agent-dina',
      phase: 'start',
      text: 'Backwards compatible.',
    })).toStrictEqual({ queued: true });
    expect(queue).toHaveBeenLastCalledWith({
      agentId: 'agent-dina',
      phase: 'start',
      text: 'Backwards compatible.',
      voice: 'af_heart',
    });
  });

  it('reports unsupported speech without failing the client request', async () => {
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(),
      getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings: vi.fn(),
      computerUseOptions,
    });
    expect(await handlers['client/spokenAnnouncement/queue']?.({
      agentId: 'agent-dina', phase: 'start', text: 'On it.',
    })).toStrictEqual({ queued: false, reason: 'unsupported' });
  });

  it('checks system permissions through the desktop-native port', async () => {
    const status = {
      platform: 'darwin',
      accessibility: {
        required: true,
        trusted: false,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    };
    const getSystemPermissionsStatus = vi.fn().mockReturnValue(status);
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(),
      getSystemPermissionsStatus,
      openAccessibilitySettings: vi.fn(),
      computerUseOptions,
    });

    expect(await handlers['client/system/permissions/get']?.(undefined)).toStrictEqual({
      ...status,
      screenRecording: { required: true, trusted: false },
    });
    expect(getSystemPermissionsStatus).toHaveBeenCalledOnce();
  });

  it('opens accessibility settings through the desktop-native port', async () => {
    const status = {
      platform: 'darwin',
      accessibility: {
        required: true,
        trusted: true,
      },
      screenRecording: {
        required: false,
        trusted: true,
      },
    };
    const openAccessibilitySettings = vi.fn().mockResolvedValue(status);
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(),
      getSystemPermissionsStatus: vi.fn(),
      openAccessibilitySettings,
      computerUseOptions,
    });

    await expect(handlers['client/system/permissions/accessibility/open']?.(undefined)).resolves.toStrictEqual({
      ...status,
      screenRecording: { required: true, trusted: false },
    });
    expect(openAccessibilitySettings).toHaveBeenCalledOnce();
  });

  it('requests Screen Recording through the Computer Use helper', async () => {
    const status = {
      platform: 'darwin',
      accessibility: { required: true, trusted: true },
      screenRecording: { required: false, trusted: true },
    };
    const handlers = createClientRequestHandlers({
      openExternal: vi.fn(),
      getSystemPermissionsStatus: vi.fn(() => status),
      openAccessibilitySettings: vi.fn(),
      computerUseOptions,
    });

    await expect(handlers['client/system/permissions/screenRecording/open']?.(undefined)).resolves.toStrictEqual({
      ...status,
      screenRecording: { required: true, trusted: true },
    });
    expect(computerUseMocks.requestScreenCapture).toHaveBeenCalledOnce();
  });
});
