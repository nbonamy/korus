import { product } from '@workspace/core/product';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const helperAppName = `${product.name} Computer Use.app`;
const helperExecutableName = 'computer-use-pilot';
const timeoutMs = 30_000;
export const computerUseSessionTimeoutMs = 30_000;

const computerUseCommands = [
  'status',
  'request_accessibility',
  'request_screen_capture',
  'screenshot',
  'list_apps',
  'list_windows',
  'find_apps',
  'launch_app',
  'focus_app',
  'get_app_state',
  'click',
  'dismiss',
  'press_key',
  'type_text',
  'paste',
  'set_value',
  'select_text',
  'scroll',
  'drag',
  'perform_secondary_action',
] as const;

export type ComputerUseCommand = (typeof computerUseCommands)[number];

const cursorlessComputerUseCommands = new Set<ComputerUseCommand>([
  'status',
  'request_accessibility',
  'request_screen_capture',
  'screenshot',
  'list_apps',
  'list_windows',
  'find_apps',
]);

export type ComputerUseStatus = {
  accessibilityTrusted: boolean;
  screenCaptureTrusted: boolean;
  available: boolean;
  error?: string;
  helperAppPath?: string;
  helperPath?: string;
  helperVersion?: string;
  platform: NodeJS.Platform;
};

export type ComputerUseResult =
  | { ok: true; result: unknown }
  | { error: string; errorCode: string; ok: false };

export type ComputerUseOptions = {
  appPath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
  pilotPath?: string;
  /** Testable override; production keeps the visual session alive for thirty seconds after its last action. */
  idleTtlMs?: number;
};

let livePilot: PersistentPilot | null = null;

export async function getComputerUseStatus(options: ComputerUseOptions): Promise<ComputerUseStatus> {
  if (options.platform !== 'darwin') {
    return unavailableStatus(options, 'Computer Use is currently available only on macOS.');
  }

  const helperPath = resolveComputerUsePilotPath(options);
  if (!helperPath) {
    return unavailableStatus(options, 'Computer Use helper is not built. Run npm run build:computer-use.', resolveComputerUseHelperAppPath(options));
  }

  const response = await executeComputerUseCommand({ command: 'status', arguments: {}, options });
  if (!response.ok) {
    return unavailableStatus(options, response.error, helperAppPathFromPilotPath(helperPath), helperPath);
  }

  const result = record(response.result);
  return {
    accessibilityTrusted: result?.accessibilityTrusted === true,
    screenCaptureTrusted: result?.screenCaptureTrusted === true,
    available: true,
    helperAppPath: helperAppPathFromPilotPath(helperPath),
    helperPath,
    ...(typeof result?.version === 'string' ? { helperVersion: result.version } : {}),
    platform: options.platform,
  };
}

export async function requestComputerUseAccessibility(options: ComputerUseOptions): Promise<ComputerUseStatus> {
  await executeComputerUseCommand({
    command: 'request_accessibility',
    arguments: { openSettings: true, prompt: true },
    options,
  });
  return getComputerUseStatus(options);
}

export async function requestComputerUseScreenCapture(options: ComputerUseOptions): Promise<ComputerUseStatus> {
  await executeComputerUseCommand({
    command: 'request_screen_capture',
    arguments: {},
    options,
  });
  return getComputerUseStatus(options);
}

export async function executeComputerUseCommand(input: {
  command: ComputerUseCommand;
  arguments: Record<string, unknown>;
  options: ComputerUseOptions;
}): Promise<ComputerUseResult> {
  if (input.options.platform !== 'darwin') {
    return failure('tool_unavailable', 'Computer Use is currently available only on macOS.');
  }

  const pilotPath = resolveComputerUsePilotPath(input.options);
  if (!pilotPath) {
    return failure('tool_unavailable', 'Computer Use helper is not built. Run npm run build:computer-use.');
  }

  const commandArguments = cursorlessComputerUseCommands.has(input.command)
    ? { ...input.arguments, showCursor: false }
    : input.arguments;
  const response = await runPilotRequest(pilotPath, {
    arguments: commandArguments,
    command: input.command,
    id: crypto.randomUUID(),
  }, input.options.idleTtlMs ?? computerUseSessionTimeoutMs);
  return response;
}

/** Ends the shared helper during Electron shutdown (and in desktop tests). */
export function stopComputerUseHelper(): void {
  livePilot?.stop();
  livePilot = null;
}

export function isComputerUseCommand(value: unknown): value is ComputerUseCommand {
  return typeof value === 'string' && (computerUseCommands as readonly string[]).includes(value);
}

