import { ElMessageBox } from 'element-plus';
import type { AppSnapshot } from '@workspace/core/contracts';
import { appApi, appHostCapabilities } from '../platform-api';
import { translate as t } from '../i18n';
import type { AgentRightWorkspaceState } from './use-right-workspace-state';

export function useDocumentSaveAs(options: {
  snapshot: () => AppSnapshot;
  workspaceFor: (agentId: string) => AgentRightWorkspaceState;
  save: (agentId: string, tabId: string, path: string, overwrite: boolean) => Promise<void>;
}) {
  async function saveDocumentAs(agentId: string, tabId: string): Promise<void> {
    const agent = options.snapshot().agents.find(agent => agent.id === agentId);
    const panel = options.workspaceFor(agentId).filePanels[tabId as `file:${string}`];
    if (!agent || !panel?.documentId) return;
    const filename = `${panel.title.replace(/[<>:"/\\|?*\x00-\x1f]/gu, '-').replace(/\.(md|markdown)$/iu, '').trim().slice(0, 120) || 'document'}.md`;
    const defaultPath = agent.folder ? `${agent.folder.replace(/[\\/]$/u, '')}/${filename}` : filename;
    const remote = agent.remoteConnectionId;
    let destination: string | null;
    let overwrite = false;
    if (appHostCapabilities.nativeFileDialogs && !remote) {
      destination = await appApi?.chooseDocumentSavePath(defaultPath) ?? null;
      overwrite = true; // The native save dialog owns overwrite confirmation.
    } else {
      try {
        const answer = await ElMessageBox.prompt(t('documents.destination'), t('documents.saveAs'), {
          inputValue: defaultPath, confirmButtonText: t('documents.save'), cancelButtonText: t('common.cancel'),
        });
        destination = answer.value;
      } catch { return; }
    }
    if (!destination) return;
    try {
      await options.save(agentId, tabId, destination, overwrite);
    } catch (error) {
      if (!overwrite && String(error).includes('File already exists')) {
        try {
          await ElMessageBox.confirm(t('documents.replaceFile'), t('documents.saveAs'), { confirmButtonText: t('documents.replace'), cancelButtonText: t('common.cancel') });
        } catch { return; }
        await options.save(agentId, tabId, destination, true);
      } else throw error;
    }
  }
  return saveDocumentAs;
}
