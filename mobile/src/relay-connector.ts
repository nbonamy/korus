import { relayAddress } from '@workspace/core/companion-relay';
import type { CompanionConnector, CompanionSession } from './companion-port';
import { connectionDiagnostic } from './connection-diagnostics';
import { createPairing, type RelayConfig } from './relay-pairing';
import { createRelayNetwork } from './relay-network';
import { ConversationCaches, createRelaySession } from './relay-session';
import type { ProtectedVault } from './protected-storage';
import { liveActivityAuthorizationMessage, type LiveActivityRegistration } from '@workspace/core/companion-live-activity';

export type { RelayConfig };

/** The relay is deployment configuration baked into the build; the phone only needs a pairing code. */
export function createRelayConnector(vault: ProtectedVault, relay: RelayConfig | null): CompanionConnector {
  // Saved pairings cannot grant a transport exception: only this build's configured relay can.
  const addressFor = (origin: string, peerId: string) => relayAddress(origin, peerId,
    relay?.allowLocalDevelopment === true && origin === relay.origin && peerId === relay.peerId);
  const network = createRelayNetwork({ vault, relayPeerId: relay?.peerId, addressFor });
  const pairing = createPairing({ vault, relay, addressFor, network });
  const caches = new ConversationCaches();
  const sessions = new Map<CompanionSession, string>();
  let registrations = Promise.resolve();
  const closeSessions = (laptopId?: string) => { for (const [session, id] of [...sessions]) if (laptopId === undefined || id === laptopId) session.close(); };

  return {
    get laptops() { return pairing.laptops; },
    initialize: pairing.initialize,
    relayConfigured: Boolean(relay),
    pair: pairing.pair,
    rename: pairing.rename,
    cachedConversation: (target) => caches.peek(target),
    conversationUpdates: (target, since) => caches.updates(target, since),
    registerLiveActivity(laptopId, registration) {
      const work = registrations.then(async () => {
        await pairing.initialize();
        const host = pairing.find(laptopId);
        if (!host) throw new Error('Pair the laptop first.');
        network.resume();
        try {
          let signed: LiveActivityRegistration | null = registration;
          if (registration) {
            const signer = await network.signer();
            const expiresAt = Date.now() + 30 * 86_400_000;
            const signature = await signer.sign(liveActivityAuthorizationMessage(host.relayPeerId, host.hostId, signer.peerId, registration, expiresAt));
            signed = { ...registration, authorization: { expiresAt, signature } };
          }
          await network.request(host, 'liveActivity.register', signed);
        }
        finally { if (!sessions.size) await network.suspend(); }
      });
      registrations = work.catch(() => {});
      return work;
    },
    async connect(laptopId) {
      connectionDiagnostic('session.connect');
      await pairing.initialize();
      const host = pairing.find(laptopId);
      if (!host) throw new Error('Pair the laptop first.');
      const session = createRelaySession({ host, network, caches, onClosed: (closed) => { sessions.delete(closed); } });
      sessions.set(session, laptopId);
      return session;
    },
    async revoke(laptopId) {
      closeSessions(laptopId);
      caches.forget(laptopId);
      const host = await pairing.forget(laptopId);
      if (host) await network.request(host, 'device.forget', {});
    },
    async resume() { network.resume(); },
    // The network refuses new dials from the moment it is told, so closing the sessions cannot reopen anything.
    async suspend() { const stopped = network.suspend(); closeSessions(); await stopped; },
    async dispose() { const stopped = network.dispose(); caches.closeAll(); closeSessions(); await stopped; },
  };
}
