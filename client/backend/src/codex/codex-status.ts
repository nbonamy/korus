import { statusFromSnapshot as nativeStatus } from '@korus-dev/multi-agent-sdk/providers/codex';
export function statusFromSnapshot(snapshot: Parameters<typeof nativeStatus>[0]) { return nativeStatus(snapshot, { awaitingApproval: { key: 'backend.awaitingApproval' }, awaitingUserInput: { key: 'backend.awaitingUserInput' } }); }
