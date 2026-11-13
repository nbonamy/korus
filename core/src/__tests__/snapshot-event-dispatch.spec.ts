import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainToRendererEvent } from '../contracts';
import { applyMainEventToSnapshot, createInitialSnapshot } from '../snapshot';
import {
  snapshotEventOwnership,
  type SnapshotEventOwner,
} from '../snapshot-event-ownership';

const reducerSpies = vi.hoisted(() => ({
  coordination: vi.fn(),
  runtime: vi.fn(),
  subagent: vi.fn(),
}));

vi.mock('../snapshot-coordination-reducer', () => ({
  applyCoordinationEventToSnapshot: reducerSpies.coordination,
}));
vi.mock('../snapshot-runtime-reducer', () => ({
  applyRuntimeEventToSnapshot: reducerSpies.runtime,
}));
vi.mock('../snapshot-subagent-reducer', () => ({
  applySubagentEventToSnapshot: reducerSpies.subagent,
}));

describe('snapshot event dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes every owned event to exactly one reducer or the explicit renderer no-op', () => {
    const reducerByOwner = {
      coordination: reducerSpies.coordination,
      runtime: reducerSpies.runtime,
      subagent: reducerSpies.subagent,
    } satisfies Record<Exclude<SnapshotEventOwner, 'renderer'>, typeof reducerSpies.runtime>;

    for (const [type, owner] of Object.entries(snapshotEventOwnership)) {
      vi.clearAllMocks();
      const snapshot = createInitialSnapshot();
      const event = {
        seq: 1,
        agentId: 'agent-dina',
        provider: 'codex',
        threadId: 'thread-1',
        turnId: 'turn-1',
        type,
        payload: {},
        occurredAt: '2026-09-04T00:00:00.000Z',
      } as unknown as MainToRendererEvent;

      applyMainEventToSnapshot(snapshot, event);

      const invocationCount = Object.values(reducerByOwner)
        .reduce((count, reducer) => count + reducer.mock.calls.length, 0);
      if (owner === 'renderer') {
        expect(invocationCount, type).toBe(0);
      } else {
        expect(invocationCount, type).toBe(1);
        expect(reducerByOwner[owner], type).toHaveBeenCalledWith(snapshot, event);
      }
    }
  });
});
