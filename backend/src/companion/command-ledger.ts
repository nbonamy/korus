import type { CompanionCommandReceipt, CompanionTarget } from '@workspace/core/companion-protocol';

/** Receipts only dedupe phone retries, so they expire; entries saved before timestamps existed start their clock when first pruned. */
export type StoredCommand = CompanionCommandReceipt & { fingerprint: string; createdAt?: number };
export type SettledCommand = StoredCommand & { state: 'accepted' | 'rejected' | 'unresolved' };

/**
 * At-most-once prompt admission. A command is in flight in this process, persisted, or unknown.
 * In-flight identity is published before admission can yield, so neither a retry nor a status
 * read observes absence while the provider may still receive the prompt. A persisted `pending`
 * entry without an in-flight admission means a process ended after possible admission: it is
 * unresolved and never replayed.
 */
export class CommandLedger {
  private readonly inFlight = new Map<string, { fingerprint: string; target: CompanionTarget; result: Promise<SettledCommand> }>();
  constructor(private readonly stored: (key: string) => StoredCommand | undefined) {}
  /** Callers must not yield before this call: registration is synchronous. */
  async submit(key: string, fingerprint: string, target: CompanionTarget, admit: () => Promise<SettledCommand>): Promise<CompanionCommandReceipt> {
    const running = this.inFlight.get(key);
    const known = running ?? this.stored(key);
    if (known && known.fingerprint !== fingerprint) throw new Error('Command identity was reused.');
    if (running) return receipt(await running.result);
    if (known) return receipt(known as StoredCommand);
    const result = admit();
    this.inFlight.set(key, { fingerprint, target, result });
    try { return receipt(await result); } finally { this.inFlight.delete(key); }
  }
  status(key: string, clientCommandId: string): CompanionCommandReceipt | { clientCommandId: string; state: 'notReceived' } {
    const running = this.inFlight.get(key);
    if (running) return { clientCommandId, target: running.target, state: 'pending' };
    const stored = this.stored(key);
    return stored ? receipt(stored) : { clientCommandId, state: 'notReceived' };
  }
}
function receipt({ fingerprint: _fingerprint, createdAt: _createdAt, ...receipt }: StoredCommand): CompanionCommandReceipt {
  return { ...receipt, state: receipt.state === 'pending' ? 'unresolved' : receipt.state };
}
