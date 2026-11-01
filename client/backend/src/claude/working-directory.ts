import { homedir } from 'node:os';
import { agentFolder } from '@workspace/core/agent-folder';
import type { Agent } from '@workspace/core/contracts';

// Claude requires a cwd even for Quick Chats; this is not a project association.
export function claudeWorkingDirectory(agent: Pick<Agent, 'folder'>): string {
  return agentFolder(agent) ?? homedir();
}
