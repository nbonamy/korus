// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runMobileCommand } from '../mobile/commands';

describe('bounded native mobile commands', () => {
  it('preserves binary stdout and passes text as an argument without a shell', async () => {
    const bytes = await runMobileCommand(process.execPath, [
      '-e',
      'process.stdout.write(Buffer.from([0,137,255]));process.stdout.write(process.argv[1])',
      '$(not-a-command)',
    ]);
    expect(bytes).toStrictEqual(Buffer.concat([Buffer.from([0, 137, 255]), Buffer.from('$(not-a-command)')]));
  });
  it('bounds hanging processes and keeps native stderr and arguments out of errors', async () => {
    await expect(runMobileCommand(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], 30)).rejects.toThrow(
      'timed out',
    );
    const error = await runMobileCommand(process.execPath, [
      '-e',
      'console.error("sensitive input");process.exit(1)',
    ]).catch((error) => error);
    expect(error.message).toContain('failed');
    expect(error.message).not.toContain('sensitive');
  });
});
