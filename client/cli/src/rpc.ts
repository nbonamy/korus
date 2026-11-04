import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { CliError, record, type CliOptions } from './context';

/** A bounded one-shot connection; diagnostics never start or repair the daemon. */
export function request(options: Pick<CliOptions, 'socket' | 'timeout'>, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = randomUUID(); let buffer = ''; let settled = false;
    const socket = net.createConnection(options.socket);
    socket.setEncoding('utf8');
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new CliError(`Daemon request timed out (${method}).`)), options.timeout);
    socket.once('connect', () => socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`));
    socket.once('error', () => finish(new CliError(`Daemon socket unavailable at ${options.socket}.`)));
    socket.once('close', () => finish(new CliError('Daemon closed the connection before replying.')));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) { finish(new CliError('Daemon response exceeded the CLI size limit.')); return; }
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let reply: unknown;
        try { reply = JSON.parse(line); } catch { finish(new CliError('Daemon returned malformed JSON.')); return; }
        if (!record(reply)) continue;
        if ('method' in reply && 'id' in reply) {
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: reply.id, error: { code: -32601, message: 'This CLI cannot handle desktop requests.' } })}\n`); continue;
        }
        if (reply.id !== id) continue;
        if (record(reply.error)) { finish(new CliError(typeof reply.error.message === 'string' ? reply.error.message : 'Daemon rejected the request.')); return; }
        if (!('result' in reply)) { finish(new CliError('Daemon returned an invalid response.')); return; }
        finish(undefined, reply.result); return;
      }
    });
  });
}
