import { readCompanionResponses } from '@workspace/core/companion-response';
import { isCompanionNotification } from '@workspace/core/companion-notification';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import type { Stream } from '@libp2p/interface';
import { companionBackgroundGraceMs, companionResponseLimit, encodeCompanionFrame, type CompanionUpdate } from '@workspace/core/companion-protocol';
import { connectionDiagnostic, connectionError } from './connection-diagnostics';

const resumeProbeTimeoutMs = 2_000;

export class CompanionOperationDenied extends Error {
  constructor() { super('Laptop denied the operation or is unavailable.'); }
}

/** Ordered duplex RPC and notifications over the authenticated laptop circuit. */
export function createCompanionStream(open: () => Promise<Stream>, update: (value: CompanionUpdate) => void, disconnected: (reason?: string) => void) {
  let stream: Stream | undefined;
  let opening: Promise<Stream> | undefined;
  let closed = false; let sequence = 0; let active = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const streamId = crypto.randomUUID(); const started = Date.now(); let lastReceived = started;
  const log = (event: string, details: Parameters<typeof connectionDiagnostic>[1] = {}) => {
    const oldest = pending.values().next().value;
    connectionDiagnostic(event, { streamId, elapsedMs: Date.now() - started, idleMs: Date.now() - lastReceived, sequence, pending: pending.size,
      ...(oldest ? { oldestMethod: oldest.method, oldestAgeMs: Date.now() - oldest.started } : {}), ...details });
  };
  const pending = new Map<string, { method: string; started: number; timeoutMs: number; resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }>();
  function armDeadline(id: string, call: NonNullable<ReturnType<typeof pending.get>>) {
    clearTimeout(call.timer);
    call.timer = active ? setTimeout(() => { log('updates.request-timeout', { requestId: id, method: call.method }); fail(call.timeoutMs === resumeProbeTimeoutMs ? 'resume-timeout' : 'request-timeout'); }, call.timeoutMs) : undefined;
  }
  function startHeartbeat() {
    clearInterval(heartbeat);
    if (active && !closed) heartbeat = setInterval(() => { void request('ping', {}).catch(() => fail('heartbeat-failed')); }, 15_000);
  }
  function close() {
    if (closed) return;
    log('updates.close');
    closed = true; clearInterval(heartbeat);
    stream?.abort(new Error('Updates closed.'));
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Disconnected.')); }
    pending.clear();
  }
  function fail(reason: string) { if (!closed) { log('updates.disconnect', { reason }); close(); disconnected(reason); } }
  async function connect() {
    if (closed) throw new Error('Disconnected.');
    return opening ??= open().then((next) => {
      if (closed) { next.abort(new Error('Closed.')); throw new Error('Disconnected.'); }
      stream = next;
      log('updates.open');
      stream.maxReadBufferLength = companionResponseLimit + 4;
      stream.inactivityTimeout = active ? 45_000 : companionBackgroundGraceMs + 45_000;
      void receive(next);
      startHeartbeat();
      return next;
    }).catch((error) => { log('updates.open-error', connectionError(error)); fail('open-failed'); throw error; });
  }
  async function receive(source: Stream) {
    let stage = 'read';
    try {
      for await (const raw of readCompanionResponses(source)) {
        if (closed) return;
        lastReceived = Date.now();
        stage = 'envelope';
        if (!raw || typeof raw !== 'object' || !('v' in raw) || raw.v !== 1) throw new Error('Invalid update envelope.');
        if ('update' in raw) {
          stage = 'sequence';
          if (!('seq' in raw) || raw.seq !== ++sequence) throw new Error('Update sequence gap.');
          stage = 'update';
          const value = raw.update as CompanionUpdate;
          if (!value || !['workspace', 'conversation', 'notification'].includes(value.type)) throw new Error('Invalid update.');
          if (value.type === 'notification' && !isCompanionNotification(value.notification)) throw new Error('Invalid notification.');
          if (value.type === 'conversation') {
            stage = 'provider-frame';
            const frame = decodeAppBackendEvent(value.frame);
            if (!/^(codex|claude|antigravity)\.conversation(SnapshotChanged|EventReceived)$/.test(frame.type)) throw new Error('Invalid conversation frame.');
          }
          stage = 'update-handler'; update(value);
        } else {
          stage = 'reply';
          if (!('id' in raw) || typeof raw.id !== 'string') throw new Error('Invalid reply.');
          const call = pending.get(raw.id);
          if (!call) throw new Error('Unmatched reply.');
          if (!('error' in raw) && !('result' in raw)) throw new Error('Invalid reply.');
          pending.delete(raw.id); clearTimeout(call.timer);
          log('updates.reply', { requestId: raw.id, method: call.method, elapsedMs: Date.now() - call.started, reason: 'error' in raw ? 'denied' : 'success' });
          if ('error' in raw) call.reject(new CompanionOperationDenied());
          else if ('result' in raw) call.resolve(raw.result);
          else throw new Error('Invalid reply.');
        }
        stage = 'read';
      }
    } catch (error) { if (!closed) log('updates.receive-error', { stage, ...connectionError(error) }); }
    finally { fail('receive-ended'); }
  }
  async function request<T>(method: string, args: unknown, timeoutMs = 15_000): Promise<T> {
    const channel = await connect();
    if (closed || pending.size >= 128) throw new Error('Update channel unavailable.');
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const call = { method, started: Date.now(), timeoutMs, resolve: (value: unknown) => resolve(value as T), reject };
      pending.set(id, call); armDeadline(id, call);
      log('updates.request', { requestId: id, method });
      try { channel.send(encodeCompanionFrame({ v: 1, id, method, args })); }
      catch (error) { log('updates.send-error', { requestId: id, method, ...connectionError(error) }); fail('send-failed'); }
    });
  }
  async function setActive(next: boolean) {
    if (closed) return;
    active = next;
    clearInterval(heartbeat);
    if (stream) stream.inactivityTimeout = active ? 45_000 : companionBackgroundGraceMs + 45_000;
    for (const [id, call] of pending) armDeadline(id, call);
    if (active && stream) startHeartbeat();
    // Do not open a connection solely to report background presence on a locked cold launch.
    if (active && opening) { await opening; if (!closed) await request('ping', {}, resumeProbeTimeoutMs); }
  }
  return { request, close, setActive };
}
