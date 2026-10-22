import { reactive, ref } from 'vue';
import { restoreDraftRecord, type DraftState, type DraftStore } from './protected-storage';

export type SendOutcome = 'accepted' | 'rejected';

/**
 * What the person typed and what became of it: drafts, sends whose delivery is not yet known, and the command each
 * was sent as. It is written to device storage before a send, so a killed app never silently repeats or loses one.
 */
export function createDraftLedger(store: DraftStore | undefined, onStorageError: () => void) {
  const drafts = reactive<Record<string, DraftState>>({});
  /** Sends the laptop may or may not have received. */
  const uncertain = reactive<Record<string, boolean>>({});
  /** Uncertain sends the laptop itself cannot account for; the person may send again. */
  const unresolved = reactive<Record<string, boolean>>({});
  const sending = reactive<Record<string, boolean>>({});
  const commandIds = reactive<Record<string, string>>({});
  const submittedTexts = reactive<Record<string, string>>({});
  /** Told the outcome once a send that was uncertain gets settled. */
  const callbacks = new Map<string, (outcome: SendOutcome) => void>();
  const storageReady = ref(!store);
  let failed = false;
  let writes = Promise.resolve();

  const ready = store ? store.read().then((record) => {
    const restored = restoreDraftRecord(record);
    Object.assign(drafts, restored.drafts);
    Object.assign(uncertain, restored.uncertain);
    Object.assign(commandIds, restored.commandIds);
    Object.assign(submittedTexts, restored.submittedTexts);
    storageReady.value = true;
  }).catch(() => { failed = true; onStorageError(); }) : Promise.resolve();

  function persist(): Promise<void> {
    if (!store) return Promise.resolve();
    const record = JSON.parse(JSON.stringify({ drafts, uncertain, commandIds, submittedTexts }));
    const pending = writes.then(() => store.write(record));
    // Each write keeps its rejection for callers; the queue remains usable after a transient lock.
    writes = pending.catch(() => { failed = true; onStorageError(); });
    return pending.then(() => { failed = false; });
  }

  return { drafts, uncertain, unresolved, sending, commandIds, submittedTexts, callbacks, storageReady, ready, persist, get storageFailed() { return failed; } };
}
export type DraftLedger = ReturnType<typeof createDraftLedger>;
