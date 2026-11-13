import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Computer Use backend over the agent-desktop CLI (https://github.com/lahfir/agent-desktop).
 *
 * Korus keeps its window-id plus element-index contract; this module owns the translation:
 * session-local integer window ids to AD window ids, element indexes to qualified snapshot
 * refs, and AD delivery dispositions to explicit, never-replayed failures. Input is headless
 * only: physical clicks, drags, pasteboard use and focus stealing are refused, never emulated.
 */
export type AdEnvelope = {
  ok: boolean;
  data?: any;
  error?: { code: string; message: string; suggestion?: string; disposition?: { delivery?: string; retry?: string }; details?: unknown };
};
export type AdRun = (args: string[], input?: string) => Promise<AdEnvelope>;
export type AdFailure = { error: string; errorCode: string; ok: false };
export type AdResult = { ok: true; result: unknown } | AdFailure;

type Args = Record<string, any>;
type WindowRecord = { adId: string; app: string; pid: number; title: string };

export const typeByteLimit = 10_000;
export const setValueByteLimit = 128 * 1024;
const defaultTextCharacters = 60_000;

export class AgentDesktopBackend {
  private readonly windowIds = new Map<string, number>();
  private readonly windows = new Map<number, WindowRecord>();
  private readonly refs = new Map<number, string[]>();
  private readonly revisions = new Map<number, number>();
  private nextWindowId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private session: Promise<string | null> | null = null;

  constructor(
    private readonly run: AdRun,
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    private readonly cursorImage?: string,
  ) {}

  /** Serializes calls so a ref table is never read while another observation rewrites it. */
  execute(command: string, args: Args): Promise<AdResult> {
    const next = this.queue.then(() => this.dispatch(command, args), () => this.dispatch(command, args));
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Ends the overlay session; the next command starts a fresh one. */
  async stop(): Promise<void> {
    const session = await this.session;
    this.session = null;
    this.windowIds.clear();
    this.windows.clear();
    this.refs.clear();
    this.revisions.clear();
    if (session) await this.run(['session', 'end', '--session', session]);
  }

  /** Every command runs in one session so the click-through cursor overlay shows each action; without a session the actions still work. The overlay is enabled once, already styled, so the built-in arrow never shows first. */
  private async call(args: string[], input?: string): Promise<AdEnvelope> {
    if (args[0] === 'status') return this.run(args, input);
    this.session ??= this.run(['session', 'start', '--no-trace', ...(this.cursorImage ? [] : ['--cursor']), '--name', 'computer-use']).then(async response => {
      const id = response.ok ? String(response.data?.session_id ?? '') : '';
      if (id) await this.styleCursor(id);
      return id || null;
    });
    const session = await this.session;
    return this.run(session ? [...args, '--session', session] : args, input);
  }

  /** The Korus cursor (assets/computer-use-cursor.svg) replaces the built-in arrow. The 64px image is a 32pt composition, so it is drawn at half size with its tip (18.5px) as the hotspot. */
  private async styleCursor(session: string): Promise<void> {
    if (this.cursorImage) await this.run(['cursor-overlay', 'enable', '--session', session, '--image', this.cursorImage, '--hotspot', '18.5,18.5', '--size', '0.5', '--accent', '#0A84FF', '--no-ripple', '--no-highlight']);
  }

  private async dispatch(command: string, args: Args): Promise<AdResult> {
    try {
      switch (command) {
        case 'status': return await this.status();
        case 'request_accessibility': return await this.status();
        case 'request_screen_capture': return await this.status();
        case 'list_apps': return await this.listApps(args);
        case 'find_apps': return await this.listApps(args);
        case 'list_windows': return await this.listWindows(args);
        case 'launch_app': return await this.launch(args);
        case 'focus_app': return await this.focus(args);
        case 'get_app_state': return await this.appState(args);
        case 'screenshot': return await this.screenshot(args);
        case 'click': return await this.click(args);
        case 'dismiss': return await this.pressTo(args, 'escape');
        case 'press_key': return await this.pressTo(args, combo(String(args.key ?? '')));
        case 'type_text': return await this.typeText(args);
        case 'set_value': return await this.setValue(args);
        case 'scroll': return await this.scroll(args);
        case 'paste': return unsupported('paste', 'Pasting uses the clipboard, which headless Computer Use never touches. Use computer-use-type-text or computer-use-set-value.');
        case 'select_text': return unsupported('select_text', 'Selecting a text range is not available. Use computer-use-set-value to replace the whole value.');
        case 'drag': return unsupported('drag', 'Dragging needs physical input and the foreground, which headless Computer Use never takes.');
        case 'perform_secondary_action': return unsupported('perform_secondary_action', 'Named Accessibility actions are not exposed. Use computer-use-click, or click with mouse_button "right" for a context menu.');
        default: return failure('unsupported_command', `Unknown Computer Use command: ${command}`);
      }
    } catch (error) {
      return failure('client_error', error instanceof Error ? error.message : String(error));
    }
  }

  private async status(): Promise<AdResult> {
    const response = await this.call(['status']);
    if (!response.ok) return fromError(response);
    const permissions = response.data?.permissions ?? {};
    return success({
      accessibilityTrusted: permissions.accessibility?.state === 'granted',
      screenCaptureTrusted: permissions.screen_recording?.state === 'granted',
      backend: 'agent-desktop',
      version: response.data?.version,
    });
  }

  private async listApps(args: Args): Promise<AdResult> {
    const response = await this.call(['list-apps']);
    if (!response.ok) return fromError(response);
    const needle = String(args.app ?? args.bundleIdentifier ?? '').toLowerCase();
    const apps = (response.data?.apps ?? [] as any[])
      .filter((app: any) => app.name && app.pid)
      .filter((app: any) => !needle || String(app.name).toLowerCase().includes(needle) || String(app.bundle_id ?? '').toLowerCase() === needle)
      .filter((app: any) => args.pid === undefined || app.pid === args.pid)
      .map((app: any) => ({ name: app.name, bundleIdentifier: app.bundle_id, pid: app.pid, presentation: app.presentation }));
    return success({ apps, scope: 'running' });
  }

  private async listWindows(args: Args): Promise<AdResult> {
    const app = typeof args.app === 'string' || typeof args.bundleIdentifier === 'string' ? await this.appName(args) : undefined;
    const response = await this.call(['list-windows', ...(app ? ['--app', app] : [])]);
    if (!response.ok) return fromError(response);
    const windows = (response.data as any[]).filter(window => args.pid === undefined || window.pid === args.pid).map(window => ({
      window_id: this.windowId(window),
      app: window.app_name,
      title: window.title,
      pid: window.pid,
      bounds: window.bounds,
      focused: window.is_focused,
      is_key: window.is_focused,
      visible: window.visible,
      accessible: window.accessible,
    }));
    return success({ windows });
  }

  private async launch(args: Args): Promise<AdResult> {
    const target = typeof args.bundleIdentifier === 'string' ? args.bundleIdentifier : typeof args.path === 'string' ? args.path : null;
    if (!target) return failure('invalid_request', 'launch requires bundleIdentifier or path.');
    return this.deliver(await this.call(['launch', target]));
  }

  private async focus(args: Args): Promise<AdResult> {
    const window = this.window(args);
    if (failed(window)) return window;
    return this.deliver(await this.call(['focus-window', '--window-id', window.adId, '--app', window.app]));
  }

  private async appState(args: Args): Promise<AdResult> {
    const menuBar = args.accessibilityScope === 'menu_bar';
    const found = menuBar && args.window_id === undefined ? await this.appFromArgs(args) : this.window(args);
    if (failed(found)) return found;
    const target = 'adId' in found ? found : null;
    const app = 'adId' in found ? found.app : found.name;
    const id = args.window_id as number | undefined;
    const drill = args.rootElementIndex !== undefined ? this.refFor(id, args.rootElementIndex) : undefined;
    if (failed(drill)) return drill;
    const snapshotArgs = ['snapshot', '--app', app, '--compact', '--timeout-ms', String(args.timeoutMs ?? 8000),
      ...(args.maxDepth ? ['--max-depth', String(args.maxDepth)] : []),
      ...(menuBar ? ['--surface', 'menubar'] : target ? ['--window-id', target.adId] : []),
      ...(drill ? ['--root', drill] : [])];
    const wanted = typeof args.waitForText === 'string' ? args.waitForText : null;
    const deadline = Date.now() + (args.timeoutMs ?? 3000);
    let state: { payload: Record<string, unknown>; text: string };
    for (;;) {
      const response = await this.call(snapshotArgs);
      if (!response.ok) return fromError(response);
      state = this.renderSnapshot(response.data, id, Boolean(drill), args.maxTextCharacters ?? defaultTextCharacters);
      if (!wanted || state.text.includes(wanted) || Date.now() >= deadline) break;
      await this.sleep(250);
    }
    if (wanted && !state.text.includes(wanted)) return failure('wait_timeout', `Text "${wanted}" did not appear within ${args.timeoutMs ?? 3000}ms.`);
    const result: Record<string, unknown> = { ...state.payload, text: state.text };
    if (args.includeScreenshot && id !== undefined) {
      const shot = await this.screenshot({ window_id: id });
      if (failed(shot)) return shot;
      result.screenshot = shot.result;
    }
    return success(result);
  }

  private renderSnapshot(data: any, windowId: number | undefined, drill: boolean, limit: number): { payload: Record<string, unknown>; text: string } {
    const table = drill && windowId !== undefined ? this.refs.get(windowId) ?? [] : [];
    const lines: string[] = [];
    const walk = (node: any, depth: number) => {
      const index = node.ref_id ? table.push(node.ref_id) - 1 : undefined;
      const label = [`${'  '.repeat(depth)}${index === undefined ? '-' : `[${index}]`} ${node.role ?? 'node'}`,
        node.name ? `"${node.name}"` : '', node.value ? `value=${JSON.stringify(node.value)}` : '',
        node.children_count ? `(${node.children_count} more children)` : ''].filter(Boolean).join(' ');
      lines.push(label);
      for (const child of node.children ?? []) walk(child, depth + 1);
    };
    walk(data.tree, 0);
    if (windowId !== undefined) {
      this.refs.set(windowId, table);
      this.revisions.set(windowId, (this.revisions.get(windowId) ?? 0) + 1);
    }
    let text = lines.join('\n');
    const truncated = text.length > limit;
    if (truncated) text = `${text.slice(0, limit)}\n… truncated at ${limit} characters; drill into a region with rootElementIndex.`;
    return {
      text,
      payload: {
        stateKind: 'full',
        stateRevision: windowId === undefined ? 0 : this.revisions.get(windowId),
        snapshotId: data.snapshot_id,
        complete: data.complete !== false && !truncated,
        elementCount: table.length,
        window: { ...(windowId === undefined ? {} : { window_id: windowId }), ...(data.window ?? {}), app: data.app },
      },
    };
  }

  private async screenshot(args: Args): Promise<AdResult> {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cu-shot-')), 'shot.png');
    try {
      if (args.scope === 'screen') {
        const displays = await this.call(['list-displays']);
        if (!displays.ok) return fromError(displays);
        const list = displays.data as any[];
        const index = args.displayId === undefined ? Math.max(0, list.findIndex(display => display.is_primary)) : list.findIndex(display => Number(display.id) === args.displayId);
        if (index < 0) return failure('display_not_found', `No display with id ${args.displayId}.`);
        const response = await this.call(['screenshot', '--screen', String(index), file]);
        if (!response.ok) return fromError(response);
        return success(this.imagePayload('screen', file, { screen: { id: Number(list[index].id), bounds: list[index].bounds } }, list[index].scale));
      }
      const window = this.window(args);
      if (failed(window)) return window;
      const response = await this.call(['screenshot', '--app', window.app, '--window-id', window.adId, file]);
      if (!response.ok) return fromError(response);
      const listed = await this.call(['list-windows', '--app', window.app]);
      const bounds = listed.ok ? (listed.data as any[]).find(candidate => candidate.id === window.adId)?.bounds : undefined;
      return success(this.imagePayload('window', file, { app: { localizedName: window.app }, window: { window_id: args.window_id, title: window.title, ...(bounds ? { bounds } : {}) } }, undefined));
    } finally {
      fs.rmSync(path.dirname(file), { force: true, recursive: true });
    }
  }

  private imagePayload(scope: string, file: string, target: Record<string, unknown>, scaleFactor: number | undefined) {
    const bytes = fs.readFileSync(file);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return { scope, ...target, image: { dataBase64: bytes.toString('base64'), mimeType: 'image/png', width, height, ...(scaleFactor ? { scaleFactor } : {}) } };
  }

  private async click(args: Args): Promise<AdResult> {
    if (args.physical === true || args.x !== undefined || args.y !== undefined) {
      return unsupported('physical_input', 'Coordinate and physical clicks need the foreground and the real pointer, which headless Computer Use never uses. Target an element_index or selector.');
    }
    if ((args.click_count ?? 1) > 1 || (args.mouse_button ?? 'left') === 'middle') {
      return unsupported('physical_input', 'Double clicks, triple clicks and the middle button need physical input. Use a single semantic click or right click.');
    }
    const target = await this.target(args);
    if (typeof target !== 'string') return target;
    return this.deliver(await this.call([args.mouse_button === 'right' ? 'right-click' : 'click', target]));
  }

  private async pressTo(args: Args, keys: string): Promise<AdResult> {
    const window = this.window(args);
    if (failed(window)) return window;
    return this.deliver(await this.call(['press', keys, '--app', window.app, '--window-id', window.adId]));
  }

  private async typeText(args: Args): Promise<AdResult> {
    const text = String(args.text ?? '');
    const bytes = Buffer.byteLength(text, 'utf8');
    const replace = args.replace === true;
    const limit = replace ? setValueByteLimit : typeByteLimit;
    if (bytes > limit) {
      return failure('text_too_large', `Text is ${bytes} UTF-8 bytes; ${replace ? 'replace' : 'type'} accepts at most ${limit}. Nothing was sent and nothing was truncated. Split the text across calls${replace ? '' : ' or use replace=true (up to 128 KiB)'}.`);
    }
    const target = await this.target(args);
    if (typeof target !== 'string') return target;
    const delivered = await this.deliver(await this.call([replace ? 'set-value' : 'type', target, '--stdin'], text));
    if (failed(delivered) || args.submit !== true) return delivered;
    const submitted = await this.pressTo(args, 'return');
    return failed(submitted) ? { ...submitted, error: `The text was delivered but submit failed: ${submitted.error}` } : delivered;
  }

  private async setValue(args: Args): Promise<AdResult> {
    const value = String(args.value ?? '');
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > setValueByteLimit) return failure('text_too_large', `Value is ${bytes} UTF-8 bytes; set-value accepts at most ${setValueByteLimit}. Nothing was sent.`);
    const target = await this.target(args);
    if (typeof target !== 'string') return target;
    return this.deliver(await this.call(['set-value', target, '--stdin'], value));
  }

  private async scroll(args: Args): Promise<AdResult> {
    const target = await this.target(args);
    if (typeof target !== 'string') return target;
    return this.deliver(await this.call(['scroll', target, '--direction', args.direction ?? 'down', '--amount', String(args.pages ?? 3)]));
  }

  /** Reports an action with its delivery disposition; failures carry the retry rule verbatim. */
  private deliver(response: AdEnvelope): AdResult {
    if (!response.ok) return fromError(response);
    const commit = response.data?.details?.application_commit;
    return success({
      success: true,
      ...(response.data ?? {}),
      ...(commit === 'not_verified' ? { applicationCommit: 'not_verified', note: 'Delivered to the element. The application\'s own state was not confirmed; check the app (submitted or saved value) before relying on it.' } : {}),
    });
  }

  private async target(args: Args): Promise<string | AdFailure> {
    const window = this.window(args);
    if (failed(window)) return window;
    if (args.element_index !== undefined) return this.refFor(args.window_id, args.element_index);
    const selector = args.selector as Record<string, unknown> | undefined;
    if (!selector) return failure('invalid_request', 'Pass element_index from the latest observation, or a selector.');
    const response = await this.call(['find', '--app', window.app, '--window-id', window.adId, '--first',
      ...(selector.role ? ['--role', String(selector.role).replace(/^AX/, '').toLowerCase()] : []),
      ...(selector.title ? ['--name', String(selector.title)] : []),
      ...(selector.value ? ['--value', String(selector.value)] : []),
      ...(selector.description ? ['--description', String(selector.description)] : []),
      ...(typeof selector.occurrence === 'number' ? ['--nth', String(selector.occurrence - 1)] : [])]);
    if (!response.ok) return fromError(response);
    const ref = response.data?.matches?.[0]?.ref_id;
    return typeof ref === 'string' ? ref : failure('element_not_found', 'No element matched the selector.');
  }

  private refFor(windowId: number | undefined, index: number): string | AdFailure {
    const ref = windowId === undefined ? undefined : this.refs.get(windowId)?.[index];
    return ref ?? failure('stale_element', `Element ${index} is not in the latest observation of this window. Observe again with computer-use-get-app-state.`);
  }

  private window(args: Args): WindowRecord | AdFailure {
    const record = typeof args.window_id === 'number' ? this.windows.get(args.window_id) : undefined;
    return record ?? failure('window_not_found', 'Unknown window_id. Call computer-use-list-windows and use a returned window_id.');
  }

  private async appFromArgs(args: Args): Promise<{ name: string } | AdFailure> {
    const name = await this.appName(args);
    return name ? { name } : failure('invalid_request', 'Pass app, pid or bundleIdentifier for a menu bar observation.');
  }

  private async appName(args: Args): Promise<string | undefined> {
    if (typeof args.app === 'string') return args.app;
    if (args.pid === undefined && typeof args.bundleIdentifier !== 'string') return undefined;
    const response = await this.call(['list-apps']);
    const match = response.ok ? (response.data?.apps as any[] | undefined)?.find(app => (args.pid !== undefined && app.pid === args.pid) || (typeof args.bundleIdentifier === 'string' && app.bundle_id === args.bundleIdentifier)) : undefined;
    return match?.name;
  }

  private windowId(window: any): number {
    let id = this.windowIds.get(window.id);
    if (id === undefined) {
      id = this.nextWindowId++;
      this.windowIds.set(window.id, id);
    }
    this.windows.set(id, { adId: window.id, app: window.app_name, pid: window.pid, title: window.title });
    return id;
  }
}

function combo(key: string): string {
  const modifiers: Record<string, string> = { super: 'cmd', command: 'cmd', meta: 'cmd', control: 'ctrl', option: 'alt' };
  const keys: Record<string, string> = { backspace: 'delete', page_up: 'pageup', page_down: 'pagedown', kp_enter: 'return', enter: 'return' };
  return key.split('+').map(part => {
    const lower = part.toLowerCase();
    return modifiers[lower] ?? keys[lower] ?? lower;
  }).join('+');
}

function failed(value: unknown): value is AdFailure {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
}

function success(result: unknown): AdResult {
  return { ok: true, result };
}

function failure(errorCode: string, error: string): AdFailure {
  return { error, errorCode, ok: false };
}

function unsupported(errorCode: string, error: string): AdFailure {
  return failure(errorCode === 'physical_input' ? 'physical_input_unavailable' : `${errorCode}_unavailable`, error);
}

/** Keeps AD's own code, the retry rule and the suggestion so callers never replay an uncertain action. */
function fromError(response: AdEnvelope): AdFailure {
  const error = response.error;
  const rule = error?.disposition ? ` [delivery=${error.disposition.delivery ?? 'unknown'}, retry=${error.disposition.retry ?? 'unknown'}]` : '';
  const hint = error?.suggestion && !error.suggestion.includes('--headed') ? ` ${error.suggestion}` : '';
  return failure(error?.code ?? 'client_error', `${error?.message ?? 'agent-desktop failed.'}${rule}${hint}`);
}

export function createAgentDesktopRunner(binary: string, stateDir: string, timeoutMs = 40_000): AdRun {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(stateDir, 0o700);
  return (args, input) => new Promise(resolve => {
    const child = spawn(binary, args, { env: { ...process.env, AGENT_DESKTOP_HOME: stateDir }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: { code: 'client_error', message: error.message } }); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout) as AdEnvelope);
      } catch {
        resolve({ ok: false, error: { code: 'client_error', message: stderr.trim() || `agent-desktop exited with code ${code ?? 'unknown'}.` } });
      }
    });
    child.stdin.end(input ?? '');
  });
}
