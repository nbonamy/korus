import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
test('sharing notice preserves choices, counts foreground time and stays unchanged after enabling', { timeout: 90_000 }, async t => {
  try {
    const { stdout } = await run(process.execPath, [path.join(import.meta.dirname, 'telemetry-consent-dom.mjs')], { timeout: 80_000 });
    t.diagnostic(stdout);
  } catch (error) {
    throw new Error(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
});
