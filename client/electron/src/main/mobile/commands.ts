import { execFile, spawn } from 'node:child_process';

/** No shell; binary output, bounded memory and an outer deadline for every native call. */
export function runMobileCommand(file: string, args: string[], timeout = 15_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'buffer', timeout, maxBuffer: 12 * 1024 * 1024, killSignal: 'SIGKILL' },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              `${file.split('/').pop()} failed${error.killed ? ' or timed out' : ''}. Check that the emulator and its bridge are running.`,
            ),
          );
        else resolve(stdout);
      },
    );
  });
}

/** Starts a long-lived tool (an emulator) that must outlive this app and never inherit its stdio. */
export function startMobileProcess(file: string, args: string[]): void {
  const child = spawn(file, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}
