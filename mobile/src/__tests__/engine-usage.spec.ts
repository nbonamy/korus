import { describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import type { CompanionUsage } from '@workspace/core/companion-protocol';

const providers: CompanionUsage[] = [{ backend: 'codex', failed: false, limits: {
  primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 2_000_000_000 }, secondary: null,
} }];

function fixture(read = vi.fn(async () => providers)) {
  const connector = createDemoConnector(); const connect = connector.connect;
  connector.connect = async id => ({ ...await connect(id), getUsage: read });
  const engine = createEngine({ connector, post() {} });
  return { engine, read };
}

describe('mobile account usage', () => {
  it('loads only on request and refreshes the paired laptop usage without changing the conversation', async () => {
    const f = fixture();
    try {
      await f.engine.start();
      expect(f.read).not.toHaveBeenCalled();
      const agent = f.engine.snapshot().agentId;
      await f.engine.dispatch({ type: 'loadUsage' });
      expect(f.engine.snapshot().usage).toStrictEqual({ status: 'loaded', providers });
      expect(f.engine.snapshot().agentId).toBe(agent);
      await f.engine.dispatch({ type: 'loadUsage' });
      expect(f.read).toHaveBeenCalledTimes(2);
    } finally { f.engine.dispose(); }
  });

  it('shows failure and allows retry, ignoring responses from a disconnected laptop', async () => {
    let resolve!: (value: typeof providers) => void;
    const read = vi.fn(async () => providers).mockRejectedValueOnce(new Error('Offline'));
    const f = fixture(read);
    try {
      await f.engine.start();
      await f.engine.dispatch({ type: 'loadUsage' });
      expect(f.engine.snapshot().usage).toStrictEqual({ status: 'failed', providers: [] });
      await f.engine.dispatch({ type: 'loadUsage' });
      expect(f.engine.snapshot().usage.status).toBe('loaded');
      read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
      const loading = f.engine.dispatch({ type: 'loadUsage' });
      expect(f.engine.snapshot().usage.status).toBe('loading');
      await f.engine.dispatch({ type: 'disconnect' });
      resolve(providers); await loading;
      expect(f.engine.snapshot().usage).toStrictEqual({ status: 'idle', providers: [] });
    } finally { f.engine.dispose(); }
  });
});
