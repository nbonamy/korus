import { createScriptedHarness } from '@korus-dev/multi-agent-sdk/testing';
import type { AgentRequest, SessionState } from '@korus-dev/multi-agent-sdk';
import type { Agent, HarnessProvider, MainToRendererEvent } from '@workspace/core/contracts';
import { projectSessionConversation, type ConversationPresentation } from '../../src/provider-conversation-bindings';
import type { CodexConversationSnapshot } from '@korus-dev/multi-agent-sdk/codex';
import type { ClaudeConversationSnapshot } from '@korus-dev/multi-agent-sdk/claude';
import type { CursorConversationSnapshot } from '@korus-dev/multi-agent-sdk/cursor';
import type { AntigravityConversationSnapshot } from '@korus-dev/multi-agent-sdk/antigravity';

/** A provider's native conversation snapshot, as the fixtures in these tests describe it. */
export type NativeConversationFixture = { provider: HarnessProvider; snapshot: unknown };

/**
 * The session state a harness reports for a native snapshot, through the SDK's own projection.
 * Requests are added the way the harness adds them: as they are created, not from the transcript.
 */
export function sessionStateFrom(agentId: string, fixture: NativeConversationFixture, requests: AgentRequest[] = []): SessionState {
  const { harness, script } = createScriptedHarness(fixture.provider);
  const session = harness.open({ id: agentId, folder: '/work' });
  script.emit({ type: `${fixture.provider}.conversationSnapshotChanged`, agentId, provider: fixture.provider, payload: { revision: 1, snapshot: fixture.snapshot } } as never);
  for (const request of requests) script.emit({ type: 'agentRequest.created', agentId, provider: fixture.provider, payload: { request } } as never);
  // The browser receives session state as JSON, never as objects cloned elsewhere.
  return JSON.parse(JSON.stringify(harness.readSession(session))) as SessionState;
}

/** What an agent's conversation pane shows for a native snapshot fixture; null without one. */
export function conversationFrom(agent: Agent, fixture: NativeConversationFixture | null | undefined, requests?: AgentRequest[]): ConversationPresentation | null {
  return fixture?.snapshot ? projectSessionConversation(sessionStateFrom(agent.id, fixture, requests), agent) : null;
}

let revisions = 0;
/** The event that delivers a native snapshot fixture to the browser as session state. */
export function sessionSnapshotEvent(agentId: string, fixture: NativeConversationFixture, options: { seq?: number; conversation?: string | null; revision?: number; requests?: AgentRequest[] } = {}): MainToRendererEvent {
  return {
    type: 'conversation.sessionSnapshot', agentId, provider: fixture.provider, seq: options.seq ?? 0, occurredAt: '2026-11-11T00:00:00.000Z',
    payload: { conversation: options.conversation ?? null, epoch: 'fixture', snapshot: { revision: options.revision ?? ++revisions, state: sessionStateFrom(agentId, fixture, options.requests) } },
  } as MainToRendererEvent;
}

/** Native snapshot fixtures keyed the way the older tests name them. */
export type NativeFixtureSources = {
  codexSnapshot?: CodexConversationSnapshot | null; claudeSnapshot?: ClaudeConversationSnapshot | null;
  cursorSnapshot?: CursorConversationSnapshot | null; antigravitySnapshot?: AntigravityConversationSnapshot | null;
  /** Requests the harness reports as created, which no snapshot carries. */
  requests?: AgentRequest[];
};

/** The agent's conversation from whichever native fixture matches its provider. */
export function conversationFromSources(agent: Agent, sources: NativeFixtureSources): ConversationPresentation | null {
  const snapshot = sources[`${agent.provider}Snapshot` as keyof NativeFixtureSources];
  return conversationFrom(agent, snapshot ? { provider: agent.provider, snapshot } : null, sources.requests);
}

/** A conversation presentation straight from a native snapshot fixture, for tests that mount the shell directly. */
export function nativePresentation(fixture: NativeConversationFixture, agent?: Agent, requests?: AgentRequest[]): ConversationPresentation | null {
  const snapshot = fixture.snapshot as { agentId?: string } | null;
  return conversationFrom(agent ?? ({ id: snapshot?.agentId ?? 'agent', provider: fixture.provider } as Agent), fixture, requests);
}
