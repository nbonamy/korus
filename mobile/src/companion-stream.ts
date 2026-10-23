import { readCompanionResponses } from '@workspace/core/companion-response';
import { isCompanionNotification } from '@workspace/core/companion-notification';
import { decodeAppBackendEvent } from '@workspace/core/backend-protocol/events';
import type { Stream } from '@libp2p/interface';
import {
  companionBackgroundIdleTimeoutMs, companionHeartbeatIntervalMs, companionIdleTimeoutMs, companionRequestTimeoutMs, companionResponseLimit,
  encodeCompanionFrame, isConversationFrame, type CompanionUpdate,
} from '@workspace/core/companion-protocol';
import { connectionDiagnostic, connectionError } from './connection-diagnostics';

/** Why a stream ended; the session reacts to `resume-timeout` by retiring the routes it travelled on. */
export type CompanionDisconnectReason = 'resume-timeout' | 'heartbeat-timeout' | 'heartbeat-failed' | 'open-failed' | 'send-failed' | 'receive-ended';

const resumeProbeTimeoutMs = 2_000;
/** Subscribing or catching up replays a whole conversation, so it gets longer than an ordinary request. */
const conversationLoadTimeoutMs = 60_000;
const conversationLoads = new Set(['conversation.subscribe', 'conversation.synchronize']);
/** A heartbeat may wait this many extra windows while other traffic shows the link is alive. */
const maxHeartbeatExtensions = 2;
const maxAbandoned = 64;
const abandonedRetentionMs = 120_000;

export class CompanionOperationDenied extends Error {
  constructor() { super('Laptop denied the operation or is unavailable.'); }
}

/**
 * How a request's deadline is judged:
 * - `request`: an ordinary operation; a timeout fails that request only.
 * - `heartbeat`: speaks for the link; a timeout fails the stream unless other traffic shows it is alive.
 * - `probe`: the check on returning to the foreground; strict, because a stale route must be found quickly.
 */
type Deadline = 'request' | 'heartbeat' | 'probe';
type Call = { method: string; deadline: Deadline; started: number; armedAt: number; extensions: number; timeoutMs: number; resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> };
type Envelope = { type: 'update'; seq: unknown; update: CompanionUpdate } | { type: 'reply'; id: string; error: boolean; result: unknown };

/** A frame the laptop should never send; `stage` says which check refused it, for the diagnostics. */
class EnvelopeError extends Error {
  constructor(readonly stage: string, message: string) { super(message); }
}

function readEnvelope(raw: unknown): Envelope {
  if (!raw || typeof raw !== 'object' || !('v' in raw) || raw.v !== 1) throw new EnvelopeError('envelope', 'Invalid update envelope.');
  if ('update' in raw) {
    const update = raw.update as CompanionUpdate;
    if (!update || !['workspace', 'conversation', 'notification'].includes(update.type)) throw new EnvelopeError('update', 'Invalid update.');
    if (update.type === 'notification' && !isCompanionNotification(update.notification)) throw new EnvelopeError('update', 'Invalid notification.');
    if (update.type === 'conversation' && !isConversationFrame(decodeAppBackendEvent(update.frame))) throw new EnvelopeError('provider-frame', 'Invalid conversation frame.');
    return { type: 'update', seq: 'seq' in raw ? raw.seq : undefined, update };
  }
  if (!('id' in raw) || typeof raw.id !== 'string' || (!('error' in raw) && !('result' in raw))) throw new EnvelopeError('reply', 'Invalid reply.');
  return { type: 'reply', id: raw.id, error: 'error' in raw, result: 'result' in raw ? raw.result : undefined };
}

const idleTimeout = (active: boolean) => active ? companionIdleTimeoutMs : companionBackgroundIdleTimeoutMs;

