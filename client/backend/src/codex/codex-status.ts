import { statusFromSnapshot as nativeStatus } from 'multi-agents-sdk/providers/codex/status';
export function statusFromSnapshot(snapshot: Parameters<typeof nativeStatus>[0]) { return nativeStatus(snapshot, { awaitingApproval: { key: 'backend.awaitingApproval' }, awaitingUserInput: { key: 'backend.awaitingUserInput' } }); }
