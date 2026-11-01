import { afterEach } from 'vitest';
import type { AppSnapshot, MainToRendererEvent, RendererSnapshotState } from '@workspace/core/contracts';
import { setElectronTestClient } from './client';
import { createClientApiMock } from './client-api-mock';

type InputEvent<T = MainToRendererEvent> = T extends MainToRendererEvent ? Omit<T, 'seq' | 'occurredAt'> : never;

const disposers = new Set<() => void>();
afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers.clear();
});

/** Scripted app-owned backend contract. No reducer, provider fake, or UI behavior lives here. */
export function installBackendFixture(snapshot: AppSnapshot, state: Pick<RendererSnapshotState, 'lastBackendEventSeq' | 'connection'> = { lastBackendEventSeq: 50, connection: { status: 'connected' } }) {
  let sequence = state.lastBackendEventSeq;
  const mock = createClientApiMock(snapshot, state);
  const { api } = mock;
  disposers.add(mock.dispose);
  setElectronTestClient(api);
  return {
    api,
    dispose: mock.dispose,
    emitAppCommand: mock.emitAppCommand,
    emitUpdateStatus: mock.emitUpdateStatus,
    emitSequenced: mock.emit,
    emit(event: InputEvent) {
      const message = { ...event, seq: ++sequence, occurredAt: '2026-09-16T00:00:00Z' } as MainToRendererEvent;
      mock.emit(message);
    },
  };
}