/** Ordered duplex RPC and notifications over the authenticated laptop circuit. */
export function createCompanionStream(open: () => Promise<Stream>, update: (value: CompanionUpdate) => void, disconnected: (reason: CompanionDisconnectReason) => void) {
  let stream: Stream | undefined;
  let opening: Promise<Stream> | undefined;
  let closed = false; let sequence = 0; let active = true;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatInFlight = false;
  const streamId = crypto.randomUUID(); const started = Date.now(); let lastReceived = started;
  const pending = new Map<string, Call>();
  // Requests that timed out alone: their replies may still arrive and are not a protocol violation.
  // Insertion order is expiry order, so the oldest entries are always the first to go.
  const abandoned = new Map<string, number>();
  const log = (event: string, details: Parameters<typeof connectionDiagnostic>[1] = {}) => {
    const oldest = pending.values().next().value;
    connectionDiagnostic(event, { streamId, elapsedMs: Date.now() - started, idleMs: Date.now() - lastReceived, sequence, pending: pending.size,
      ...(oldest ? { oldestMethod: oldest.method, oldestAgeMs: Date.now() - oldest.started } : {}), ...details });
  };

  function abandon(id: string) {
    const now = Date.now();
    for (const [key, expires] of abandoned) { if (expires > now) break; abandoned.delete(key); }
    while (abandoned.size >= maxAbandoned) abandoned.delete(abandoned.keys().next().value!);
    abandoned.set(id, now + abandonedRetentionMs);
  }

  // Deadlines pause in the background: a frozen page would otherwise fail everything the moment it thaws.
  function armDeadline(id: string, call: Call) {
    clearTimeout(call.timer);
    if (!active) { call.timer = undefined; return; }
    call.armedAt = Date.now();
    call.timer = setTimeout(() => onDeadline(id, call), call.timeoutMs);
  }

  function onDeadline(id: string, call: Call) {
    if (call.deadline === 'request') {
      // A slow operation fails alone; only the heartbeat speaks for the link.
      log('updates.request-timeout', { requestId: id, method: call.method, reason: 'isolated' });
      pending.delete(id); abandon(id); call.reject(new Error('Request timed out.'));
      return;
    }
    // The laptop answers in order, so a heartbeat can sit behind slow work while its other traffic still arrives.
    if (call.deadline === 'heartbeat' && lastReceived > call.armedAt && call.extensions++ < maxHeartbeatExtensions) {
      log('updates.deadline-extended', { requestId: id, method: call.method });
      armDeadline(id, call);
      return;
    }
    log('updates.request-timeout', { requestId: id, method: call.method });
    fail(call.deadline === 'probe' ? 'resume-timeout' : 'heartbeat-timeout');
  }

  function startHeartbeat() {
    clearInterval(heartbeat);
    if (!active || closed) return;
    heartbeat = setInterval(() => {
      if (heartbeatInFlight) return;
      heartbeatInFlight = true;
      request('ping', {}, { deadline: 'heartbeat' }).catch(() => fail('heartbeat-failed')).finally(() => { heartbeatInFlight = false; });
    }, companionHeartbeatIntervalMs);
  }

  function close() {
    if (closed) return;
    log('updates.close');
    closed = true; clearInterval(heartbeat);
    stream?.abort(new Error('Updates closed.'));
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Disconnected.')); }
    pending.clear();
  }

  function fail(reason: CompanionDisconnectReason) { if (!closed) { log('updates.disconnect', { reason }); close(); disconnected(reason); } }

  async function connect() {
    if (closed) throw new Error('Disconnected.');
    return opening ??= open().then((next) => {
      if (closed) { next.abort(new Error('Closed.')); throw new Error('Disconnected.'); }
      stream = next;
      log('updates.open');
      stream.maxReadBufferLength = companionResponseLimit + 4;
      stream.inactivityTimeout = idleTimeout(active);
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
        const envelope = readEnvelope(raw);
        if (envelope.type === 'update') {
          stage = 'sequence';
          if (envelope.seq !== ++sequence) throw new Error('Update sequence gap.');
          stage = 'update-handler'; update(envelope.update);
        } else {
          stage = 'reply';
          const call = pending.get(envelope.id);
          if (!call) {
            if (!abandoned.delete(envelope.id)) throw new Error('Unmatched reply.');
            log('updates.late-reply', { requestId: envelope.id });
          } else {
            pending.delete(envelope.id); clearTimeout(call.timer);
            log('updates.reply', { requestId: envelope.id, method: call.method, elapsedMs: Date.now() - call.started, reason: envelope.error ? 'denied' : 'success' });
            if (envelope.error) call.reject(new CompanionOperationDenied()); else call.resolve(envelope.result);
          }
        }
        stage = 'read';
      }
    } catch (error) { if (!closed) log('updates.receive-error', { stage: error instanceof EnvelopeError ? error.stage : stage, ...connectionError(error) }); }
    finally { fail('receive-ended'); }
  }

  async function request<T>(method: string, args: unknown, options: { deadline?: Deadline; timeoutMs?: number } = {}): Promise<T> {
    const channel = await connect();
    if (closed || pending.size >= 128) throw new Error('Update channel unavailable.');
    const id = crypto.randomUUID();
    const deadline = options.deadline ?? 'request';
    return new Promise<T>((resolve, reject) => {
      const call: Call = { method, deadline, started: Date.now(), armedAt: Date.now(), extensions: 0, timeoutMs: options.timeoutMs ?? (conversationLoads.has(method) ? conversationLoadTimeoutMs : companionRequestTimeoutMs), resolve: (value) => resolve(value as T), reject };
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
    if (stream) stream.inactivityTimeout = idleTimeout(active);
    for (const [id, call] of pending) armDeadline(id, call);
    if (active && stream) startHeartbeat();
    // Do not open a connection solely to report background presence on a locked cold launch.
    if (active && opening) { await opening; if (!closed) await request('ping', {}, { deadline: 'probe', timeoutMs: resumeProbeTimeoutMs }); }
  }

  return { request: <T>(method: string, args: unknown) => request<T>(method, args), close, setActive };
}
