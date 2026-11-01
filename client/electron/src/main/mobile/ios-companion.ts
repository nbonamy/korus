import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Private Unix sockets avoid idb's global registry and any remote companion entries. */
export class IosCompanions {
  private readonly sessions = new Map<
    string,
    { child: ChildProcess; socket: string; directory: string; ready: boolean }
  >();
  constructor(readonly executable: string) {}

  async start(udid: string): Promise<void> {
    this.stop(udid);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mobile-simulator-'));
    const socket = path.join(directory, 'bridge.sock');
    const child = spawn(
      this.executable,
      [
        '--udid',
        udid,
        '--only',
        'simulator',
        '--grpc-domain-sock',
        socket,
        '--terminate-offline',
        '1',
        '--log-level',
        'info',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    this.sessions.set(udid, { child, socket, directory, ready: false });
    try {
      await new Promise<void>((resolve, reject) => {
        let buffer = '';
        const timeout = setTimeout(() => finish(new Error('iOS companion startup timed out.')), 15_000);
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          child.stdout?.off('data', data);
          child.off('error', failed);
          child.off('exit', exited);
          if (error) reject(error);
          else resolve();
        };
        const failed = () =>
          finish(new Error('Could not start idb_companion. Update the app and check Xcode compatibility.'));
        const exited = () =>
          finish(new Error('iOS companion stopped before it was ready. Check Xcode and idb compatibility.'));
        const data = (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.length > 8192) {
            finish(new Error('Invalid iOS companion startup response.'));
            return;
          }
          const newline = buffer.indexOf('\n');
          if (newline < 0) return;
          try {
            const report = JSON.parse(buffer.slice(0, newline));
            if (report.grpc_path !== socket) throw new Error('Wrong socket');
            finish();
          } catch {
            finish(new Error('Invalid iOS companion startup response.'));
          }
        };
        child.once('error', failed);
        child.once('exit', exited);
        child.stdout?.on('data', data);
      });
      const session = this.sessions.get(udid);
      if (!session || session.child !== child) throw new Error('iOS companion startup cancelled.');
      session.ready = true;
      child.once('exit', () => {
        if (this.sessions.get(udid)?.child === child) this.stop(udid);
      });
      child.on('error', () => this.stop(udid));
      child.stdout?.resume();
    } catch (error) {
      this.stop(udid);
      throw error;
    }
  }

  address(udid: string): string {
    const session = this.sessions.get(udid);
    if (!session || !session.ready || session.child.exitCode !== null || session.child.killed)
      throw new Error('iOS bridge disconnected. Detach and attach again.');
    return session.socket;
  }

  stop(udid: string): void {
    const session = this.sessions.get(udid);
    if (!session) return;
    this.sessions.delete(udid);
    session.child.kill('SIGKILL');
    void rm(session.directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
