import type { Stream } from '@libp2p/interface';
import { companionFrameLimit, companionResponseLimit, encodeCompanionFrame, readFirstCompanionFrame } from '@workspace/core/companion-protocol';
import { connectionDiagnostic, connectionError } from './connection-diagnostics';

/** One request on an already authenticated laptop stream. */
export async function requestCompanionStream<Result>(stream: Stream, method: string, args: unknown): Promise<Result> {
  stream.maxReadBufferLength = companionResponseLimit + 4;
  stream.maxWriteBufferLength = companionFrameLimit + 4;
  stream.inactivityTimeout = 20_000;
  const id = crypto.randomUUID();
  const started = Date.now();
  let stage = 'send';
  connectionDiagnostic('rpc.request', { requestId: id, method });
  try {
    stream.send(encodeCompanionFrame({ v: 1, id, method, args }));
    stage = 'half-close';
    await stream.close({ signal: AbortSignal.timeout(5000) });
    stage = 'read';
    const value = await readFirstCompanionFrame(stream, companionResponseLimit);
    stage = 'response';
    if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1 || !('id' in value) || value.id !== id) throw new Error('Invalid companion response.');
    if ('error' in value) { stage = 'operation-denied'; throw new Error('Laptop denied the operation or is unavailable.'); }
    if (!('result' in value)) throw new Error('Invalid companion result.');
    connectionDiagnostic('rpc.reply', { requestId: id, method, elapsedMs: Date.now() - started });
    return value.result as Result;
  } catch (error) {
    connectionDiagnostic('rpc.error', { requestId: id, method, stage, elapsedMs: Date.now() - started, ...connectionError(error) });
    throw error;
  } finally { stream.abort(new Error('Request complete.')); }
}
