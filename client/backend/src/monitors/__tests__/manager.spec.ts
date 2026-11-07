import { afterEach, expect, it, vi } from 'vitest';
import { type MonitorEvent, MonitorManager } from '../manager';
const managers: MonitorManager[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});
function setup() {
  const deliver = vi.fn(async (_owner: string, _event: MonitorEvent) => true);
  const manager = new MonitorManager(deliver);
  managers.push(manager);
  return { manager, deliver };
}
const command = (source: string) =>
  `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
it('collects completion-only output and reports nonzero exit with stderr', async () => {
  const { manager, deliver } = setup();
  const run = manager.start('owner', process.cwd(), {
    command: command(
      "console.log('result');console.error('details');process.exitCode=7",
    ),
    delivery: 'onCompletion',
    name: 'check',
    timeoutSeconds: 10,
  });
  await vi.waitFor(() => expect(deliver).toHaveBeenCalled());
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(deliver.mock.calls[0]![1]).toMatchObject({
    id: run.id,
    state: 'failed',
    stdout: 'result\n',
    stderr: 'details\n',
    exitCode: 7,
  });
  expect(manager.list('other')).toEqual([]);
  expect(() => manager.stop('other', run.id)).toThrow('not found');
});
it('delivers progressive events before completion and stops without waking the owner', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { manager, deliver } = setup();
  const run = manager.start('owner', process.cwd(), {
    command: command("console.log('ready');setInterval(()=>{},1000)"),
    delivery: 'progressive',
    name: 'watch',
    timeoutSeconds: 10,
  });
  await vi.waitFor(() => expect(manager.list('owner')[0]!.stdout).toBe('ready\n'), { interval: 1 });
  await vi.advanceTimersByTimeAsync(500);
  await manager.flush('owner');
  expect(deliver.mock.calls[0]![1]).toMatchObject({
    state: 'running',
    stdout: 'ready\n',
  });
  manager.stop('owner', run.id);
  await vi.waitFor(() =>
    expect(manager.list('owner')[0]!.state).toBe('cancelled'),
  );
  expect(deliver).toHaveBeenCalledTimes(1);
});
it('delivers progressive output without a trailing newline while the command runs', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { manager, deliver } = setup();
  const run = manager.start('owner', process.cwd(), {
    command: command("process.stdout.write('ready');setInterval(()=>{},1000)"),
    delivery: 'progressive',
    name: 'watch',
    timeoutSeconds: 10,
  });
  await vi.waitFor(() => expect(manager.list('owner')[0]!.stdout).toBe('ready'), { interval: 1 });
  await vi.advanceTimersByTimeAsync(500);
  await manager.flush('owner');
  expect(deliver.mock.calls[0]![1]).toMatchObject({ state: 'running', stdout: 'ready' });
  manager.stop('owner', run.id);
});
it('bounds output and retains events while delivery is unavailable', async () => {
  const { manager, deliver } = setup();
  deliver.mockResolvedValue(false);
  const run = manager.start('owner', process.cwd(), {
    command: command("console.log('x'.repeat(100000))"),
    delivery: 'onCompletion',
    name: 'large',
    timeoutSeconds: 10,
  });
  await vi.waitFor(() =>
    expect(manager.list('owner')[0]!.state).toBe('completed'),
  );
  deliver.mockResolvedValue(true);
  await manager.flush('owner');
  expect(deliver.mock.calls.at(-1)![1]).toMatchObject({
    id: run.id,
    truncated: true,
  });
  expect(deliver.mock.calls.at(-1)![1].stdout.length).toBeLessThanOrEqual(
    65536,
  );
});
it('terminates a timed-out command and reports the timeout', async () => {
  const { manager, deliver } = setup();
  manager.start('owner', process.cwd(), {
    command: command('setInterval(()=>{},1000)'),
    delivery: 'onCompletion',
    name: 'timeout',
    timeoutSeconds: 0.05,
  });
  await vi.waitFor(() => expect(deliver).toHaveBeenCalled());
  expect(deliver.mock.calls[0]![1].state).toBe('timedOut');
});
