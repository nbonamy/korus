import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sink = vi.hoisted(() => ({
  initialize: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  transports: { file: { level: '', maxSize: 0, getFile: () => ({ path: '/test/main.log' }) } },
}));
vi.mock('electron-log/main', () => ({ default: sink }));
import { normalizeRendererConsoleMessage } from '../log';

describe('main logging', () => {
  it('redacts sensitive renderer values and bounds message size', () => {
    const message = `prompt=secret ${'x'.repeat(5_000)}`;
    const normalized = normalizeRendererConsoleMessage(message);

    expect(normalized).toContain('prompt=[redacted]');
    expect(normalized?.length).toBe(4_000);
  });

  it('drops noisy browser security diagnostics', () => {
    expect(normalizeRendererConsoleMessage('Electron Security Warning: test')).toBeNull();
    expect(normalizeRendererConsoleMessage('Third-party cookie will be blocked')).toBeNull();
  });
});

describe('logging sink boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('initializes once with bounded files and routes renderer severity without noisy diagnostics', async () => {
    vi.stubEnv('APP_LOG_LEVEL', ' DEBUG ');
    const logging = await import('../log');
    logging.initializeMainLogging();
    logging.initializeMainLogging();
    expect(sink.initialize).toHaveBeenCalledOnce();
    expect(sink.transports.file).toMatchObject({ level: 'debug', maxSize: 5 * 1024 * 1024 });
    sink.info.mockClear();
    for (const [level, method] of [[0, 'debug'], [1, 'info'], [2, 'warn'], [3, 'error']] as const) {
      logging.logRendererConsole(level, 'Bearer token-value', { line: 7, sourceId: 'password=hidden' });
      expect(sink[method]).toHaveBeenLastCalledWith('[agent-workspace:renderer] Bearer [redacted] {"line":7,"sourceId":"password=[redacted]"}');
    }
    logging.logRendererConsole(3, 'Electron Security Warning: noisy');
    logging.logRendererConsole(3, '');
    expect(sink.error).toHaveBeenCalledOnce();
  });

  it('redacts structured credentials and multiword content before writing diagnostics', async () => {
    const { logMain } = await import('../log');
    logMain('backend', 'request failed', {
      password: 'private password', nested: { access_token: 'private-token', content: 'private message' },
      detail: 'safe diagnostic',
    });
    const output = sink.info.mock.calls.at(-1)![0] as string;
    expect(output).not.toContain('private');
    expect(output).toContain('safe diagnostic');
    expect(output).toContain('[redacted]');
  });

  it('handles unserializable details and bounds serialized diagnostics', async () => {
    const { warnMain, logMain } = await import('../log');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    warnMain('backend', 'cycle', circular);
    expect(sink.warn).toHaveBeenCalledWith('[agent-workspace:backend] cycle {"detail":"unserializable"}');
    logMain('backend', 'large', { detail: 'x'.repeat(5000) });
    expect(sink.info.mock.calls.at(-1)![0]).toHaveLength('[agent-workspace:backend] large '.length + 4000);
    expect(sink.transports.file.level).toBe('info');
  });

  it('installs error monitors only once and records errors without changing process behavior', async () => {
    const on = vi.spyOn(process, 'on').mockReturnValue(process);
    const { installProcessErrorLogging } = await import('../log');
    installProcessErrorLogging();
    installProcessErrorLogging();
    const listeners = on.mock.calls.filter(([event]) => event === 'uncaughtExceptionMonitor' || event === 'unhandledRejection');
    expect(listeners.map(([event]) => event)).toStrictEqual(['uncaughtExceptionMonitor', 'unhandledRejection']);
    for (const [, listener] of listeners) listener(new Error('Bearer confidential'));
    expect(sink.error).toHaveBeenCalledTimes(2);
    expect(sink.error.mock.calls.flat().join(' ')).not.toContain('confidential');
  });
});
