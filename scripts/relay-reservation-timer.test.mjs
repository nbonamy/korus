import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retimeableSignal } from 'retimeable-signal';

test('installed relay reservation timers discard obsolete deadlines after renewals and clear', () => {
  const original = AbortSignal.timeout;
  const deadlines = [];
  // Control only native deadline delivery; exercise the installed dependency used by the relay.
  AbortSignal.timeout = () => { const timer = new AbortController(); deadlines.push(timer); return timer.signal; };
  try {
    const lease = retimeableSignal(120_000);
    lease.reset(120_000); lease.reset(120_000);
    deadlines[0].abort(); deadlines[1].abort();
    assert.equal(lease.aborted, false, 'an obsolete renewal deadline must not expire the current reservation');
    deadlines[2].abort();
    assert.equal(lease.aborted, true, 'the current deadline must still expire an abandoned reservation');
    const cleared = retimeableSignal(120_000);
    cleared.reset(120_000); cleared.reset(120_000); cleared.clear();
    for (const timer of deadlines.slice(3)) timer.abort();
    assert.equal(cleared.aborted, false, 'clearing a renewed reservation must remove every active deadline');
  } finally { AbortSignal.timeout = original; }
});
