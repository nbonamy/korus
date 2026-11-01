import { BANKED_RESET_DETAIL_LIMIT, isBankedResets, type BankedResets } from '@workspace/core/contracts/banked-resets';
import type { CodexSurfaceRateLimits } from '@codex-app-sdk/core/surface';

/** Keep IDs/provider metadata out of the app DTO; validate exact counts and timestamps. */
export function bankedResetsFromSurface(limits: CodexSurfaceRateLimits, redemptionToken?: (id: string) => string): BankedResets {
  const summary = limits.rateLimitResetCredits;
  const result: BankedResets = { status: 'ready', accountCredits: limits.rateLimits.credits ? {
    hasCredits: limits.rateLimits.credits.hasCredits, unlimited: limits.rateLimits.credits.unlimited,
    balance: limits.rateLimits.credits.balance,
  } : null, summary: summary === null ? null : {
    availableCount: summary.availableCount,
    credits: summary.credits?.slice(0, BANKED_RESET_DETAIL_LIMIT).map(credit => ({
      ...(redemptionToken && credit.status === 'available' && typeof credit.id === 'string' && credit.id.trim()
        ? { redemptionToken: redemptionToken(credit.id) } : {}),
      resetType: credit.resetType, status: credit.status,
      grantedAt: credit.grantedAt, expiresAt: credit.expiresAt,
      title: credit.title, description: credit.description,
    })) ?? null,
    detailCount: summary.credits?.length ?? null,
  } };
  if (!isBankedResets(result)) throw new Error('Invalid banked reset response');
  return result;
}
