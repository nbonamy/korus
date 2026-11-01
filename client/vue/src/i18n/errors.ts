import { decodeAppErrorDescriptor } from '@workspace/core/app-error';
import type { AppText } from '@workspace/core/contracts';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function localizedErrorMessage(error: unknown, translate: Translate): string {
  const descriptor = decodeAppErrorDescriptor(error);
  if (descriptor) return translate(`errors.${descriptor.code}`, descriptor.params);
  return error instanceof Error ? error.message : String(error);
}

export function localizedText(value: AppText | null | undefined, translate: Translate): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : translate(value.key, value.params);
}
