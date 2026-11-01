import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ spawn: vi.fn(), mkdtemp: vi.fn(), rm: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: native.spawn, default: { spawn: native.spawn } }));
vi.mock('node:fs/promises', () => ({
  mkdtemp: native.mkdtemp,
  rm: native.rm,
  default: { mkdtemp: native.mkdtemp, rm: native.rm },
}));
import { IosCompanions } from '../mobile/ios-companion';

function child() {
  const process = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    killed: false,
    exitCode: null as number | null,
    kill: vi.fn(),
  });
  process.kill.mockImplementation(() => {
    process.killed = true;
    return true;
  });
  return process;
}
beforeEach(() => {
  vi.useFakeTimers();
  native.spawn.mockReset();
  native.mkdtemp.mockResolvedValue('/private/mobile-test');
  native.rm.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('owned iOS companion transport', () => {
  it('waits for a framed readiness response on its own socket and kills only its child on detach', async () => {
    const process = child();
    native.spawn.mockReturnValue(process);
    const bridge = new IosCompanions('idb_companion');
    const start = bridge.start('device');
    await Promise.resolve();
    expect(() => bridge.address('device')).toThrow('disconnected');
    process.stdout.write('{"grpc_path":"/private/mobile-test/');
    process.stdout.write('bridge.sock"}\n');
    await start;
    expect(bridge.address('device')).toBe('/private/mobile-test/bridge.sock');
    expect(native.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['--udid', 'device', '--grpc-domain-sock', '/private/mobile-test/bridge.sock']),
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    bridge.stop('device');
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    expect(() => bridge.address('device')).toThrow('disconnected');
    expect(native.rm).toHaveBeenCalledWith('/private/mobile-test', { recursive: true, force: true });
  });

  it('rejects a wrong socket and times out without leaving a helper running', async () => {
    const process = child();
    native.spawn.mockReturnValue(process);
    const bridge = new IosCompanions('idb_companion');
    const start = bridge.start('device');
    await Promise.resolve();
    const failure = expect(start).rejects.toThrow('Invalid');
    process.stdout.write('{"grpc_path":"/other.sock"}\n');
    await failure;
    expect(process.kill).toHaveBeenCalled();
    const stalled = child();
    native.spawn.mockReturnValue(stalled);
    const pending = bridge.start('device');
    await Promise.resolve();
    const timeout = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15_001);
    await timeout;
    expect(stalled.kill).toHaveBeenCalled();
  });

  it('revokes an exited helper instead of reconnecting through the global idb registry', async () => {
    const process = child();
    native.spawn.mockReturnValue(process);
    const bridge = new IosCompanions('idb_companion');
    const start = bridge.start('device');
    await Promise.resolve();
    process.stdout.write('{"grpc_path":"/private/mobile-test/bridge.sock"}\n');
    await start;
    process.exitCode = 1;
    process.emit('exit', 1);
    expect(() => bridge.address('device')).toThrow('disconnected');
    expect(native.spawn).toHaveBeenCalledOnce();
  });
});