function resolveComputerUsePilotPath(options: ComputerUseOptions): string | null {
  const candidates = [
    options.pilotPath,
    process.env.APP_COMPUTER_USE_PILOT_PATH,
    options.isPackaged
      ? path.join(options.resourcesPath, helperAppName, 'Contents', 'MacOS', helperExecutableName)
      : undefined,
    path.resolve(options.appPath, '.computer-use', helperAppName, 'Contents', 'MacOS', helperExecutableName),
    path.resolve(process.cwd(), '.computer-use', helperAppName, 'Contents', 'MacOS', helperExecutableName),
    path.resolve(process.cwd(), 'electron', '.computer-use', helperAppName, 'Contents', 'MacOS', helperExecutableName),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(isExecutable) ?? null;
}

export function resolveComputerUseHelperAppPath(options: ComputerUseOptions): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, helperAppName)
    : path.resolve(options.appPath, '.computer-use', helperAppName);
}

function unavailableStatus(options: ComputerUseOptions, error: string, helperAppPath?: string, helperPath?: string): ComputerUseStatus {
  return {
    accessibilityTrusted: false,
    screenCaptureTrusted: false,
    available: false,
    error,
    ...(helperAppPath ? { helperAppPath } : {}),
    ...(helperPath ? { helperPath } : {}),
    platform: options.platform,
  };
}

function runPilotRequest(pilotPath: string, request: Record<string, unknown>, idleTtlMs: number): Promise<ComputerUseResult> {
  if (!livePilot || livePilot.pilotPath !== pilotPath || livePilot.stopped) {
    livePilot?.stop();
    livePilot = new PersistentPilot(pilotPath, idleTtlMs, () => {
      livePilot = null;
    });
  }
  return livePilot.request(request);
}

class PersistentPilot {
  readonly pilotPath: string;
  stopped = false;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly idleTtlMs: number;
  private readonly onStopped: () => void;
  private readonly pending = new Map<string, { finish: (result: ComputerUseResult) => void; timeout: NodeJS.Timeout }>();
  private finished = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private stderr = '';
  private stdout = '';

  constructor(pilotPath: string, idleTtlMs: number, onStopped: () => void) {
    this.pilotPath = pilotPath;
    this.idleTtlMs = Math.max(1, idleTtlMs);
    this.onStopped = onStopped;
    this.child = spawn(pilotPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.child.on('error', (error) => this.finishAll(failure('client_error', error.message)));
    this.child.on('close', (code) => this.finishAll(failure('client_error', this.stderr.trim() || `Computer Use helper exited with code ${code ?? 'unknown'}.`)));
  }

  request(request: Record<string, unknown>): Promise<ComputerUseResult> {
    const id = typeof request.id === 'string' ? request.id : null;
    if (!id || this.stopped) return Promise.resolve(failure('client_error', 'Computer Use helper is not running.'));
    this.clearIdleTimer();
    return new Promise((resolve) => {
      const finish = (result: ComputerUseResult) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        this.scheduleIdleStop();
        resolve(result);
      };
      const timeout = setTimeout(() => finish(failure('timeout', 'Computer Use helper timed out.')), timeoutMs);
      this.pending.set(id, { finish, timeout });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) finish(failure('client_error', error.message));
      });
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearIdleTimer();
    this.child.stdin.end();
    this.child.kill();
    this.finishAll(failure('client_error', 'Computer Use helper stopped.'));
  }

  private handleStdout(chunk: string): void {
    this.stdout += chunk;
    let newline = this.stdout.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdout.slice(0, newline);
      this.stdout = this.stdout.slice(newline + 1);
      const response = parseResponse(line);
      const id = responseId(line);
      if (id) this.pending.get(id)?.finish(response);
      newline = this.stdout.indexOf('\n');
    }
  }

  private scheduleIdleStop(): void {
    if (this.pending.size > 0 || this.stopped) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.stop(), this.idleTtlMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private finishAll(result: ComputerUseResult): void {
    if (this.finished) return;
    this.finished = true;
    this.stopped = true;
    this.clearIdleTimer();
    for (const { finish } of this.pending.values()) finish(result);
    this.onStopped();
  }
}

function responseId(line: string): string | null {
  try {
    const id = (JSON.parse(line) as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function parseResponse(line: string): ComputerUseResult {
  try {
    const response = JSON.parse(line) as { error?: { code?: string; message?: string }; ok?: boolean; result?: unknown };
    if (response.ok) return { ok: true, result: response.result };
    return failure(normalizeErrorCode(response.error?.code), response.error?.message ?? 'Computer Use helper returned an error.');
  } catch (error) {
    return failure('client_error', error instanceof Error ? `Unable to parse Computer Use response: ${error.message}` : 'Unable to parse Computer Use response.');
  }
}

function normalizeErrorCode(code: string | undefined): string {
  return code || 'client_error';
}

function failure(errorCode: string, error: string): ComputerUseResult {
  return { error, errorCode, ok: false };
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function helperAppPathFromPilotPath(pilotPath: string): string {
  return path.dirname(path.dirname(path.dirname(pilotPath)));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
