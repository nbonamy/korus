import type { Agent, AgentStatus } from '@workspace/core/contracts';
import { localizedText } from '../i18n/errors';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function agentStatusLabel(status: AgentStatus['type'], translate: Translate): string {
  return translate(`status.${status}`);
}

export function agentStatusText(agent: Agent, translate: Translate): string {
  if (agent.statusText) {
    return agent.statusText;
  }

  switch (agent.status.type) {
    case 'working':
      return localizedText(agent.status.detail, translate) ?? agentStatusLabel(agent.status.type, translate);
    case 'awaitingInput':
      return localizedText(agent.status.detail, translate) ?? agentStatusLabel(agent.status.type, translate);
    case 'error':
      return localizedText(agent.status.message, translate) ?? agentStatusLabel(agent.status.type, translate);
    case 'idle':
      return agentStatusLabel(agent.status.type, translate);
  }
}

export function folderBasename(folder: string): string {
  return folder.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

export function agentCanReceivePrompt(agent: Agent): boolean {
  return agent.status.type !== 'working';
}
