import { describe, expect, it } from 'vitest';
import { findingPrioritySchema } from '../finding-tool-schemas';

describe('findingPrioritySchema', () => {
  it.each([['p0', 'p0'], ['P2', 'p2'], ['p3', 'p3'], ['P1', 'p1']])('accepts %s as %s', (input, expected) => {
    expect(findingPrioritySchema.parse(input)).toBe(expected);
  });

  it('rejects anything outside P0 to P3', () => {
    expect(findingPrioritySchema.safeParse('p4').success).toBe(false);
    expect(findingPrioritySchema.safeParse('high').success).toBe(false);
  });
});
