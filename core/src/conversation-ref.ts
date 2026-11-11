import type { Agent, ProviderConversationRef } from './contracts';

export function conversationRefFromAgent(agent: Agent): ProviderConversationRef | null {
  if (agent.providerSession?.kind === 'codex') {
    return { provider: 'codex', threadId: agent.providerSession.threadId };
  }
  if (agent.providerSession?.kind === 'claude') {
    return {
      provider: 'claude',
      folder: agent.providerSession.transcriptFolder ?? agent.folder,
      sessionId: agent.providerSession.transcriptSessionId ?? agent.providerSession.sessionId,
    };
  }
  if (agent.providerSession?.kind === 'antigravity' || agent.providerSession?.kind === 'cursor') {
    return { provider: agent.providerSession.kind, folder: agent.folder, sessionId: agent.providerSession.sessionId };
  }
  return null;
}
