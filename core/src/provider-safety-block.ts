const safetyBlockPrefix = 'Conversation blocked by provider. Automatic retries are stopped.\n\n';

/** Provider policy stops are terminal, not transport or quota failures. */
export function providerSafetyBlockMessage(value: unknown): string | null {
  const error = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const message = typeof value === 'string' ? value : typeof error.message === 'string' ? error.message : '';
  const code = error.codexErrorInfo ?? error.code;
  if (code !== 'misalignment_policy_violation' && code !== 'misalignmentPolicyViolation'
    && !message.includes('misalignment_policy_violation')
    && !message.includes('This request was blocked by our safety systems.')
    && !message.startsWith('Conversation blocked by provider.')) return null;
  return message.startsWith('Conversation blocked by provider.') ? message
    : safetyBlockPrefix + (message || 'The provider stopped this conversation for safety review.');
}

/** The provider's original error, without the application's status heading. */
export function providerSafetyBlockDetails(value: unknown): string | null {
  const message = providerSafetyBlockMessage(value);
  return message?.startsWith(safetyBlockPrefix) ? message.slice(safetyBlockPrefix.length) : message;
}

export type ProviderSafetyReviewTarget = { id: string; conversationId: string; turnId: string };
export type ProviderSafetyReview = ProviderSafetyReviewTarget & { explanation: string | null; canContinue: boolean };

export function isProviderSafetyReviewTarget(value: unknown): value is ProviderSafetyReviewTarget {
  if (!value || typeof value !== 'object') return false;
  const review = value as ProviderSafetyReviewTarget;
  return [review.id, review.conversationId, review.turnId].every(item => typeof item === 'string' && item.trim().length > 0);
}
export function isProviderSafetyReview(value: unknown): value is ProviderSafetyReview {
  if (!isProviderSafetyReviewTarget(value)) return false;
  const review = value as ProviderSafetyReview;
  return (review.explanation === null || typeof review.explanation === 'string') && typeof review.canContinue === 'boolean'
    && (!review.canContinue || Boolean(review.explanation?.trim()));
}
