import { describe, expect, it, vi } from 'vitest';
import { createDemoConnector } from '../demo-connector';
import { createEngine, type EngineEvent } from '../engine';

describe('conversation image bridge', () => {
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
