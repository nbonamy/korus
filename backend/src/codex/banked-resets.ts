import { BANKED_RESET_DETAIL_LIMIT, isBankedResets, type BankedResets } from '@workspace/core/contracts/banked-resets';
import type { CodexSurfaceRateLimits } from '@codex-app-sdk/core/surface';

/** Keep IDs/provider metadata out of the app DTO; validate exact counts and timestamps. */
export function bankedResetsFromSurface(limits: CodexSurfaceRateLimits): BankedResets {
  const summary = limits.rateLimitResetCredits;
  const result: BankedResets = { status: 'ready', summary: summary === null ? null : {
    availableCount: summary.availableCount,
    credits: summary.credits?.slice(0, BANKED_RESET_DETAIL_LIMIT).map(credit => ({
      resetType: credit.resetType, status: credit.status,
      grantedAt: credit.grantedAt, expiresAt: credit.expiresAt,
      title: credit.title, description: credit.description,
    })) ?? null,
    detailCount: summary.credits?.length ?? null,
  } };
  if (!isBankedResets(result)) throw new Error('Invalid banked reset response');
  return result;
}
