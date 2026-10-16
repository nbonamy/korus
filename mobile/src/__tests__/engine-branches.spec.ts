import { describe, expect, it, vi } from 'vitest';
import type { CompanionBranch } from '@workspace/core/companion-protocol';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';

const branches: CompanionBranch[] = [
  { name: 'main', isDefault: true, isCheckedOut: true },
  { name: 'feature/login', isDefault: false, isCheckedOut: false },
];
function fixture(listBranches = vi.fn(async (_team: string, _repo: string): Promise<CompanionBranch[]> => branches)) {
  const connector = createDemoConnector(); const connect = connector.connect;
  const createChat = vi.fn(async () => 'demo-reviewer');
  connector.connect = async (id) => ({ ...await connect(id), listBranches, createChat });
  const engine = createEngine({ connector, post() {} });
  const open = async () => { await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); };
  return { engine, open, listBranches, createChat };
}

describe('mobile existing branch picker', () => {
  it('loads branches on demand and creates the chat on the chosen existing branch', async () => {
    const f = fixture();
    try {
      await f.open();
      expect(f.listBranches).not.toHaveBeenCalled();
      await f.engine.dispatch({ type: 'loadBranches', repositoryId: 'repo' });
      expect(f.listBranches).toHaveBeenCalledExactlyOnceWith('demo-team', 'repo');
      expect(f.engine.snapshot().branches).toStrictEqual({ repositoryId: 'repo', status: 'loaded', items: branches });
      await f.engine.dispatch({ type: 'newChat', repositoryId: 'repo', backend: 'codex', existingBranch: 'feature/login' });
      expect(f.createChat).toHaveBeenCalledExactlyOnceWith({ teamId: 'demo-team', repositoryId: 'repo', backend: 'codex', existingBranch: 'feature/login' });
      expect(f.engine.snapshot().agentId).toBe('demo-reviewer');
    } finally { f.engine.dispose(); }
  });
  it('keeps an older repository response out of the current picker and supports retry', async () => {
    let resolve!: (items: CompanionBranch[]) => void;
    const list = vi.fn(async (_team: string, _repo: string) => branches)
      .mockImplementationOnce(() => new Promise<CompanionBranch[]>((done) => { resolve = done; }))
      .mockRejectedValueOnce(new Error('Offline'));
    const f = fixture(list);
    try {
      await f.open();
      const older = f.engine.dispatch({ type: 'loadBranches', repositoryId: 'old' });
      expect(f.engine.snapshot().branches.status).toBe('loading');
      await f.engine.dispatch({ type: 'loadBranches', repositoryId: 'new' });
      expect(f.engine.snapshot().branches).toStrictEqual({ repositoryId: 'new', status: 'failed', items: [] });
      resolve(branches); await older;
      expect(f.engine.snapshot().branches).toStrictEqual({ repositoryId: 'new', status: 'failed', items: [] });
      await f.engine.dispatch({ type: 'loadBranches', repositoryId: 'new' });
      expect(f.engine.snapshot().branches.status).toBe('loaded');
    } finally { f.engine.dispose(); }
  });
  it.each(['dismissBranches', 'disconnect', 'selectTeam'] as const)('invalidates pending branch results on %s', async (type) => {
    let resolve!: (items: CompanionBranch[]) => void;
    const f = fixture(vi.fn((_team: string, _repo: string) => new Promise<CompanionBranch[]>((done) => { resolve = done; })));
    try {
      await f.open();
      const loading = f.engine.dispatch({ type: 'loadBranches', repositoryId: 'repo' });
      await f.engine.dispatch(type === 'selectTeam' ? { type, id: 'another-team' } : { type });
      resolve(branches); await loading;
      expect(f.engine.snapshot().branches).toStrictEqual({ repositoryId: null, status: 'idle', items: [] });
    } finally { f.engine.dispose(); }
  });
});
