import { describe, expect, it } from 'vitest';
import type { CompanionSession } from '../companion-port';
import { createRemoteList } from '../remote-list';

const session = (name: string) => ({ name }) as unknown as CompanionSession;
function fixture() {
  const env = { current: session('first') as CompanionSession | null, connected: true };
  const list = createRemoteList<string, { repositoryId: string | null }>({ session: () => env.current, connected: () => env.connected }, { repositoryId: null });
  const gate = () => { let release!: (items: string[]) => void; let fail!: () => void; const promise = new Promise<string[]>((resolve, reject) => { release = resolve; fail = () => reject(new Error('no')); }); return { promise, release, fail }; };
  return { env, list, gate };
}

describe('remote list', () => {
  it('moves from idle through loading to loaded or failed, carrying what was asked for', async () => {
    const f = fixture();
    expect(f.list.state.value).toStrictEqual({ status: 'idle', items: [], repositoryId: null });
    const pending = f.gate(); const loading = f.list.load({ repositoryId: 'repo' }, () => pending.promise);
    expect(f.list.state.value).toStrictEqual({ status: 'loading', items: [], repositoryId: 'repo' });
    pending.release(['main']); await loading;
    expect(f.list.state.value).toStrictEqual({ status: 'loaded', items: ['main'], repositoryId: 'repo' });
    const failing = f.gate(); const failed = f.list.load({ repositoryId: 'repo' }, () => failing.promise);
    failing.fail(); await failed;
    expect(f.list.state.value).toStrictEqual({ status: 'failed', items: [], repositoryId: 'repo' });
  });

  it('fails without asking when there is no session or no connection', async () => {
    const f = fixture(); let asked = false;
    f.env.connected = false; await f.list.load({ repositoryId: 'a' }, async () => { asked = true; return []; });
    f.env.connected = true; f.env.current = null; await f.list.load({ repositoryId: 'a' }, async () => { asked = true; return []; });
    expect(asked).toBe(false); expect(f.list.state.value.status).toBe('failed');
  });

  it('drops an answer that arrives after a reset or after the session changed', async () => {
    const f = fixture();
    const first = f.gate(); const stale = f.list.load({ repositoryId: 'a' }, () => first.promise);
    f.list.reset(); first.release(['late']); await stale;
    expect(f.list.state.value).toStrictEqual({ status: 'idle', items: [], repositoryId: null });
    const second = f.gate(); const moved = f.list.load({ repositoryId: 'b' }, () => second.promise);
    f.env.current = session('second'); second.release(['wrong session']); await moved;
    expect(f.list.state.value.status).toBe('loading');
  });

  it('shares one request among concurrent callers and does not ask again once loaded', async () => {
    const f = fixture(); let asked = 0; const pending = f.gate();
    const read = () => { asked++; return pending.promise; };
    const a = f.list.loadOnce({ repositoryId: null }, read); const b = f.list.loadOnce({ repositoryId: null }, read);
    expect(b).toBe(a); pending.release(['x']); await a;
    await f.list.loadOnce({ repositoryId: null }, read);
    expect(asked).toBe(1); expect(f.list.state.value.items).toStrictEqual(['x']);
  });

  it('lets a failed once-only list be asked for again', async () => {
    const f = fixture(); const failing = f.gate();
    const first = f.list.loadOnce({ repositoryId: null }, () => failing.promise); failing.fail(); await first;
    expect(f.list.state.value.status).toBe('failed');
    const retry = f.gate(); const second = f.list.loadOnce({ repositoryId: null }, () => retry.promise);
    expect(second).not.toBe(first); retry.release(['y']); await second;
    expect(f.list.state.value).toMatchObject({ status: 'loaded', items: ['y'] });
  });
});
