export type AsyncCatalogStatus = 'notLoaded' | 'loading' | 'loaded' | 'error';

export type AsyncCatalogEntry<T> = {
  value: T[];
  status: AsyncCatalogStatus;
  error: string | null;
  promise: Promise<void> | null;
  source: unknown;
  revision: number;
};

/** Deduplicates catalog loads and rejects stale results when the backing client changes. */
export class AsyncCatalogCache<Key, Value> {
  private readonly entries = new Map<Key, AsyncCatalogEntry<Value>>();

  constructor(private readonly copy: (value: Value) => Value = (value) => value) {}

  entry(key: Key): AsyncCatalogEntry<Value> {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const created: AsyncCatalogEntry<Value> = {
      value: [],
      status: 'notLoaded',
      error: null,
      promise: null,
      source: null,
      revision: 0,
    };
    this.entries.set(key, created);
    return created;
  }

  load(key: Key, source: unknown, loader: () => Promise<Value[]>): AsyncCatalogEntry<Value> {
    const entry = this.entry(key);
    this.resetIfSourceChanged(entry, source);
    if (entry.promise || entry.status !== 'notLoaded') return entry;

    entry.status = 'loading';
    entry.error = null;
    const revision = entry.revision;
    const request = loader()
      .then((values) => {
        if (entry.revision !== revision) return;
        entry.value = values.map(this.copy);
        entry.status = 'loaded';
      })
      .catch((error) => {
        if (entry.revision !== revision) return;
        entry.value = [];
        entry.status = 'error';
        entry.error = error instanceof Error ? error.message : String(error);
      });
    entry.promise = request;
    void request.finally(() => {
      if (entry.promise === request) entry.promise = null;
    });
    return entry;
  }

  replace(key: Key, values: readonly Value[]): AsyncCatalogEntry<Value> {
    const entry = this.entry(key);
    entry.revision += 1;
    entry.value = values.map(this.copy);
    entry.status = 'loaded';
    entry.error = null;
    entry.promise = null;
    return entry;
  }

  clear(): void {
    this.entries.clear();
  }

  private resetIfSourceChanged(entry: AsyncCatalogEntry<Value>, source: unknown): void {
    if (entry.source === null || entry.source === source) {
      entry.source = source;
      return;
    }
    entry.value = [];
    entry.status = 'notLoaded';
    entry.error = null;
    entry.promise = null;
    entry.revision += 1;
    entry.source = source;
  }
}
