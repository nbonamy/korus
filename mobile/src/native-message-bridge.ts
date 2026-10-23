export type NativeMessagePort = {
  postMessage(message: string): void;
  onmessage?: ((event: { data: string }) => void) | null;
};
export type NativeHandler = { postMessage(message: unknown): Promise<unknown> | void };

/** Android's origin-scoped WebMessageListener supplies this port before bundled pages load. */
export function createNativeMessageBridge(port: NativeMessagePort) {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0; let closed = false;
  port.onmessage = event => {
    let reply: { id?: string; result?: unknown; error?: string };
    try { reply = JSON.parse(event.data); } catch { return; }
    if (!reply || typeof reply.id !== 'string') return;
    const call = pending.get(reply.id); if (!call) return;
    pending.delete(reply.id); clearTimeout(call.timer);
    if (typeof reply.error === 'string') call.reject(new Error(reply.error));
    else call.resolve(reply.result);
  };
  function handler(channel: string): NativeHandler {
    return { postMessage(message) {
      if (closed) return Promise.reject(new Error('Native bridge is closed.'));
      if (channel !== 'native') { port.postMessage(JSON.stringify({ channel, message })); return; }
      if (pending.size >= 128) return Promise.reject(new Error('Native bridge is busy.'));
      const id = String(++nextId);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native request timed out.')); }, 15_000);
        pending.set(id, { resolve, reject, timer });
        try { port.postMessage(JSON.stringify({ id, channel, message })); }
        catch { pending.delete(id); clearTimeout(timer); reject(new Error('Native bridge is unavailable.')); }
      });
    } };
  }
  function dispose() {
    if (closed) return; closed = true; port.onmessage = null;
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Native bridge is closed.')); }
    pending.clear();
  }
  return { handler, dispose };
}
