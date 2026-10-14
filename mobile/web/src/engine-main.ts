import { createEngine, type EngineCommand, type EngineEvent } from '../../src/engine';
import { createRelayConnector, type RelayConfig } from '../../src/relay-connector';
import { createSelectionStore } from '../../src/selection-store';
import type { ProtectedVault } from '../../src/protected-storage';
import { handler, request } from './native';

// Credentials live in the iOS Keychain; this page only ever asks for them by key.
const vault: ProtectedVault = {
  read: ({ key }) => request({ type: 'vault.read', key }),
  write: async ({ key, value }) => { await request({ type: 'vault.write', key, value }); },
  remove: async ({ key }) => { await request({ type: 'vault.remove', key }); },
};

const relay = await request<RelayConfig | null>({ type: 'relay' });
const connector = createRelayConnector(vault, relay);
const events = handler('engine');
// The native side routes on `type` alone: an event is serialized once, here, and handed on untouched.
const post = (event: EngineEvent) => { void events.postMessage({ type: event.type, json: JSON.stringify(event) }); };
const engine = createEngine({ connector, selectionStore: createSelectionStore(vault), post });

window.companionEngine = {
  dispatch: (command) => engine.dispatch(JSON.parse(command) as EngineCommand),
  start: () => engine.start(),
};
void events.postMessage({ type: 'ready' });
