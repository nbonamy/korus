import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type RpcId = string | number;
type Handler = (method: string, params: unknown) => Promise<unknown>;
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** One duplex ACP process. Provider requests and client responses have independent ID spaces. */
export class AcpConnection {
  private child?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<RpcId, Pending>();
  private sequence = 0;
  private buffer = '';
  private ended?: Error;
  private exit?: Promise<void>;
  private closing?: Promise<void>;

  constructor(private readonly options: {
    command: string;
    args?: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    onRequest: Handler;
    onNotification(method: string, params: unknown): void;
    onClose(error: Error): void;
    onLoginRequired?(): void;
    maxFrameBytes?: number;
  }) {}

  start(): void {
    if (this.child || this.ended) throw new Error('ACP connection has already been started or closed.');
    const child = this.child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd, env: this.options.env, shell: false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.exit = new Promise(resolve => {
      child.once('close', () => { this.fail(new Error('Antigravity runtime closed.')); resolve(); });
    });
    child.once('error', () => this.fail(new Error('Could not start Antigravity ACP runtime.')));
    child.stdin.on('error', () => this.fail(new Error('Antigravity input stream closed.')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.receive(chunk));
    child.stdout.once('end', () => {
      this.fail(new Error('Antigravity output stream ended.'));
      void this.close();
    });
    // Recognize only the native login marker. Never expose or persist diagnostics or URLs.
    const marker = 'Open the following link to authenticate the ACP server:';
    let suffix = '';
    let loginReported = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (loginReported || !this.options.onLoginRequired) return;
      const text = suffix + chunk;
      if (text.includes(marker)) { loginReported = true; suffix = ''; this.options.onLoginRequired(); }
      else suffix = text.slice(-(marker.length - 1));
    });
  }

  request(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    if (this.ended) return Promise.reject(this.ended);
    if (!this.child) return Promise.reject(new Error('ACP connection is not started.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Antigravity request timed out: ${method}`));
        void this.close();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.ended) throw this.ended;
    this.write({ jsonrpc: '2.0', method, params });
  }

  close(): Promise<void> {
    return this.closing ??= this.shutdown();
  }

  private async shutdown(): Promise<void> {
    this.fail(new Error('Antigravity connection closed.'));
    if (!this.child) return;
    this.child.stdin.end();
    const term = setTimeout(() => this.signal('SIGTERM'), 300);
    const kill = setTimeout(() => this.signal('SIGKILL'), 1_300);
    try { await this.exit; }
    finally { clearTimeout(term); clearTimeout(kill); this.signal('SIGKILL'); }
  }

  private signal(signal: NodeJS.Signals): void {
    const pid = this.child?.pid;
    if (!pid) return;
    try {
      if (process.platform === 'win32') this.child?.kill(signal);
      else process.kill(-pid, signal);
    } catch { /* The owned process group has already exited. */ }
  }

  private write(message: unknown): void {
    if (this.ended) return;
    try { this.child?.stdin.write(JSON.stringify(message) + '\n'); }
    catch { this.fail(new Error('Could not write to Antigravity.')); }
  }

  private receive(chunk: string): void {
    if (this.ended) return;
    this.buffer += chunk;
    const limit = this.options.maxFrameBytes ?? 8 * 1024 * 1024;
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) break;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > limit) { this.protocolFailure(); return; }
      if (!line.trim()) continue;
      try { this.dispatch(JSON.parse(line)); }
      catch { this.protocolFailure(); return; }
    }
    if (Buffer.byteLength(this.buffer) > limit) this.protocolFailure();
  }

  private dispatch(value: unknown): void {
    if (!record(value) || value.jsonrpc !== '2.0') throw new Error('Invalid ACP envelope');
    // Check method first: inbound request 1 may collide with outstanding client request 1.
    if (typeof value.method === 'string') {
      if (value.id === undefined) { this.options.onNotification(value.method, value.params); return; }
      if (!rpcId(value.id)) throw new Error('Invalid request ID');
      const id = value.id;
      void Promise.resolve().then(() => this.options.onRequest(value.method as string, value.params)).then(
        result => this.write({ jsonrpc: '2.0', id, result: result ?? null }),
        () => this.write({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Client request failed.' } }),
      );
      return;
    }
    if (!rpcId(value.id) || (!('result' in value) && !record(value.error))) throw new Error('Invalid ACP response');
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    clearTimeout(pending.timer);
    if (record(value.error)) pending.reject(new AcpError(typeof value.error.code === 'number' ? value.error.code : -32603));
    else pending.resolve(value.result);
  }

  private protocolFailure(): void {
    this.fail(new Error('Invalid or oversized Antigravity ACP frame.'));
    void this.close();
  }

  private fail(error: Error): void {
    if (this.ended) return;
    this.ended = error;
    this.buffer = '';
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    this.options.onClose(error);
  }
}

class AcpError extends Error {
  constructor(readonly code: number) { super(`Antigravity ACP request failed (${code}).`); }
}

function rpcId(value: unknown): value is RpcId { return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)); }
export function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
