import type { CompanionSession } from './companion-port';
import type { DraftLedger, SendOutcome } from './draft-ledger';

const retryMs = 2_000;

/**
 * Settles sends whose delivery was uncertain by asking the laptop what became of each. Only these reads are
 * retried: a prompt that timed out is never submitted again.
 */
export function createReceiptReconciler(deps: {
  ledger: DraftLedger;
  session(): CompanionSession | null;
  connected(): boolean;
  /** Changes whenever the connection is replaced, so an answer meant for an earlier one is dropped. */
  connection(): number;
  laptopId(): string;
  disposed(): boolean;
  /** A send that was uncertain has been settled; the screen can drop its warning. */
  settled(draftKey: string, outcome: SendOutcome): void;
}) {
  const { ledger } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function reconcile(): Promise<void> {
    const active = deps.session(); const connection = deps.connection();
    if (!active?.commandStatus || !deps.connected()) return;
    let retry = false;
    for (const [draftKey, commandId] of Object.entries(ledger.commandIds)) {
      if (!ledger.uncertain[draftKey] || JSON.parse(draftKey)[0] !== deps.laptopId() || ledger.unresolved[draftKey]) continue;
      try {
        const receipt = await active.commandStatus(commandId);
        if (active !== deps.session() || connection !== deps.connection() || deps.disposed()) return;
        if (ledger.commandIds[draftKey] !== commandId) continue;
        if (receipt === 'pending') { retry = true; continue; }
        if (receipt === 'unresolved') {
          // The daemon cannot prove delivery (e.g. it restarted during admission).
          // Keep the warning and draft; a deliberate new Send remains available.
          ledger.unresolved[draftKey] = true;
          continue;
        }
        const outcome: SendOutcome = receipt === 'accepted' ? 'accepted' : 'rejected';
        ledger.uncertain[draftKey] = false;
        ledger.callbacks.get(commandId)?.(outcome);
        ledger.callbacks.delete(commandId);
        if (outcome === 'accepted' && ledger.drafts[draftKey]?.text === ledger.submittedTexts[draftKey]) ledger.drafts[draftKey] = { text: '', selectionStart: 0, selectionEnd: 0 };
        deps.settled(draftKey, outcome);
        await ledger.persist();
      } catch { retry = true; }
    }
    if (retry && active === deps.session() && !deps.disposed()) schedule();
  }

  function schedule() {
    if (timer || deps.disposed()) return;
    timer = setTimeout(() => { timer = undefined; void reconcile(); }, retryMs);
  }

  return { reconcile, schedule, clear() { clearTimeout(timer); timer = undefined; } };
}
