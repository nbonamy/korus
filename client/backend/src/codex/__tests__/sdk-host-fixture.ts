import { vi, type Mock } from 'vitest';

type Fn = Mock<(...args: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any
import { createScriptedCodexHarness, scriptedCodexSnapshot, type ScriptedCodex } from '@korus-dev/multi-agent-sdk/testing';
import type { CodexConversationEvent, CodexConversationSnapshot, CodexConversationSummary, CodexEvent } from '@korus-dev/multi-agent-sdk/codex';
import type { Agent } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/provider-driver';
import { createCodexDriver } from '../../harness-drivers';

export const sdkSnapshot = (id = 'conversation-a', overrides: Partial<CodexConversationSnapshot> = {}): CodexConversationSnapshot => scriptedCodexSnapshot(id, overrides);

export function sdkAgent(id = 'agent-a', conversationId = 'conversation-a'): Agent {
  return {
    id, name: id, avatar: 'A', folder: '/repo', provider: 'codex',
    providerSession: { kind: 'codex', conversationId: conversationId },
    status: { type: 'idle' }, createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z',
  };
}

export function sdkSummary(id: string, overrides: Partial<CodexConversationSummary> = {}): CodexConversationSummary {
  return { id, title: id, preview: '', cwd: '/repo', status: 'idle', turnCount: 0, createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z', ...overrides };
}

const conversationOperations = ['sendMessage', 'steerMessage', 'interrupt', 'rename', 'updateSettings', 'setGoal', 'clearGoal', 'startReview', 'resolveApproval', 'respondToClientRequest', 'editTurn', 'deleteTurn', 'retryTurn', 'continueInterruptedTurn', 'continueAfterSafetyReview', 'loadTurnHistory', 'load'] as const;
const engineOperations = ['connect', 'close', 'forgetConversation', 'createConversation', 'archiveConversation', 'deleteConversation', 'unarchiveConversation', 'listConversations', 'listModels', 'listSkills', 'readConversationSummary', 'generateText', 'refreshAccount', 'startChatGptLogin', 'startChatGptDeviceCodeLogin', 'cancelLogin', 'logout', 'readRemoteControlStatus', 'readConfigRequirements', 'enableRemoteControl', 'disableRemoteControl', 'startRemoteControlPairing', 'readRemoteControlPairingStatus', 'listRemoteControlClients', 'revokeRemoteControlClient', 'respondToClientRequest'] as const;

/**
 * Korus's Codex driver over the SDK's real Codex adapter with a scripted engine.
 * `conversation(id)` plays engine events and records the engine calls the adapter makes; `surface` does the same for the engine itself.
 */
export function codexSdkFixture(closeRuntime?: () => Promise<void>) {
  let scripted!: ScriptedCodex;
  const driver = createCodexDriver({}, (_provider, options) => { scripted = createScriptedCodexHarness(options); return scripted.harness; });
  const snapshots = new Map<string, CodexConversationSnapshot>();
  const handles = new Map<string, ReturnType<typeof makeConversation>>();
  const makeConversation = (id: string) => {
    const engine = scripted.conversation(id);
    const handle = {} as Record<string, Fn>;
    for (const operation of conversationOperations) { handle[operation] = vi.fn(async () => snapshots.get(id) ?? sdkSnapshot(id)); engine.on(operation, handle[operation] as never); }
    for (const operation of ['fork', 'forkTurn', 'readContent', 'readHistory', 'loadOlderHistory'] as const) { handle[operation] = vi.fn(); engine.on(operation, handle[operation] as never); }
    handle.getSnapshot = vi.fn(() => snapshots.get(id) ?? sdkSnapshot(id)); engine.on('getSnapshot', handle.getSnapshot as never);
    return { handle, setSnapshot(next: Partial<CodexConversationSnapshot>) { const snapshot = sdkSnapshot(id, next); snapshots.set(id, snapshot); engine.setSnapshot(next); },
      emit: (event: CodexConversationEvent) => engine.emit(event), listenerCount: () => engine.listenerCount() };
  };
  const conversation = (id: string) => { if (!handles.has(id)) handles.set(id, makeConversation(id)); return handles.get(id)!; };
  const surface = {} as Record<string, Fn>;
  const engineDefaults: Record<string, () => unknown> = {
    archiveConversation: async () => sdkSnapshot(), deleteConversation: async () => sdkSnapshot(), unarchiveConversation: async () => sdkSnapshot(),
    listConversations: async () => [], listModels: async () => [], listSkills: async () => [], readConfigRequirements: async () => null,
    close: async () => { await closeRuntime?.(); },
  };
  surface.conversation = vi.fn((id: string) => scripted.conversation(id).handle) as Fn;
  const bind = () => { for (const operation of engineOperations) { surface[operation] = vi.fn(engineDefaults[operation] ?? (() => undefined)); scripted.engine.on(operation, surface[operation] as never); } };
  const events: BackendEvent[] = [];
  driver.onEvent(event => events.push(event));
  bind();
  return { driver, surface, conversation, events, emit: (event: CodexEvent) => scripted.engine.emit(event) };
}
