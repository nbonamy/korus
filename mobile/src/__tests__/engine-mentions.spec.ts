import { describe, expect, it, vi } from 'vitest';
import type { BackendPluginSummary } from '@workspace/core/contracts';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';

const plugins: BackendPluginSummary[] = [
  { id: 'github@bundled', name: 'github', displayName: 'GitHub', shortDescription: 'Work with repositories', enabled: true },
  { id: 'hidden', name: 'hidden', displayName: 'Hidden', enabled: false },
];
function fixture(listPlugins = vi.fn(async (_id: string): Promise<BackendPluginSummary[]> => plugins)) {
  const connector = createDemoConnector(); const connect = connector.connect;
  const sendPrompt = vi.fn(async () => {});
  connector.connect = async (id) => ({ ...await connect(id), listPlugins, sendPrompt });
  const engine = createEngine({ connector, post() {} });
  const open = async () => { await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' }); };
  return { engine, open, listPlugins, sendPrompt };
}

describe('mobile agent and plugin mentions', () => {
  it('offers team agents immediately, loads enabled plugins on demand and sends canonical mentions', async () => {
    const f = fixture();
    try {
      await f.open();
      const agents = f.engine.snapshot().mentions.items;
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.every(item => item.kind === 'agent')).toBe(true);
      expect(agents.find(item => item.id === 'agent:demo-reviewer')).toMatchObject({ insertText: 'agent:demo-reviewer' });
      expect(f.listPlugins).not.toHaveBeenCalled();
      await f.engine.dispatch({ type: 'loadMentions' });
      expect(f.engine.snapshot().mentions).toStrictEqual({ status: 'loaded', items: [...agents,
        { id: 'plugin:github@bundled', kind: 'plugin', name: 'GitHub', insertText: 'github', description: 'Work with repositories' },
      ] });
      await f.engine.dispatch({ type: 'send', text: 'Ask @agent:demo-reviewer about @github' });
      expect(f.sendPrompt).toHaveBeenCalledExactlyOnceWith('demo-agent', 'Ask @agent:demo-reviewer about @github', expect.any(String), expect.any(Object));
    } finally { f.engine.dispose(); }
  });

  it('discards late plugins after switching chats and keeps agents available on failure and retry', async () => {
    let resolve!: (items: BackendPluginSummary[]) => void;
    const list = vi.fn(async (_id: string): Promise<BackendPluginSummary[]> => plugins)
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockRejectedValueOnce(new Error('offline'));
    const f = fixture(list);
    try {
      await f.open();
      const loading = f.engine.dispatch({ type: 'loadMentions' });
      await f.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      resolve(plugins); await loading;
      expect(f.engine.snapshot().mentions.status).toBe('idle');
      expect(f.engine.snapshot().mentions.items.every(item => item.kind === 'agent')).toBe(true);
      await f.engine.dispatch({ type: 'loadMentions' });
      expect(f.engine.snapshot().mentions.status).toBe('failed');
      expect(f.engine.snapshot().mentions.items.length).toBeGreaterThan(0);
      await f.engine.dispatch({ type: 'loadMentions' });
      expect(f.engine.snapshot().mentions.status).toBe('loaded');
      expect(list).toHaveBeenLastCalledWith('demo-reviewer');
      await f.engine.dispatch({ type: 'disconnect' });
      expect(f.engine.snapshot().mentions).toStrictEqual({ status: 'idle', items: [] });
    } finally { f.engine.dispose(); }
  });
});
