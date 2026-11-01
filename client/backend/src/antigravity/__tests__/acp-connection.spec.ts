import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpConnection } from '../acp-connection';

const connections: AcpConnection[] = [];
afterEach(async () => { await Promise.all(connections.splice(0).map(connection => connection.close())); });

function connect(script: string, overrides: Partial<ConstructorParameters<typeof AcpConnection>[0]> = {}) {
  const options = { command: process.execPath, args: ['-e', script], cwd: process.cwd(), env: process.env,
    onRequest: vi.fn(async () => ({ outcome: { outcome: 'selected', optionId: 'reject_once' } })),
    onNotification: vi.fn(), onClose: vi.fn(), ...overrides };
  const connection = new AcpConnection(options);
  connections.push(connection);
  connection.start();
  return { connection, options };
}

describe('ACP duplex process boundary', () => {
  it('answers a native permission request whose ID collides with the prompt before settling that prompt', async () => {
    const { connection, options } = connect(`
      const rl = require('node:readline').createInterface({input:process.stdin});
      rl.on('line', line => {
        const v = JSON.parse(line);
        if(v.method) {
          const request = JSON.stringify({jsonrpc:'2.0',id:v.id,method:'session/request_permission',params:{sessionId:'s',toolCall:{toolCallId:'edit'},options:[{optionId:'reject_once',kind:'reject_once',name:'Reject'}]}})+'\\n';
          process.stdout.write(request.slice(0,19)); setTimeout(()=>process.stdout.write(request.slice(19)),5);
        } else {
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'tool_call_update',toolCallId:'edit',status:'failed'}}})+'\\n');
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:v.id,result:{stopReason:'end_turn',choice:v.result.outcome.optionId}})+'\\n');
        }
      });
    `);
    await expect(connection.request('session/prompt', { sessionId: 's', prompt: [] })).resolves.toStrictEqual({ stopReason: 'end_turn', choice: 'reject_once' });
    expect(options.onRequest).toHaveBeenCalledWith('session/request_permission', { sessionId: 's', toolCall: { toolCallId: 'edit' }, options: [{ optionId: 'reject_once', kind: 'reject_once', name: 'Reject' }] });
    expect(options.onNotification).toHaveBeenCalledWith('session/update', { sessionId: 's', update: { sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'failed' } });
  });

  it.each([
    ['EOF', "process.stdin.once('data',()=>process.exit(0))", 'ended'],
    ['malformed JSON', "process.stdin.once('data',()=>process.stdout.write('{bad}\\n'))", 'Invalid'],
    ['oversized partial frame', "process.stdin.once('data',()=>process.stdout.write('x'.repeat(1025)))", 'oversized'],
  ])('rejects pending work on %s without a false success', async (_name, script, message) => {
    const { connection, options } = connect(script, { maxFrameBytes: 1024 });
    await expect(connection.request('session/prompt', {})).rejects.toThrow(message);
    await connection.close();
    expect(options.onClose).toHaveBeenCalledTimes(1);
  });

  it('times out hung work, rejects all pending calls, and makes teardown idempotent', async () => {
    const { connection, options } = connect('process.stdin.resume(); setInterval(()=>{},1000)');
    const first = connection.request('session/prompt', {}, 100);
    const second = connection.request('session/new', {});
    await Promise.all([expect(first).rejects.toThrow('timed out'), expect(second).rejects.toThrow('timed out')]);
    await Promise.all([connection.close(), connection.close()]);
    expect(options.onClose).toHaveBeenCalledTimes(1);
    await expect(connection.request('session/new', {})).rejects.toThrow('timed out');
  });

  it('reports native login once without exposing its URL, including a split stderr marker', async () => {
    const onLoginRequired = vi.fn();
    const { connection } = connect(`
      process.stderr.write('Open the following link to authenticate');
      setTimeout(() => process.stderr.write(' the ACP server: https://example.invalid/private-token\\n'), 10);
      process.stdin.resume();
    `, { onLoginRequired });
    await vi.waitFor(() => expect(onLoginRequired).toHaveBeenCalledExactlyOnceWith());
    await connection.close();
  });
});
