import type { Agent, BackendConversationRef } from './contracts';

export function conversationRefFromAgent(agent: Agent): BackendConversationRef | null {
  if (agent.backendSession?.kind === 'codex') {
    return { backend: 'codex', threadId: agent.backendSession.threadId };
  }
  if (agent.backendSession?.kind === 'claude') {
    return {
      backend: 'claude',
      folder: agent.backendSession.transcriptFolder ?? agent.folder,
      sessionId: agent.backendSession.transcriptSessionId ?? agent.backendSession.sessionId,
    };
  }
  if (agent.backendSession?.kind === 'antigravity') {
    return { backend: 'antigravity', folder: agent.folder, sessionId: agent.backendSession.sessionId };
  }
  return null;
}
