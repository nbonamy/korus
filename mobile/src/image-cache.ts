import { conversationImageInput } from '@workspace/core/conversation-images';
import type { CompanionImage } from '@workspace/core/companion-protocol';

/** Native cache directories own binary bytes and the shared 256 MiB LRU budget. */
export type ImageCacheStore = {
  read(host: string, key: string): Promise<string | null>;
  write(host: string, key: string, dataUrl: string): Promise<void>;
  forget(host: string): Promise<void>;
};

export function nativeImageCacheStore(request: <T>(body: Record<string, unknown>) => Promise<T>): ImageCacheStore {
  return {
    read: (host, key) => request({ type: 'imageCache.read', host, key }),
    write: async (host, key, dataUrl) => { await request({ type: 'imageCache.write', host, key, dataUrl }); },
    forget: async host => { await request({ type: 'imageCache.forget', host }); },
  };
}

const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Cache only immutable provider references; a mutable file path is not an image identity. */
export class ConversationImageCache {
  private readonly epochs = new Map<string, number>();
  private readonly pending = new Map<string, Promise<CompanionImage>>();
  constructor(private readonly store: ImageCacheStore) {}

  async read(host: string, backend: string, session: string | null, reference: string, load: () => Promise<CompanionImage>): Promise<CompanionImage> {
    const image = conversationImageInput(reference);
    if (!image || image.sessionId !== session) return load();
    const epoch = this.epochs.get(host) ?? 0;
    const scope = await digest(host); const key = await digest(JSON.stringify([backend, session, reference]));
    const identity = JSON.stringify([host, epoch, key]);
    let work = this.pending.get(identity);
    if (!work) {
      work = (async () => {
        try {
          const dataUrl = await this.store.read(scope, key);
          if (dataUrl) return { dataUrl };
        } catch { /* An unavailable device cache must not prevent a host read. */ }
        const image = await load();
        if (epoch === (this.epochs.get(host) ?? 0)) {
          try { await this.store.write(scope, key, image.dataUrl); } catch { /* Display still succeeds when storage is full. */ }
        }
        return image;
      })();
      this.pending.set(identity, work);
    }
    try { return await work; }
    finally { if (this.pending.get(identity) === work) this.pending.delete(identity); }
  }

  async forget(host: string) {
    this.epochs.set(host, (this.epochs.get(host) ?? 0) + 1);
    await this.store.forget(await digest(host));
  }
}
