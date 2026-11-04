import type { DesignContent, DesignDocument } from '@workspace/core/design';
import { computed, shallowRef, type ComputedRef } from 'vue';

const prefix = 'design-history:';
const limit = 30;
/** Autosaves of one field closer together than this are a single undo step. */
const coalesceMs = 5000;

type Stored = { documentId: string; revision: number; undo: DesignContent[]; redo: DesignContent[] };
type Seen = { id: string; revision: number; content: DesignContent };

export type DesignHistory = {
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  /**
   * Report the design as the client currently sees it; every new revision stacks the previous content.
   * Consecutive revisions with the same `coalesceKey` (autosaves of one field) share one step.
   */
  observe(document: DesignDocument | null, coalesceKey?: string): void;
  /** Sends the earlier or later content through `apply`; both stacks move only if it returns the saved document. */
  step(direction: 'undo' | 'redo', apply: (content: DesignContent) => Promise<DesignDocument | null | false>): Promise<void>;
};

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readStored(agentId: string): Stored | undefined {
  try {
    const value = JSON.parse(storage()?.getItem(prefix + agentId) ?? 'null');
    return value && typeof value.documentId === 'string' && Number.isInteger(value.revision) && Array.isArray(value.undo) && Array.isArray(value.redo) ? value : undefined;
  } catch { return undefined; }
}

/**
 * Undo and redo history of one agent's design. The daemon never sees it: it lives here and in one localStorage entry,
 * and it is dropped whenever the stored revision no longer matches the design.
 */
export function createDesignHistory(agentId: string): DesignHistory {
  const undo = shallowRef<DesignContent[]>([]);
  const redo = shallowRef<DesignContent[]>([]);
  let seen: Seen | undefined;
  let stepping = false;
  let last: { key: string; at: number } | undefined;

  function save(): void {
    const store = storage();
    if (!store) return;
    const write = (entry: Stored) => store.setItem(prefix + agentId, JSON.stringify(entry));
    if (!seen) { try { store.removeItem(prefix + agentId); } catch { /* storage unavailable */ } return; }
    const entry: Stored = { documentId: seen.id, revision: seen.revision, undo: undo.value, redo: redo.value };
    try { write(entry); } catch {
      // Full storage must never break editing: keep a shorter history, then none.
      try { write({ ...entry, undo: entry.undo.slice(-5), redo: [] }); } catch { try { store.removeItem(prefix + agentId); } catch { /* storage unavailable */ } }
    }
  }

  function start(document: DesignDocument): void {
    seen = { id: document.id, revision: document.revision, content: document.content };
    last = undefined;
    undo.value = [];
    redo.value = [];
    const saved = readStored(agentId);
    if (saved && saved.documentId === document.id && saved.revision === document.revision) {
      undo.value = saved.undo.slice(-limit);
      redo.value = saved.redo.slice(-limit);
    }
    save();
  }

  return {
    canUndo: computed(() => undo.value.length > 0),
    canRedo: computed(() => redo.value.length > 0),
    observe(document, coalesceKey) {
      if (!document) {
        seen = undefined;
        last = undefined;
        undo.value = [];
        redo.value = [];
        save();
        return;
      }
      if (!seen || seen.id !== document.id || document.revision < seen.revision) { start(document); return; }
      if (document.revision === seen.revision) return;
      if (!stepping) {
        const joins = coalesceKey !== undefined && last?.key === coalesceKey && Date.now() - last.at < coalesceMs;
        if (!joins) undo.value = [...undo.value, seen.content].slice(-limit);
        redo.value = [];
        last = coalesceKey === undefined ? undefined : { key: coalesceKey, at: Date.now() };
      }
      seen = { id: document.id, revision: document.revision, content: document.content };
      save();
    },
    async step(direction, apply) {
      const from = direction === 'undo' ? undo : redo;
      const to = direction === 'undo' ? redo : undo;
      const target = from.value[from.value.length - 1];
      const before = seen;
      if (!target || !before || stepping) return;
      stepping = true;
      last = undefined;
      try {
        const saved = await apply(target);
        if (!saved) return;
        from.value = from.value.slice(0, -1);
        to.value = [...to.value, before.content].slice(-limit);
        seen = { id: saved.id, revision: saved.revision, content: saved.content };
        save();
      } finally { stepping = false; }
    },
  };
}

/** Forget one design's history, for a design that no longer exists. */
export function forgetDesignHistory(agentId: string): void {
  try { storage()?.removeItem(prefix + agentId); } catch { /* storage unavailable */ }
}

/** Drop the history of every agent not in `liveAgentIds`, including ones removed while the app was closed. */
export function pruneDesignHistory(liveAgentIds: ReadonlySet<string>): void {
  const store = storage();
  if (!store) return;
  try {
    for (const key of Object.keys(store)) if (key.startsWith(prefix) && !liveAgentIds.has(key.slice(prefix.length))) store.removeItem(key);
  } catch { /* storage unavailable */ }
}
