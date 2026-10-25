export type AppErrorCode =
  | 'clone.alreadyExists'
  | 'clone.discoveryFailed'
  | 'clone.invalidName'
  | 'clone.sourceFolderMissing'
  | 'clone.urlRequired'
  | 'createRepository.alreadyExists'
  | 'createRepository.discoveryFailed'
  | 'createRepository.invalidName'
  | 'createRepository.nameRequired'
  | 'createRepository.sourceFolderMissing'
  | 'git.pullRequestChangesRequired'
  | 'git.mergeRequestChangesRequired'
  | 'engineSetup.confirmationRequired'
  | 'engineSetup.rosterChanged'
  | 'engineSetup.agentsBusy'
  | 'engineSetup.reviewActive'
  | 'engineSetup.missionActive';

export const appErrorCodes: readonly AppErrorCode[] = [
  'clone.alreadyExists',
  'clone.discoveryFailed',
  'clone.invalidName',
  'clone.sourceFolderMissing',
  'clone.urlRequired',
  'createRepository.alreadyExists',
  'createRepository.discoveryFailed',
  'createRepository.invalidName',
  'createRepository.nameRequired',
  'createRepository.sourceFolderMissing',
  'git.pullRequestChangesRequired',
  'git.mergeRequestChangesRequired',
  'engineSetup.confirmationRequired',
  'engineSetup.rosterChanged',
  'engineSetup.agentsBusy',
  'engineSetup.reviewActive',
  'engineSetup.missionActive',
];

export type AppErrorDescriptor = {
  kind: 'appError';
  code: AppErrorCode;
  params?: Record<string, string | number>;
};

const encodedAppErrorPrefix = 'agent-workspace-app-error:';

export class AppError extends Error {
  readonly descriptor: AppErrorDescriptor;

  constructor(code: AppErrorCode, message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'AppError';
    this.descriptor = params ? { kind: 'appError', code, params } : { kind: 'appError', code };
  }
}

export function appErrorDescriptor(value: unknown): AppErrorDescriptor | null {
  if (value instanceof AppError) return value.descriptor;
  if (!isRecord(value) || value.kind !== 'appError' || !isAppErrorCode(value.code)) return null;
  if (value.params !== undefined && !isAppErrorParams(value.params)) return null;
  return value.params
    ? { kind: 'appError', code: value.code, params: value.params }
    : { kind: 'appError', code: value.code };
}

export function encodeAppErrorDescriptor(descriptor: AppErrorDescriptor, fallbackMessage: string): string {
  return `${encodedAppErrorPrefix}${encodeURIComponent(JSON.stringify(descriptor))} ${fallbackMessage}`;
}

export function decodeAppErrorDescriptor(value: unknown): AppErrorDescriptor | null {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  const start = message.indexOf(encodedAppErrorPrefix);
  if (start < 0) return null;
  const encodedStart = start + encodedAppErrorPrefix.length;
  const encodedEnd = message.indexOf(' ', encodedStart);
  const encoded = message.slice(encodedStart, encodedEnd < 0 ? undefined : encodedEnd);
  try {
    return appErrorDescriptor(JSON.parse(decodeURIComponent(encoded)));
  } catch {
    return null;
  }
}

export function encodedAppError(error: unknown): Error {
  const descriptor = appErrorDescriptor(error instanceof AppError ? error : undefined)
    ?? (isRecord(error) ? appErrorDescriptor(error.data) : null);
  const fallback = error instanceof Error ? error.message : String(error);
  return descriptor ? new Error(encodeAppErrorDescriptor(descriptor, fallback)) : new Error(fallback);
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && appErrorCodes.includes(value as AppErrorCode);
}

function isAppErrorParams(value: unknown): value is Record<string, string | number> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string' || typeof entry === 'number');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
