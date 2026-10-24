import { contextBridge, ipcRenderer } from 'electron';
import { supportedBrowserExtensions } from '@workspace/core/browser-extensions';

// This preload is registered on browser sessions, but exposes a bridge only to
// extension documents/workers. Ordinary websites receive no Electron capability.
if (process.type === 'service-worker' || globalThis.location?.protocol === 'chrome-extension:') {
  const callbacks = new Set<(name: string, args: unknown[]) => void>();
  ipcRenderer.on('browser-extension:event', (_event, name: string, args: unknown[]) => {
    for (const callback of callbacks) callback(name, args);
  });
  contextBridge.exposeInMainWorld('__korusExtensionTransport', {
    worker: process.type === 'service-worker',
    call: (operation: string, args: unknown[]) => ipcRenderer.invoke('browser-extension:call', operation, args),
    receive: (callback: (name: string, args: unknown[]) => void) => {
      callbacks.add(callback);
    },
  });
  const storageRelayIds = supportedBrowserExtensions
    .filter((extension) => 'storageRelayPage' in extension)
    .map((extension) => extension.id);
  try {
    contextBridge.executeInMainWorld({ func: installBrowserExtensionApis, args: [storageRelayIds] });
  } catch (error) {
    console.error(
      `Browser extension API initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/** Own API bindings; native Chromium APIs retain their existing implementation. */
function installBrowserExtensionApis(storageRelayIds: string[]): void {
  type Api = Record<string, any>;
  const world = globalThis as typeof globalThis & {
    chrome: Api;
    browser?: Api;
    __korusExtensionTransport?: {
      worker: boolean;
      call(operation: string, args: unknown[]): Promise<{ ok: boolean; value?: unknown; error?: string }>;
      receive(callback: (name: string, args: unknown[]) => void): void;
    };
  };
  const transport = world.__korusExtensionTransport!;
  delete world.__korusExtensionTransport;
  const chrome = world.chrome;
  if (!chrome?.runtime?.id) return;
  const events = new Map<string, Set<Function>>();
  const failedCallback = (callback: Function, error: Error): void => {
    const native = Object.getOwnPropertyDescriptor(chrome.runtime, 'lastError');
    Object.defineProperty(chrome.runtime, 'lastError', { configurable: true, value: { message: error.message } });
    try {
      callback(undefined);
    } finally {
      if (native) Object.defineProperty(chrome.runtime, 'lastError', native);
      else delete chrome.runtime.lastError;
    }
  };
  const call = async (operation: string, args: unknown[]): Promise<any> => {
    const reply = await transport.call(operation, args);
    if (!reply.ok) throw new Error(reply.error ?? 'Browser extension operation failed.');
    return reply.value;
  };
  const method =
    (operation: string) =>
    (...args: any[]): any => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined;
      const result = call(operation, args);
      if (!callback) return result;
      void result.then(
        (value) => callback(value),
        (error) => failedCallback(callback, error),
      );
    };
  const event = (name: string): Api => {
    const listeners = events.get(name) ?? new Set<Function>();
    events.set(name, listeners);
    return {
      addListener(callback: Function) {
        if (typeof callback !== 'function') return;
        listeners.add(callback);
        void call('subscribe', [name]).catch(() => {});
      },
      removeListener(callback: Function) {
        listeners.delete(callback);
      },
      hasListener(callback: Function) {
        return listeners.has(callback);
      },
      hasListeners() {
        return listeners.size > 0;
      },
    };
  };
  transport.receive((name, args) => {
    for (const callback of events.get(name) ?? []) {
      try {
        callback(...args);
      } catch {
        /* An extension listener cannot break delivery to its peers. */
      }
    }
  });
  const module = (native: Api | undefined, prefix: string, methods: string[], eventNames: string[]): Api => {
    const result = { ...native };
    for (const name of methods) result[name] = method(`${prefix}.${name}`);
    for (const name of eventNames) result[name] = event(`${prefix}.${name}`);
    return result;
  };
  const replace = (name: string, value: Api): void => {
    Object.defineProperty(chrome, name, { value, configurable: true, enumerable: true });
    if (world.browser && world.browser !== chrome)
      Object.defineProperty(world.browser, name, { value, configurable: true, enumerable: true });
  };
  const runtime = chrome.runtime;
  runtime.openOptionsPage = method('runtime.openOptionsPage');
  runtime.sendNativeMessage = method('runtime.sendNativeMessage');
  runtime.connectNative = () => {
    throw new Error('Native desktop integration is not supported.');
  };
  replace(
    'permissions',
    module(undefined, 'permissions', ['getAll', 'contains', 'request', 'remove'], ['onAdded', 'onRemoved']),
  );
  replace(
    'tabs',
    module(
      chrome.tabs,
      'tabs',
      ['query', 'get', 'getCurrent', 'create', 'update', 'remove', 'reload'],
      [
        'onCreated',
        'onUpdated',
        'onRemoved',
        'onActivated',
        'onHighlighted',
        'onAttached',
        'onDetached',
        'onMoved',
        'onReplaced',
      ],
    ),
  );
  replace('windows', {
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
    ...module(
      chrome.windows,
      'windows',
      ['get', 'getAll', 'getCurrent', 'getLastFocused', 'create', 'update', 'remove'],
      ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'],
    ),
  });
  replace(
    'action',
    module(
      chrome.action,
      'action',
      [
        'setTitle',
        'getTitle',
        'setIcon',
        'setPopup',
        'getPopup',
        'setBadgeText',
        'getBadgeText',
        'setBadgeBackgroundColor',
        'getBadgeBackgroundColor',
        'enable',
        'disable',
        'getUserSettings',
        'openPopup',
      ],
      ['onClicked'],
    ),
  );
  replace(
    'contextMenus',
    module(chrome.contextMenus, 'contextMenus', ['create', 'update', 'remove', 'removeAll'], ['onClicked']),
  );
  replace('commands', module(chrome.commands, 'commands', ['getAll'], ['onCommand']));
  replace(
    'notifications',
    module(
      chrome.notifications,
      'notifications',
      ['create', 'update', 'clear', 'getAll', 'getPermissionLevel'],
      ['onClicked', 'onClosed', 'onButtonClicked', 'onPermissionLevelChanged'],
    ),
  );
  const services = { ...chrome.privacy?.services };
  for (const setting of [
    'passwordSavingEnabled',
    'autofillEnabled',
    'autofillAddressEnabled',
    'autofillCreditCardEnabled',
  ]) {
    services[setting] = module(services[setting], `privacy.services.${setting}`, ['get', 'set', 'clear'], ['onChange']);
  }
  replace('privacy', { ...chrome.privacy, services });
  const navigation = module(
    chrome.webNavigation,
    'webNavigation',
    [],
    [
      'onCommitted',
      'onCompleted',
      'onBeforeNavigate',
      'onDOMContentLoaded',
      'onErrorOccurred',
      'onHistoryStateUpdated',
      'onReferenceFragmentUpdated',
      'onCreatedNavigationTarget',
      'onTabReplaced',
    ],
  );
  for (const name of ['getFrame', 'getAllFrames']) {
    navigation[name] = (...args: any[]) => {
      const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined;
      const result = call(`webNavigation.${name}`, args).then(async (value) => {
        const hydrate = async (frame: Api): Promise<Api> => {
          const native = await chrome.scripting.executeScript({
            target: { tabId: args[0].tabId, frameIds: [frame.frameId] },
            func: () => null,
          });
          if (!native[0]?.documentId) throw new Error('Document identity is unavailable.');
          return { ...frame, documentId: native[0].documentId };
        };
        return Array.isArray(value) ? Promise.all(value.map(hydrate)) : value ? hydrate(value) : null;
      });
      if (!callback) return result;
      void result.then(callback, (error) => failedCallback(callback, error));
    };
  }
  replace('webNavigation', navigation);
  if (world.browser && world.browser !== chrome) {
    world.browser.runtime.openOptionsPage = runtime.openOptionsPage;
    world.browser.runtime.sendNativeMessage = runtime.sendNativeMessage;
    world.browser.runtime.connectNative = runtime.connectNative;
  }

  // Electron's worker storage reads work, but storage-change delivery needs a
  // passive extension document until the native runtime fixes that boundary.
  const storage = chrome.storage;
  if (transport.worker && storage && storageRelayIds.includes(chrome.runtime.id)) {
    Object.defineProperty(storage, 'onChanged', { configurable: true, value: event('storage.onChanged') });
    for (const area of ['local', 'session', 'sync', 'managed'])
      if (storage[area])
        Object.defineProperty(storage[area], 'onChanged', {
          configurable: true,
          value: event(`storage.${area}.onChanged`),
        });
  } else if (
    storage &&
    typeof location !== 'undefined' &&
    new URL(location.href).searchParams.has('korusStorageRelay')
  ) {
    storage.onChanged.addListener((changes: unknown, area: string) => {
      void call('relay.storage', [changes, area]).catch(() => {});
    });
  }
}
