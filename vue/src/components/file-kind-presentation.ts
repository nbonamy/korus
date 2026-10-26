import type { FileKind } from '@workspace/core/file-kind';
import { translate } from '../i18n';

export function fileKindLabel(kind: FileKind): string {
  return translate(`surface.fileKind.${kind}`);
}

export function fileKindCount(count: number): string {
  return translate('surface.fileKind.fileCount', { count });
}

/** One steady color per kind, shared by the header menu and the review panel. */
export const fileKindColor: Record<FileKind, string> = {
  code: 'var(--color-primary)',
  test: 'var(--color-success)',
  docs: 'var(--color-warning)',
  other: 'var(--color-text-muted)',
};
