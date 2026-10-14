import { isCompanionNotification } from '@workspace/core/companion-notification';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import type { Stream } from '@libp2p/interface';
import { CompanionFrameDecoder, companionResponseLimit, encodeCompanionFrame, type CompanionUpdate } from '@workspace/core/companion-protocol';

export class CompanionOperationDenied extends Error {
  constructor() { super('Laptop denied the operation or is unavailable.'); }
}

/** Ordered duplex RPC and notifications over the authenticated laptop circuit. */
export function createCompanionStream(open: () => Promise<Stream>, update: (value: CompanionUpdate) => void, disconnected: () => void) {
  let stream: Stream | undefined;
  let opening: Promise<Stream> | undefined;
  let closed = false; let sequence = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  function close() {
    if (closed) return;
    closed = true; clearInterval(heartbeat);
    stream?.abort(new Error('Updates closed.'));
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Disconnected.')); }
    pending.clear();
  }
  function fail() { if (!closed) { close(); disconnected(); } }
  async function connect() {
    if (closed) throw new Error('Disconnected.');
    return opening ??= open().then((next) => {
      if (closed) { next.abort(new Error('Closed.')); throw new Error('Disconnected.'); }
      stream = next;
      stream.maxReadBufferLength = companionResponseLimit + 4;
      stream.inactivityTimeout = 45_000;
      void receive(next);
      heartbeat = setInterval(() => { void request('ping', {}).catch(fail); }, 15_000);
      return next;
    }).catch((error) => { fail(); throw error; });
  }
  async function receive(source: Stream) {
    const decoder = new CompanionFrameDecoder(companionResponseLimit);
    try {
      for await (const chunk of source) for (const raw of decoder.push(chunk instanceof Uint8Array ? chunk : chunk.subarray())) {
        if (closed) return;
        if (!raw || typeof raw !== 'object' || !('v' in raw) || raw.v !== 1) throw new Error('Invalid update envelope.');
        if ('update' in raw) {
          if (!('seq' in raw) || raw.seq !== ++sequence) throw new Error('Update sequence gap.');
          const value = raw.update as CompanionUpdate;
          if (!value || !['workspace', 'conversation', 'notification'].includes(value.type)) throw new Error('Invalid update.');
          if (value.type === 'notification' && !isCompanionNotification(value.notification)) throw new Error('Invalid notification.');
          if (value.type === 'conversation') {
            const frame = decodeAppBackendEvent(value.frame);
            if (!/^(codex|claude|antigravity)\.conversation(SnapshotChanged|EventReceived)$/.test(frame.type)) throw new Error('Invalid conversation frame.');
          }
          update(value);
        } else {
          if (!('id' in raw) || typeof raw.id !== 'string') throw new Error('Invalid reply.');
          const call = pending.get(raw.id);
          if (!call) throw new Error('Unmatched reply.');
          if (!('error' in raw) && !('result' in raw)) throw new Error('Invalid reply.');
          pending.delete(raw.id); clearTimeout(call.timer);
          if ('error' in raw) call.reject(new CompanionOperationDenied());
          else if ('result' in raw) call.resolve(raw.result);
          else throw new Error('Invalid reply.');
        }
      }
    } catch { /* Missing or malformed frames require an authoritative reconnect. */ }
    finally { fail(); }
  }
  async function request<T>(method: string, args: unknown): Promise<T> {
    const channel = await connect();
    if (closed || pending.size >= 128) throw new Error('Update channel unavailable.');
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(fail, 15_000);
      pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try { channel.send(encodeCompanionFrame({ v: 1, id, method, args })); }
      catch { fail(); }
    });
  }
  return { request, close };
}
