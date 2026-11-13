import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AgentDesktopBackend, typeByteLimit, type AdEnvelope } from '../agent-desktop-backend';

const window = { id: 'w-7', app_name: 'Notes', title: 'Draft', pid: 42, bounds: { x: 0, y: 0, width: 800, height: 600 }, is_focused: false, visible: true, accessible: true };
const tree = {
  snapshot_id: 's1', complete: true, app: 'Notes', window: { id: 'w-7', title: 'Draft' },
  tree: { role: 'window', children: [
    { role: 'textfield', name: 'Body', value: 'hello', ref_id: '@s1:e1' },
    { role: 'button', name: 'Send', ref_id: '@s1:e2' },
  ] },
};
const delivered = (extra: object = {}): AdEnvelope => ({ ok: true, data: { disposition: { delivery: 'delivered_verified', retry: 'unsafe' }, ...extra } });

// A scripted CLI stands in for agent-desktop so the translation is tested without touching any desktop.
function fixture(responses: Record<string, AdEnvelope | ((args: string[]) => AdEnvelope)> = {}) {
  const calls: { args: string[]; input?: string }[] = [];
  const defaults: Record<string, AdEnvelope> = { 'list-windows': { ok: true, data: [window] }, snapshot: { ok: true, data: tree } };
  const backend = new AgentDesktopBackend(async (rawArgs, input) => {
    if (rawArgs[0] === 'session') return { ok: true, data: { session_id: 'run-1' } };
    // The session flag is asserted once below; the other cases read the plain command.
    const at = rawArgs.indexOf('--session');
    const args = at < 0 ? rawArgs : [...rawArgs.slice(0, at), ...rawArgs.slice(at + 2)];
    calls.push({ args, input });
    const response = responses[args[0]!] ?? defaults[args[0]!] ?? delivered();
    return typeof response === 'function' ? response(args) : response;
  }, async () => undefined);
  const sessionCalls: string[][] = [];
  const observe = async () => {
    const listed = await backend.execute('list_windows', { app: 'Notes' });
    const windowId = (listed as any).result.windows[0].window_id as number;
    await backend.execute('get_app_state', { window_id: windowId });
    return windowId;
  };
  return { backend, calls, observe };
}

