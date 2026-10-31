import { describe, expect, it, vi } from 'vitest';
import { createDemoConnector } from '../demo-connector';
import { createEngine, type EngineEvent } from '../engine';
import { nativeImageCacheStore } from '../image-cache';

describe('conversation image bridge', () => {
  it('reuses device images across threads and engine recreation without confusing hosts or mutable file paths', async () => {
    const values = new Map<string, string>();
    const imageCache = {
      read: vi.fn(async (host: string, key: string) => values.get(`${host}/${key}`) ?? null),
      write: vi.fn(async (host: string, key: string, value: string) => { values.set(`${host}/${key}`, value); }),
      forget: vi.fn(async (host: string) => { for (const key of values.keys()) if (key.startsWith(`${host}/`)) values.delete(key); }),
    };
    const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=' };
    const read = vi.fn(async () => image);
    const make = (host = 'demo-laptop') => {
      const connector = createDemoConnector(); const connect = connector.connect;
      connector.laptops = [{ id: host, name: host }];
      connector.connect = async () => {
        const session = await connect('demo-laptop');
        return { ...session, readImage: read, getWorkspace: async () => {
          const workspace = await session.getWorkspace();
          return { ...workspace, agents: workspace.agents.map(agent => ({ ...agent, backendSession: { kind: 'codex' as const, threadId: agent.id } })) };
        } };
      };
      const events: EngineEvent[] = [];
      const store = nativeImageCacheStore(async <T>(body: Record<string, unknown>) => {
        const host = body.host as string, key = body.key as string;
        const result = body.type === 'imageCache.read' ? await imageCache.read(host, key)
          : body.type === 'imageCache.write' ? await imageCache.write(host, key, body.dataUrl as string)
            : await imageCache.forget(host);
        return result as T;
      });
      return { engine: createEngine({ connector, imageCache: store, post: event => events.push(event) }), events };
    };
    let current = make();
    const reference = `conversation-image:demo-agent:${'a'.repeat(64)}`;
    const open = (path = reference, requestId = 'image') => current.engine.dispatch({ type: 'readConversationImage', requestId, agentId: 'demo-agent', path });
    try {
      await current.engine.start(); await current.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      expect(read).not.toHaveBeenCalled();
      await Promise.all([open(), open()]); expect(read).toHaveBeenCalledTimes(1);
      await current.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      await current.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await open(); expect(read).toHaveBeenCalledTimes(1);
      current.engine.dispose(); current = make(); await current.engine.start();
      await current.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await open(); expect(read).toHaveBeenCalledTimes(1);
      expect(current.events.filter(event => event.type === 'conversationImage').at(-1)).toStrictEqual({ type: 'conversationImage', requestId: 'image', agentId: 'demo-agent', ...image });
      for (let n = 0; n < 2; n++) await current.engine.dispatch({ type: 'readConversationImage', requestId: 'file', agentId: 'demo-agent', path: '/tmp/latest.png' });
      expect(read).toHaveBeenCalledTimes(3);
      current.engine.dispose(); current = make('other-laptop'); await current.engine.start();
      await current.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' }); await open();
      expect(read).toHaveBeenCalledTimes(4);
      let finishLookup!: (value: string | null) => void;
      imageCache.read.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve; }));
      const slowReference = `conversation-image:demo-agent:${'b'.repeat(64)}`;
      const old = open(slowReference, 'old');
      await vi.waitFor(() => expect(finishLookup).toBeTypeOf('function'));
      await current.engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' });
      await current.engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      const latest = open(slowReference, 'latest');
      await new Promise(resolve => setTimeout(resolve, 20));
      finishLookup(null); await Promise.all([old, latest]);
      expect(current.events.filter(event => event.type === 'conversationImage').at(-1)).toStrictEqual({ type: 'conversationImage', requestId: 'latest', agentId: 'demo-agent', ...image });
      expect(read).toHaveBeenCalledTimes(5);
      imageCache.read.mockRejectedValueOnce(new Error('Disk unavailable'));
      imageCache.write.mockRejectedValueOnce(new Error('Disk full'));
      const retryReference = `conversation-image:demo-agent:${'c'.repeat(64)}`;
      await open(retryReference); await open(retryReference);
      expect(read).toHaveBeenCalledTimes(7);
      expect(current.events.filter(event => event.type === 'conversationImage').at(-1)).toMatchObject(image);
      let finishForgottenLookup!: (value: string | null) => void;
      imageCache.read.mockImplementationOnce(() => new Promise(resolve => { finishForgottenLookup = resolve; }));
      const forgotten = open(`conversation-image:demo-agent:${'d'.repeat(64)}`, 'forgotten');
      await vi.waitFor(() => expect(finishForgottenLookup).toBeTypeOf('function'));
      await current.engine.dispatch({ type: 'forget', laptopId: 'other-laptop' });
      finishForgottenLookup(null); await forgotten;
      expect(read).toHaveBeenCalledTimes(7);
      expect(current.events.filter(event => event.type === 'conversationImage').at(-1)).toMatchObject({ requestId: 'forgotten', error: 'Image is unavailable.' });
      expect(imageCache.forget).toHaveBeenCalledTimes(1);
      expect(values.size).toBe(1);
    } finally { current.engine.dispose(); }
  });
  it('loads file previews only on demand and discards a late reply after switching agents', async () => {
    const preview = { path: 'src/app.ts', source: { path: 'src/app.ts', kind: 'text' as const, size: 3, content: 'new' }, diff: 'patch', diffScope: 'turn' as const };
    const read = vi.fn(async (_agent: string, _input: unknown) => preview);
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async id => ({ ...await connect(id), previewFile: read });
    const events: EngineEvent[] = [];
    const engine = createEngine({ connector, post: event => events.push(event) });
    try {
      await engine.start();
      expect(read).not.toHaveBeenCalled();
      const input = { path: 'src/app.ts', action: 'edit' as const, turnId: 'turn' };
      await engine.dispatch({ type: 'readFilePreview', requestId: 'one', agentId: 'demo-agent', input });
      expect(read).toHaveBeenCalledExactlyOnceWith('demo-agent', input);
      expect(events.filter(event => event.type === 'conversationFile')).toStrictEqual([{ type: 'conversationFile', requestId: 'one', agentId: 'demo-agent', preview }]);
      let release!: (value: typeof preview) => void;
      read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = engine.dispatch({ type: 'readFilePreview', requestId: 'two', agentId: 'demo-agent', input });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' }); release(preview); await pending;
      expect(events.filter(event => event.type === 'conversationFile').at(-1)).toStrictEqual({ type: 'conversationFile', requestId: 'two', agentId: 'demo-agent', error: 'File is unavailable.' });
    } finally { engine.dispose(); }
  });
  it('returns laptop image bytes to the requester and rejects a response after navigation', async () => {
    let release!: (image: { dataUrl: string }) => void;
    const image = { dataUrl: 'data:image/png;base64,cG5n' };
    const read = vi.fn(async (_agent: string, _path: string) => image);
    const connector = createDemoConnector(); const connect = connector.connect;
    connector.connect = async id => ({ ...await connect(id), readImage: read });
    const events: EngineEvent[] = [];
    const engine = createEngine({ connector, post: event => events.push(event) });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      await engine.dispatch({ type: 'readConversationImage', requestId: 'one', agentId: 'demo-agent', path: '/tmp/shot.png' });
      expect(events.filter(event => event.type === 'conversationImage')).toStrictEqual([{ type: 'conversationImage', requestId: 'one', agentId: 'demo-agent', ...image }]);
      read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = engine.dispatch({ type: 'readConversationImage', requestId: 'two', agentId: 'demo-agent', path: '/tmp/shot.png' });
      await engine.dispatch({ type: 'selectAgent', id: 'demo-reviewer' }); release(image); await pending;
      expect(events.filter(event => event.type === 'conversationImage').at(-1)).toStrictEqual({ type: 'conversationImage', requestId: 'two', agentId: 'demo-agent', error: 'Image is unavailable.' });
    } finally { engine.dispose(); }
  });
});
