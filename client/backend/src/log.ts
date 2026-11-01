import { product } from '@workspace/core/product';
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino, { type Logger, type LevelWithSilent } from 'pino';

const defaultMaxLogBytes = 5 * 1024 * 1024;
const defaultMaxLogFiles = 5;
type EnabledLogLevel = Exclude<LevelWithSilent, 'silent'>;

const levelValues = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} satisfies Record<EnabledLogLevel, number>;

let logger: Logger | null = null;
let logStream: RotatingJsonLogStream | null = null;

export function logMain(area: string, message: string, details?: Record<string, unknown>): void {
  infoMain(area, message, details);
}

export function debugMain(area: string, message: string, details?: Record<string, unknown>): void {
  writeLog('debug', area, message, details);
}

function infoMain(area: string, message: string, details?: Record<string, unknown>): void {
  writeLog('info', area, message, details);
}

export function warnMain(area: string, message: string, details?: Record<string, unknown>): void {
  writeLog('warn', area, message, details);
}

export function errorMain(area: string, message: string, details?: Record<string, unknown>): void {
  writeLog('error', area, message, details);
}

export function backendLogFilePath(): string {
  return path.join(backendLogDirectoryPath(), 'daemon.log');
}

export function backendLogDirectoryPath(): string {
  const home = process.env.APP_HOME?.trim() || path.join(homedir(), product.homeDirectory);
  return path.join(home, 'logs');
}

export async function flushBackendLogs(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await logStream?.flush();
  }
}

export function resetBackendLoggerForTests(): void {
  logger = null;
  logStream = null;
}

function writeLog(level: EnabledLogLevel, area: string, message: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  getLogger()[level]({
    area,
    ...details,
  }, message);
}

function getLogger(): Logger {
  if (!logger) {
    logStream = new RotatingJsonLogStream({
      filePath: backendLogFilePath(),
      maxBytes: logMaxBytes(),
      maxFiles: logMaxFiles(),
    });
    logger = pino({
      base: {
        service: 'daemon',
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
      level: logLevel(),
      messageKey: 'msg',
      redact: {
        censor: '[redacted]',
        paths: [
          'authorization',
          'Authorization',
          'accessToken',
          'refreshToken',
          'token',
          'password',
          'secret',
          'clientSecret',
          'client_secret',
          'prompt',
          'content',
          '*.authorization',
          '*.Authorization',
          '*.accessToken',
          '*.refreshToken',
          '*.token',
          '*.password',
          '*.secret',
          '*.clientSecret',
          '*.client_secret',
          '*.prompt',
          '*.content',
        ],
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    }, logStream);
  }

  return logger;
}

class RotatingJsonLogStream extends Writable {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private currentSize: number | null = null;

  constructor(options: { filePath: string; maxBytes: number; maxFiles: number }) {
    super();
    this.filePath = options.filePath;
    this.maxBytes = options.maxBytes;
    this.maxFiles = options.maxFiles;
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    try {
      this.writeChunk(buffer);
    } catch (error) {
      process.stderr.write(`[daemon:log] failed to write log file ${error instanceof Error ? error.message : String(error)}\n`);
    }
    callback();
  }

  async flush(): Promise<void> {}

  private writeChunk(buffer: Buffer): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    if (this.currentSize === null) {
      this.currentSize = fileSize(this.filePath);
    }
    if (this.currentSize > 0 && this.currentSize + buffer.byteLength > this.maxBytes) {
      this.rotate();
    }
    appendFileSync(this.filePath, buffer, { encoding: 'utf8', mode: 0o600 });
    this.currentSize += buffer.byteLength;

    if (shouldMirrorToStderr(buffer)) {
      process.stderr.write(buffer);
    }
  }

  private rotate(): void {
    if (this.maxFiles <= 0) {
      rmSync(this.filePath, { force: true });
      this.currentSize = 0;
      return;
    }

    rmSync(rotatedLogFilePath(this.filePath, this.maxFiles), { force: true });
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      renameIfExists(rotatedLogFilePath(this.filePath, index), rotatedLogFilePath(this.filePath, index + 1));
    }
    renameIfExists(this.filePath, rotatedLogFilePath(this.filePath, 1));
    this.currentSize = 0;
  }
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function renameIfExists(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function shouldMirrorToStderr(buffer: Buffer): boolean {
  try {
    const record = JSON.parse(buffer.toString()) as { level?: string };
    const recordLevel = logLevelValue(record.level);
    const threshold = stderrLogLevel();
    return isEnabledLogLevel(threshold) && recordLevel !== null && recordLevel >= levelValues[threshold];
  } catch {
    return false;
  }
}

function rotatedLogFilePath(filePath: string, index: number): string {
  const extension = path.extname(filePath);
  const basename = extension ? filePath.slice(0, -extension.length) : filePath;
  return `${basename}.${index}${extension || '.log'}`;
}

function logLevel(): LevelWithSilent {
  const configured = process.env.APP_LOG_LEVEL?.trim().toLowerCase();
  return isPinoLevel(configured) ? configured : 'info';
}

function stderrLogLevel(): LevelWithSilent {
  const configured = process.env.APP_LOG_STDERR_LEVEL?.trim().toLowerCase();
  return isPinoLevel(configured) ? configured : 'warn';
}

function logMaxBytes(): number {
  const configured = Number.parseInt(process.env.APP_LOG_MAX_BYTES ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultMaxLogBytes;
}

function logMaxFiles(): number {
  const configured = Number.parseInt(process.env.APP_LOG_MAX_FILES ?? '', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : defaultMaxLogFiles;
}

function isPinoLevel(value: string | undefined): value is LevelWithSilent {
  return value === 'trace' ||
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'fatal' ||
    value === 'silent';
}

function isEnabledLogLevel(value: string | undefined): value is EnabledLogLevel {
  return value === 'trace' ||
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'fatal';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function logLevelValue(value: string | undefined): number | null {
  return isEnabledLogLevel(value) ? levelValues[value] : null;
}