describe('agent-desktop Computer Use backend', () => {
  it('runs every action in one overlay session with the Korus cursor', async () => {
    const raw: string[][] = [];
    const backend = new AgentDesktopBackend(async args => {
      raw.push(args);
      return args[0] === 'session' ? { ok: true, data: { session_id: 'run-9' } } : { ok: true, data: [window] };
    }, async () => undefined, '/assets/cursor.png');
    await backend.execute('list_windows', { app: 'Notes' });
    await backend.execute('list_windows', { app: 'Notes' });
    expect(raw.filter(args => args[0] === 'session')).toStrictEqual([['session', 'start', '--no-trace', '--name', 'computer-use']]);
    expect(raw.find(args => args[0] === 'cursor-overlay')).toStrictEqual(['cursor-overlay', 'enable', '--session', 'run-9', '--image', '/assets/cursor.png', '--hotspot', '18.5,18.5', '--size', '0.5', '--accent', '#0A84FF', '--no-ripple', '--no-highlight']);
    expect(raw.filter(args => args[0] === 'list-windows').every(args => args.slice(-2).join(' ') === '--session run-9')).toBe(true);
    await backend.stop();
    expect(raw.at(-1)).toStrictEqual(['session', 'end', '--session', 'run-9']);
  });

  it('lists windows under stable session ids and numbers addressable elements in the observation', async () => {
    const { backend } = fixture();
    const first = await backend.execute('list_windows', { app: 'Notes' });
    const again = await backend.execute('list_windows', { app: 'Notes' });
    expect((first as any).result.windows[0]).toMatchObject({ window_id: 1, app: 'Notes', title: 'Draft' });
    expect((again as any).result.windows[0].window_id).toBe(1);
    const state = await backend.execute('get_app_state', { window_id: 1 });
    expect((state as any).result).toMatchObject({ stateKind: 'full', stateRevision: 1, snapshotId: 's1', elementCount: 2 });
    expect((state as any).result.text).toContain('[0] textfield "Body" value="hello"');
    expect((state as any).result.text).toContain('[1] button "Send"');
  });

  it('lists the windows of one process without resolving an app name', async () => {
    const { backend, calls } = fixture({ 'list-windows': { ok: true, data: [window, { ...window, id: 'w-8', pid: 99 }] } });
    const result = await backend.execute('list_windows', { pid: 99 });
    expect((result as any).result.windows.map((entry: any) => entry.pid)).toStrictEqual([99]);
    expect(calls.map(call => call.args)).toStrictEqual([['list-windows']]);
  });

  it('clicks the qualified ref behind an element index', async () => {
    const { backend, calls, observe } = fixture();
    const windowId = await observe();
    const result = await backend.execute('click', { window_id: windowId, element_index: 1 });
    expect(result).toMatchObject({ ok: true, result: { success: true, disposition: { delivery: 'delivered_verified' } } });
    expect(calls.at(-1)!.args).toStrictEqual(['click', '@s1:e2']);
  });

  it('says when an action reached the element but the application commit is unverified', async () => {
    const { backend, observe } = fixture({ 'set-value': delivered({ details: { application_commit: 'not_verified' } }) });
    const windowId = await observe();
    const result = await backend.execute('set_value', { window_id: windowId, element_index: 0, value: 'x' });
    expect(result).toMatchObject({ ok: true, result: { success: true, applicationCommit: 'not_verified', note: expect.stringContaining('not confirmed') } });
  });

  it('types through stdin, replaces with set-value and presses return to submit', async () => {
    const { backend, calls, observe } = fixture();
    const windowId = await observe();
    await backend.execute('type_text', { window_id: windowId, element_index: 0, text: 'héllo 🌍' });
    expect(calls.at(-1)).toStrictEqual({ args: ['type', '@s1:e1', '--stdin'], input: 'héllo 🌍' });
    await backend.execute('type_text', { window_id: windowId, element_index: 0, text: 'new', replace: true, submit: true });
    expect(calls.slice(-2).map(call => call.args)).toStrictEqual([['set-value', '@s1:e1', '--stdin'], ['press', 'return', '--app', 'Notes', '--window-id', 'w-7']]);
  });

  it('refuses text beyond the type limit before anything is sent', async () => {
    const { backend, calls, observe } = fixture();
    const windowId = await observe();
    const before = calls.length;
    const result = await backend.execute('type_text', { window_id: windowId, element_index: 0, text: 'x'.repeat(typeByteLimit + 1) });
    expect(result).toMatchObject({ ok: false, errorCode: 'text_too_large' });
    expect(calls).toHaveLength(before);
  });

  it('keeps the error code, delivery and retry rule when an action fails', async () => {
    const { backend, observe } = fixture({ type: { ok: false, error: { code: 'ACTION_FAILED', message: 'No text arrived.', disposition: { delivery: 'delivered_unverified', retry: 'unsafe' } } } });
    const windowId = await observe();
    const result = await backend.execute('type_text', { window_id: windowId, element_index: 0, text: 'hi', submit: true });
    expect(result).toMatchObject({ ok: false, errorCode: 'ACTION_FAILED' });
    expect((result as any).error).toContain('delivery=delivered_unverified, retry=unsafe');
  });

  it('refuses physical input and drags instead of taking the foreground', async () => {
    const { backend, calls, observe } = fixture();
    const windowId = await observe();
    const before = calls.length;
    await expect(backend.execute('click', { window_id: windowId, x: 10, y: 10 })).resolves.toMatchObject({ ok: false, errorCode: 'physical_input_unavailable' });
    await expect(backend.execute('click', { window_id: windowId, element_index: 1, click_count: 2 })).resolves.toMatchObject({ ok: false, errorCode: 'physical_input_unavailable' });
    await expect(backend.execute('drag', { window_id: windowId, from_x: 0, from_y: 0, to_x: 1, to_y: 1 })).resolves.toMatchObject({ ok: false, errorCode: 'drag_unavailable' });
    expect(calls).toHaveLength(before);
  });

  it('asks for a fresh observation when an element index is not in the latest one', async () => {
    const { backend, observe } = fixture();
    const windowId = await observe();
    await expect(backend.execute('click', { window_id: windowId, element_index: 9 })).resolves.toMatchObject({ ok: false, errorCode: 'stale_element' });
  });

  it('resolves a semantic selector through find', async () => {
    const { backend, calls, observe } = fixture({ find: { ok: true, data: { matches: [{ ref_id: '@s2:e5' }] } } });
    const windowId = await observe();
    await backend.execute('click', { window_id: windowId, selector: { role: 'AXButton', title: 'Send', occurrence: 2 } });
    expect(calls.find(call => call.args[0] === 'find')!.args).toStrictEqual(['find', '--app', 'Notes', '--window-id', 'w-7', '--first', '--role', 'button', '--name', 'Send', '--nth', '1']);
    expect(calls.at(-1)!.args).toStrictEqual(['click', '@s2:e5']);
  });

  it('returns a window screenshot as base64 with its dimensions', async () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    const { backend, observe } = fixture({ screenshot: args => { fs.writeFileSync(args.at(-1)!, png); return delivered(); } });
    const windowId = await observe();
    const result = await backend.execute('screenshot', { window_id: windowId, scope: 'window' });
    expect((result as any).result).toMatchObject({ scope: 'window', app: { localizedName: 'Notes' }, window: { title: 'Draft' }, image: { mimeType: 'image/png', width: 640, height: 480, dataBase64: png.toString('base64') } });
  });

  it('reports permissions and version from status', async () => {
    const { backend } = fixture({ status: { ok: true, data: { version: '1.3.0', permissions: { accessibility: { state: 'granted' }, screen_recording: { state: 'denied' } } } } });
    await expect(backend.execute('status', {})).resolves.toMatchObject({ ok: true, result: { accessibilityTrusted: true, screenCaptureTrusted: false, version: '1.3.0' } });
  });
});
