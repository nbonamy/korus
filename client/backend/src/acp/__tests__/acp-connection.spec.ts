import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpConnection } from '../acp-connection';

const connections: AcpConnection[] = [];
afterEach(async () => { await Promise.all(connections.splice(0).map(connection => connection.close())); });

function connect(script: string, overrides: Partial<ConstructorParameters<typeof AcpConnection>[0]> = {}) {
  const options = { displayName: 'Fixture', command: process.execPath, args: ['-e', script], cwd: process.cwd(), env: process.env,
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
    ['oversized complete frame', "process.stdin.once('data',()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:'x'.repeat(1025)})+'\\n'))", 'oversized'],
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

  it('reports only the configured login marker once across split stderr chunks, without exposing diagnostics', async () => {
    const onLoginRequired = vi.fn();
    const { connection, options } = connect(`
      process.stderr.write('unrelated https://example.invalid/private-token\\n');
      process.stderr.write('Fixture sign');
      setImmediate(() => {
        process.stderr.write(' in: https://example.invalid/private-token\\nFixture sign in:');
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'ready',params:{}})+'\\n');
      });
      process.stdin.resume();
    `, { onLoginRequired, loginRequiredMarker: 'Fixture sign in:' });
    await vi.waitFor(() => expect(onLoginRequired).toHaveBeenCalledExactlyOnceWith());
    expect(options.onNotification).toHaveBeenCalledWith('ready', {});
    await connection.close();
    expect(options.onClose).toHaveBeenCalledExactlyOnceWith(new Error('Fixture connection closed.'));
  });

  it('rejects pending calls on explicit close and keeps the provider label in sanitized errors', async () => {
    const { connection, options } = connect(`
      const rl = require('node:readline').createInterface({input:process.stdin});
      rl.on('line', () => process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'received',params:{}})+'\\n'));
    `);
    const pending = Promise.all([
      expect(connection.request('session/prompt', {})).rejects.toThrow('Fixture connection closed.'),
      expect(connection.request('session/new', {})).rejects.toThrow('Fixture connection closed.'),
    ]);
    await vi.waitFor(() => expect(options.onNotification).toHaveBeenCalledTimes(2));
    await Promise.all([pending, connection.close(), connection.close()]);
    expect(options.onClose).toHaveBeenCalledExactlyOnceWith(new Error('Fixture connection closed.'));
    await expect(connection.request('session/new', {})).rejects.toThrow('Fixture connection closed.');
  });

  it('uses the provider label but never the native error message or data in RPC failures', async () => {
    const { connection, options } = connect(`
      process.stdin.once('data', () => process.stdout.write(JSON.stringify({
        jsonrpc:'2.0',id:1,error:{code:-32000,message:'https://example.invalid/private-token',data:{secret:'private-token'}}
      })+'\\n'));
    `);
    await expect(connection.request('session/new', {})).rejects.toThrow('Fixture ACP request failed (-32000).');
    expect(options.onClose).not.toHaveBeenCalled();
  });

  it('drains stderr without reporting login when no marker is configured', async () => {
    const onLoginRequired = vi.fn();
    const { connection, options } = connect(`
      process.stderr.write('Fixture sign in: https://example.invalid/private-token\\n');
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'ready',params:{}})+'\\n');
      process.stdin.resume();
    `, { onLoginRequired });
    await vi.waitFor(() => expect(options.onNotification).toHaveBeenCalledWith('ready', {}));
    expect(onLoginRequired).not.toHaveBeenCalled();
    await connection.close();
  });

  it.skipIf(process.platform === 'win32')('tears down owned descendants when the runtime ignores EOF and SIGTERM', async () => {
    const { connection, options } = connect(`
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      process.on('SIGTERM',()=>{});
      process.stdin.resume();
      setInterval(()=>{},1000);
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'ready',params:{pid:process.pid,childPid:child.pid}})+'\\n');
    `);
    await vi.waitFor(() => expect(options.onNotification).toHaveBeenCalledWith('ready', expect.anything()));
    const { pid, childPid } = vi.mocked(options.onNotification).mock.calls[0]![1] as { pid: number; childPid: number };
    await connection.close();
    await vi.waitFor(() => {
      for (const ownedPid of [pid, childPid]) expect(() => process.kill(ownedPid, 0)).toThrow();
    });
    expect(options.onClose).toHaveBeenCalledTimes(1);
  });
});
