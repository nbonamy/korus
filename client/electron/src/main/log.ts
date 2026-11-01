import log from 'electron-log/main';

const maxRendererMessageLength = 4_000;
let initialized = false;
let processHandlersInstalled = false;

export function initializeMainLogging(): void {
  if (initialized || process.env.NODE_ENV === 'test') {
    return;
  }

  log.initialize({ preload: false, spyRendererConsole: false });
  const configuredLevel = process.env.APP_LOG_LEVEL?.trim().toLowerCase();
  if (log.transports.file) {
    log.transports.file.level = configuredLevel === 'debug' ? 'debug' : 'info';
    log.transports.file.maxSize = 5 * 1024 * 1024;
  }
  initialized = true;
  log.info('[agent-workspace:startup] logging initialized', { logFile: log.transports.file?.getFile().path });
}

export function installProcessErrorLogging(): void {
  if (processHandlersInstalled || process.env.NODE_ENV === 'test') {
    return;
  }

  processHandlersInstalled = true;
  process.on('uncaughtExceptionMonitor', (error) => {
    errorMain('process', 'uncaught exception', { detail: error instanceof Error ? error.message : String(error) });
  });
  process.on('unhandledRejection', (reason) => {
    errorMain('process', 'unhandled rejection', { detail: reason instanceof Error ? reason.message : String(reason) });
  });
}

export function logMain(area: string, message: string, details?: Record<string, unknown>): void {
  write('info', area, message, details);
}

export function warnMain(area: string, message: string, details?: Record<string, unknown>): void {
  write('warn', area, message, details);
}

function errorMain(area: string, message: string, details?: Record<string, unknown>): void {
  write('error', area, message, details);
}

export function logRendererConsole(
  level: number,
  message: string,
  details: { line?: number; sourceId?: string } = {},
): void {
  const normalized = normalizeRendererConsoleMessage(message);
  if (!normalized) {
    return;
  }

  const method = level >= 3 ? 'error' : level >= 2 ? 'warn' : level === 0 ? 'debug' : 'info';
  write(method, 'renderer', normalized, {
    ...(details.line !== undefined ? { line: details.line } : {}),
    ...(details.sourceId ? { sourceId: redactText(details.sourceId) } : {}),
  });
}

export function normalizeRendererConsoleMessage(message: string): string | null {
  const normalized = redactText(message).slice(0, maxRendererMessageLength);
  return normalized && !isIgnoredRendererMessage(normalized) ? normalized : null;
}

function write(level: 'debug' | 'info' | 'warn' | 'error', area: string, message: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  initializeMainLogging();
  const suffix = details ? ` ${safeJson(details)}` : '';
  log[level](`[agent-workspace:${area}] ${redactText(message)}${suffix}`);
}

function safeJson(details: Record<string, unknown>): string {
  try {
    return JSON.stringify(details, (key, value: unknown) => {
      if (/^(?:authorization|access[_-]?token|refresh[_-]?token|password|secret|prompt|content)$/i.test(key)) {
        return '[redacted]';
      }
      return typeof value === 'string' ? redactText(value) : value;
    }).slice(0, maxRendererMessageLength);
  } catch {
    return JSON.stringify({ detail: 'unserializable' });
  }
}

function redactText(value: string): string {
  return value
    .replace(/((?:authorization|access[_-]?token|refresh[_-]?token|password|secret|prompt|content)\s*[=:]\s*)([^,\s}]+)/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]');
}

function isIgnoredRendererMessage(message: string): boolean {
  return message.includes('Electron Security Warning') || message.includes('Third-party cookie will be blocked');
}
