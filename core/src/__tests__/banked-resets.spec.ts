import { describe, expect, it } from 'vitest';
import { isBankedResets, isBankedResetResult, isUseBankedResetInput } from '../contracts/banked-resets';

const credit = { resetType: 'fiveHour', status: 'available', grantedAt: 100, expiresAt: null, title: null, description: '<b>Plain text</b>' };
describe('banked reset transport contract', () => {
  it.each([
    { status: 'unsupported' }, { status: 'signedOut' }, { status: 'ready', summary: null },
    { status: 'ready', summary: { availableCount: '0', credits: [], detailCount: 0 } },
    { status: 'ready', summary: { availableCount: '18446744073709551615', credits: null, detailCount: null } },
    { status: 'ready', summary: { availableCount: '200', credits: [credit], detailCount: 150 } },
  ])('accepts exact count and partial-detail states: %j', value => { expect(isBankedResets(value)).toBe(true); });

  it.each([
    null, { status: 'ready' },
    ...[1, '1.5', '-1', '01', '1e20'].map(availableCount => ({ status: 'ready', summary: { availableCount, credits: null, detailCount: null } })),
    { status: 'ready', summary: { availableCount: '1', credits: [credit], detailCount: null } },
    { status: 'ready', summary: { availableCount: '1', credits: [credit], detailCount: 0 } },
    { status: 'ready', summary: { availableCount: '200', credits: Array(101).fill(credit), detailCount: 101 } },
    ...[NaN, Infinity, 1.5, 9_000_000_000_000].map(expiresAt => ({ status: 'ready', summary: { availableCount: '1', credits: [{ ...credit, expiresAt }], detailCount: 1 } })),
    { status: 'ready', summary: { availableCount: '1', credits: [{ ...credit, title: {} }], detailCount: 1 } },
  ])('rejects unsafe or malformed display payloads: %j', value => { expect(isBankedResets(value)).toBe(false); });

  it('accepts optional account-bound references and exact read-only credit balances', () => {
    const payload = { status: 'ready', accountCredits: { hasCredits: true, unlimited: false, balance: '9007199254740993.25' }, summary: { availableCount: '1', credits: [{ ...credit, redemptionToken: 'account-bound-reference' }], detailCount: 1 } };
    expect(isBankedResets(payload)).toBe(true);
    expect(isBankedResets({ ...payload, accountCredits: { ...payload.accountCredits, balance: 12 } })).toBe(false);
    expect(isBankedResets({ ...payload, summary: { ...payload.summary, credits: [{ ...credit, redemptionToken: '' }] } })).toBe(false);
  });
  it('requires confirmation and bounded nonblank attempt references, and validates all redemption outcomes', () => {
    const input = { confirmed: true, redemptionToken: 'selection', idempotencyKey: 'attempt' };
    expect(isUseBankedResetInput(input)).toBe(true);
    for (const value of [null, { ...input, confirmed: false }, { ...input, redemptionToken: ' ' }, { ...input, idempotencyKey: '' }, { ...input, idempotencyKey: 'x'.repeat(129) }]) expect(isUseBankedResetInput(value)).toBe(false);
    for (const outcome of ['reset', 'alreadyRedeemed', 'nothingToReset', 'noCredit']) expect(isBankedResetResult({ outcome })).toBe(true);
    expect(isBankedResetResult({ outcome: 'success' })).toBe(false);
    expect(isBankedResetResult(null)).toBe(false);
  });
});
