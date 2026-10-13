import { describe, expect, it } from 'vitest';
import { MAX_DELEGATION_INSTRUCTIONS_LENGTH, isDelegationOverrides, isDelegationUserInstructions } from '../delegation-context';

describe('delegation user text bounds', () => {
  it('rejects instructions the durable task store could not persist', () => {
    const tooLong = 'x'.repeat(MAX_DELEGATION_INSTRUCTIONS_LENGTH + 1);
    expect(isDelegationOverrides({ startingContext: 'handoff', instructions: 'x'.repeat(MAX_DELEGATION_INSTRUCTIONS_LENGTH) })).toBe(true);
    expect(isDelegationOverrides({ startingContext: 'handoff', instructions: tooLong })).toBe(false);
    expect(isDelegationUserInstructions({ saved: 'ok', taskSpecific: tooLong })).toBe(false);
    expect(isDelegationUserInstructions({ saved: tooLong })).toBe(false);
  });
});
