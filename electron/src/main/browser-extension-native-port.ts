import { spawn, type ChildProcess } from 'node:child_process';
import { endianness } from 'node:os';
import path from 'node:path';

/** Chromium native messaging framing. Never log payloads or host stderr. */
export class BrowserExtensionNativePort {
  readonly ready: Promise<void>;
  private readonly child: ChildProcess;
  private buffered = Buffer.alloc(0);
  private closed = false;

  constructor(
    executable: string,
    origin: string,
    private readonly receive: (value: unknown) => void,
    private readonly disconnected: (reason?: string) => void,
  ) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) =>
        /^(HOME|USER|LOGNAME|SHELL|PATH|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|__CF_USER_TEXT_ENCODING|XDG_RUNTIME_DIR|DISPLAY|WAYLAND_DISPLAY|DBUS_SESSION_BUS_ADDRESS)$/.test(
          name,
        ),
      ),
    );
    this.child = spawn(executable, [origin], {
      cwd: path.dirname(executable),
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.ready = new Promise((resolve, reject) => {
      this.child.once('spawn', resolve);
      this.child.once('error', () => reject(new Error('Could not start the native desktop host.')));
    });
    this.child.on('error', () => this.close('Could not start the native desktop host.'));
    this.child.once('close', () => this.close('The native desktop host disconnected.'));
    this.child.stdin!.on('error', () => this.close('The native desktop connection closed.'));
    this.child.stdout!.on('error', () => this.close('The native desktop connection closed.'));
    this.child.stdout!.once('end', () => this.close('The native desktop host disconnected.'));
    this.child.stdout!.on('data', (chunk: Buffer) => this.read(chunk));
  }

  send(value: unknown): void {
    if (this.closed) throw new Error('The native desktop connection is closed.');
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      throw new Error('Native messages must be JSON values.');
    }
    if (json === undefined) throw new Error('Native messages must be JSON values.');
    const bytes = Buffer.from(json, 'utf8');
    if (bytes.length > 64 * 1024 * 1024) throw new Error('Native message is too large.');
    const prefix = Buffer.alloc(4);
    if (endianness() === 'LE') prefix.writeUInt32LE(bytes.length);
    else prefix.writeUInt32BE(bytes.length);
    this.child.stdin!.write(Buffer.concat([prefix, bytes]), (error) => {
      if (error) this.close('The native desktop connection closed.');
    });
  }

  private read(chunk: Buffer): void {
    if (this.closed) return;
    this.buffered = Buffer.concat([this.buffered, chunk]);
    while (this.buffered.length >= 4) {
      const count = endianness() === 'LE' ? this.buffered.readUInt32LE() : this.buffered.readUInt32BE();
      if (!count || count > 1024 * 1024) {
        this.close('Invalid native message size.');
        return;
      }
      if (this.buffered.length - 4 < count) return;
      const contents = this.buffered.subarray(4, count + 4);
      this.buffered = this.buffered.subarray(count + 4);
      let value: unknown;
      try {
        value = JSON.parse(contents.toString('utf8'));
      } catch {
        this.close('Invalid native message format.');
        return;
      }
      this.receive(value);
      if (this.closed) return;
    }
  }

  close(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.buffered = Buffer.alloc(0);
    this.child.stdin?.destroy();
    this.child.stdout?.destroy();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
      const force = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
      }, 1000);
      force.unref();
      this.child.once('exit', () => clearTimeout(force));
    }
    this.disconnected(reason);
  }
}
