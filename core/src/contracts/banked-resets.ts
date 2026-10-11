/** Read-only account display. Opaque provider reset IDs never leave the driver. */
export type BankedResetDetail = {
  resetType: string;
  status: string;
  grantedAt: number;
  expiresAt: number | null;
  title: string | null;
  description: string | null;
};

export type BankedResets =
  | { status: 'signedOut' | 'unsupported' }
  | { status: 'ready'; summary: {
    /** Exact decimal integer, independent of detail-list length. */
    availableCount: string;
    credits: BankedResetDetail[] | null;
    /** Number of detail rows returned by the provider, before display bounding. */
    detailCount: number | null;
  } | null };

export const BANKED_RESET_DETAIL_LIMIT = 100;

export function isBankedResets(value: unknown): value is BankedResets {
  if (!record(value)) return false;
  if (value.status === 'signedOut' || value.status === 'unsupported') return true;
  if (value.status !== 'ready') return false;
  if (value.summary === null) return true;
  const summary = value.summary;
  return record(summary) && typeof summary.availableCount === 'string'
    && /^(0|[1-9][0-9]*)$/.test(summary.availableCount)
    && (summary.credits === null ? summary.detailCount === null
      : Array.isArray(summary.credits) && summary.credits.length <= BANKED_RESET_DETAIL_LIMIT
        && Number.isSafeInteger(summary.detailCount) && (summary.detailCount as number) >= summary.credits.length
        && summary.credits.every(detail));
}

function detail(value: unknown): boolean {
  return record(value) && typeof value.resetType === 'string' && typeof value.status === 'string'
    && timestamp(value.grantedAt) && (value.expiresAt === null || timestamp(value.expiresAt))
    && nullableString(value.title) && nullableString(value.description);
}
function timestamp(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000;
}
function nullableString(value: unknown): boolean { return value === null || typeof value === 'string'; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
