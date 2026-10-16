import { describe, expect, it } from 'vitest';
import { formatCompactAge, formatElapsed } from '../compact-age';

describe('formatCompactAge', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  it.each([
    ['2026-10-16T11:59:30Z', 'now'],
    ['2026-10-16T12:00:05Z', 'now'],
    ['2026-10-16T11:55:00Z', '5m'],
    ['2026-10-16T09:00:00Z', '3h'],
    ['2026-10-13T12:00:00Z', '3d'],
    ['not a date', ''],
    [undefined, ''],
  ])('formats %s as %s', (timestamp, expected) => {
    expect(formatCompactAge(timestamp, now, 'now')).toBe(expected);
  });
});

describe('formatElapsed', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  it.each([
    ['2026-10-16T12:00:00Z', '0s'],
    ['2026-10-16T11:59:15Z', '45s'],
    ['2026-10-16T11:56:48Z', '3m 12s'],
    ['2026-10-16T11:55:00Z', '5m 0s'],
    ['2026-10-16T10:55:00Z', '1h 5m'],
    ['2026-10-14T09:00:00Z', '2d 3h'],
    ['2026-10-16T12:00:30Z', '0s'],
    ['not a date', ''],
    [undefined, ''],
  ])('formats %s as %s', (timestamp, expected) => {
    expect(formatElapsed(timestamp, now)).toBe(expected);
  });
});
