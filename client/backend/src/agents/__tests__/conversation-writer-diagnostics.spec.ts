import { expect, it, vi } from 'vitest';
import { conversationWriterDiagnostics } from '../conversation-writer-diagnostics';

it('identifies candidate Codex processes and separates their homes without logging unrelated open files', async () => {
  const run = vi.fn(async (program: string) => program === 'ps'
    ? '100 1 /opt/bin/codex\n200 99 /other/bin/codex\n300 1 /opt/bin/node\n'
    : 'p100\nn/home/user/.codex/state_5.sqlite\nn/private/secret.txt\np200\nn/home/user/.korus/codex-home/state_5.sqlite-wal\nn/home/user/.korus/codex-home/logs_2.sqlite\n');
  const result = await conversationWriterDiagnostics(run, 'darwin');
  expect(result.processes).toStrictEqual([
    { pid: 100, parentPid: 1, executable: '/opt/bin/codex', stateHomes: ['/home/user/.codex'] },
    { pid: 200, parentPid: 99, executable: '/other/bin/codex', stateHomes: ['/home/user/.korus/codex-home'] },
  ]);
  expect(run).toHaveBeenLastCalledWith('lsof', ['-a', '-p', '100,200', '-Fn']);
});

it('keeps candidate process diagnostics useful when lsof is unavailable', async () => {
  const result = await conversationWriterDiagnostics(async program => {
    if (program === 'ps') return '100 1 /opt/bin/codex';
    throw new Error('not installed');
  }, 'linux');
  expect(result.processes).toStrictEqual([{ pid: 100, parentPid: 1, executable: '/opt/bin/codex', stateHomes: [] }]);
});

it('does not invoke POSIX process tools on Windows', async () => {
  const run = vi.fn();
  expect(await conversationWriterDiagnostics(run, 'win32')).toStrictEqual({ platform: 'win32', daemonPid: process.pid });
  expect(run).not.toHaveBeenCalled();
});
