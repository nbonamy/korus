import { describe, expect, it, vi } from 'vitest';
import { ProviderUpdates } from '../provider-updates';

function setup() {
  let busy = false;
  const installation = { executable: '/bin/codex', version: '1.0.0', latestVersion: '1.1.0', method: 'npm' as const, channel: 'latest', identity: 'npm:/bin/codex:1.0.0', command: { file: '/bin/npm', args: ['install', '-g', '@openai/codex@1.1.0'] } };
  const inspect = vi.fn(async () => installation);
  const upgrade = vi.fn(async () => { installation.version = '1.1.0'; });
  const restart = vi.fn(async (_backend, work: () => Promise<void>) => { await work(); });
  const updates = new ProviderUpdates({ inspect, upgrade, withStoppedProvider: restart, busy: () => busy });
  return { updates, inspect, upgrade, restart, installation, setBusy: (value: boolean) => { busy = value; } };
}

describe('provider upgrades', () => {
  it('checks without installing and upgrades only with explicit fresh consent', async () => {
    const f = setup();
    const checked = await f.updates.get('codex', true);
    expect(checked).toMatchObject({ status: 'available', installedVersion: '1.0.0', latestVersion: '1.1.0' });
    expect(f.upgrade).not.toHaveBeenCalled();
    expect(() => f.updates.request('codex', { action: 'upgrade', confirmed: false, token: checked.token })).toThrow();
    f.updates.request('codex', { action: 'upgrade', confirmed: true, token: checked.token });
    await f.updates.settle();
    expect(f.upgrade).toHaveBeenCalledTimes(1);
    expect(f.restart).toHaveBeenCalledTimes(1);
    expect(await f.updates.get('codex')).toMatchObject({ status: 'current', installedVersion: '1.1.0' });
  });

  it('waits without interrupting busy agents and allows cancellation', async () => {
    const f = setup();
    const checked = await f.updates.get('codex');
    f.setBusy(true);
    expect(f.updates.request('codex', { action: 'upgrade', confirmed: true, token: checked.token })).toMatchObject({ status: 'waiting' });
    await f.updates.tick();
    expect(f.restart).not.toHaveBeenCalled();
    f.updates.request('codex', { action: 'cancel' });
    f.setBusy(false);
    await f.updates.tick();
    expect(f.upgrade).not.toHaveBeenCalled();
    expect(await f.updates.get('codex')).toMatchObject({ status: 'available' });
  });

  it('runs a waiting upgrade once idle, blocks admissions only while upgrading, and coalesces duplicate clicks', async () => {
    const f = setup();
    const checked = await f.updates.get('codex');
    f.setBusy(true);
    const input = { action: 'upgrade' as const, confirmed: true, token: checked.token };
    f.updates.request('codex', input);
    expect(f.updates.isUpdating('codex')).toBe(false);
    f.setBusy(false);
    const pending = f.updates.tick();
    expect(f.updates.isUpdating('codex')).toBe(true);
    f.updates.request('codex', input);
    await pending;
    expect(f.upgrade).toHaveBeenCalledTimes(1);
    expect(f.updates.isUpdating('codex')).toBe(false);
  });

  it('refuses to update a different installation discovered after consent', async () => {
    const f = setup();
    const checked = await f.updates.get('codex');
    f.installation.identity = 'another-installation';
    f.updates.request('codex', { action: 'upgrade', confirmed: true, token: checked.token });
    await f.updates.settle();
    expect(f.upgrade).not.toHaveBeenCalled();
    expect(await f.updates.get('codex')).toMatchObject({ status: 'error', error: 'installationChanged' });
  });

  it('reports a failed upgrade instead of claiming success, retaining the installed version', async () => {
    const f = setup();
    const checked = await f.updates.get('codex');
    f.upgrade.mockRejectedValueOnce(new Error('private process output'));
    f.updates.request('codex', { action: 'upgrade', confirmed: true, token: checked.token });
    await f.updates.settle();
    expect(await f.updates.get('codex')).toMatchObject({ status: 'error', error: 'upgradeFailed', installedVersion: '1.0.0' });
    expect(JSON.stringify(await f.updates.get('codex'))).not.toContain('private process output');
  });

  it('does not offer an executable upgrade for custom installations or missing providers', async () => {
    const f = setup();
    f.inspect.mockResolvedValueOnce({ ...f.installation, command: undefined } as never);
    const manual = await f.updates.get('codex');
    expect(manual).toMatchObject({ canUpgrade: false });
    expect(() => f.updates.request('codex', { action: 'upgrade', confirmed: true, token: manual.token })).toThrow();
  });

  it('does not claim a prerelease is current or replace it with a stable release', async () => {
    const f = setup();
    f.installation.version = '1.1.0-alpha.1';
    expect(await f.updates.get('codex')).toMatchObject({ status: 'manual', canUpgrade: false });
    expect(f.upgrade).not.toHaveBeenCalled();
  });

  it('refuses stale consent during a refresh without racing the admission lock', async () => {
    const f = setup();
    const checked = await f.updates.get('codex');
    let complete!: () => void;
    f.inspect.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve(f.installation); }));
    const pending = f.updates.get('codex', true);
    expect(() => f.updates.request('codex', { action: 'upgrade', confirmed: true, token: checked.token })).toThrow('check');
    complete(); await pending;
    expect(f.upgrade).not.toHaveBeenCalled();
  });

  it('does not report success when the installer exits successfully without updating the executable', async () => {
    const f = setup();
    f.upgrade.mockImplementationOnce(async () => {});
    const checked = await f.updates.get('codex');
    f.updates.request('codex', { action: 'upgrade', confirmed: true, token: checked.token });
    await f.updates.settle();
    expect(await f.updates.get('codex')).toMatchObject({ status: 'error', error: 'verificationFailed', installedVersion: '1.0.0' });
  });
});
