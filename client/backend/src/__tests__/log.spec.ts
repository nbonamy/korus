import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalNodeEnv = process.env.NODE_ENV;
let tempDir: string | null = null;

beforeEach(async () => {
  vi.resetModules();
  tempDir = await mkdtemp(path.join(tmpdir(), 'agent-workspace-log-'));
  vi.stubEnv('APP_HOME', tempDir);
  vi.stubEnv('NODE_ENV', 'development');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  const { resetBackendLoggerForTests } = await import('../log');
  resetBackendLoggerForTests();
  if (originalNodeEnv === undefined) {
    vi.unstubAllEnvs();
    delete process.env.NODE_ENV;
  } else {
    vi.unstubAllEnvs();
    process.env.NODE_ENV = originalNodeEnv;
  }
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('backend logging', () => {
  it('writes structured backend logs under APP_HOME and mirrors warn+ to stderr', async () => {
    const { backendLogFilePath, flushBackendLogs, logMain, warnMain } = await import('../log');

    logMain('mcp-http', 'listening', {
      accessToken: 'gho_secret',
      prompt: 'do not write prompts',
      url: 'http://127.0.0.1:1234/mcp',
    });
    warnMain('mcp-tool', 'error', { tool: 'send_message', message: 'failed' });
    await flushBackendLogs();

    expect(backendLogFilePath()).toBe(path.join(tempDir!, 'logs', 'daemon.log'));
    const records = await readJsonLogRecords(backendLogFilePath());
    expect(records).toMatchObject([
      {
        level: 'info',
        service: 'daemon',
        area: 'mcp-http',
        msg: 'listening',
        accessToken: '[redacted]',
        prompt: '[redacted]',
        url: 'http://127.0.0.1:1234/mcp',
      },
      {
        level: 'warn',
        service: 'daemon',
        area: 'mcp-tool',
        msg: 'error',
        message: 'failed',
        tool: 'send_message',
      },
    ]);

    const stderrOutput = stderrWrites();
    expect(stderrOutput).toContain('"level":"warn"');
    expect(stderrOutput).not.toContain('"level":"info"');
  });

  it('rotates backend log files when the current file reaches the size limit', async () => {
    vi.stubEnv('APP_LOG_MAX_BYTES', '320');
    vi.stubEnv('APP_LOG_MAX_FILES', '2');
    const { backendLogDirectoryPath, flushBackendLogs, logMain } = await import('../log');

    for (let index = 0; index < 8; index += 1) {
      logMain('rotation-test', 'line', {
        index,
        payload: 'x'.repeat(80),
      });
    }
    await flushBackendLogs();

    await expect(readdir(backendLogDirectoryPath())).resolves.toEqual(expect.arrayContaining([
      'daemon.log',
      'daemon.1.log',
      'daemon.2.log',
    ]));
  });

  it('allows the stderr mirror threshold to be raised independently from the file log level', async () => {
    vi.stubEnv('APP_LOG_STDERR_LEVEL', 'error');
    const { flushBackendLogs, warnMain, errorMain } = await import('../log');

    warnMain('stderr-test', 'warn only');
    errorMain('stderr-test', 'error mirrored');
    await flushBackendLogs();

    const stderrOutput = stderrWrites();
    expect(stderrOutput).toContain('"level":"error"');
    expect(stderrOutput).not.toContain('"level":"warn"');
  });
});

async function readJsonLogRecords(filePath: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(filePath, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function stderrWrites(): string {
  return vi.mocked(process.stderr.write).mock.calls
    .map(([chunk]) => Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
    .join('');
}
