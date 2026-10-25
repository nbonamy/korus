import { IconFolder as FolderIcon, IconFolderPlus as FolderPlusIcon, IconLink as LinkIcon } from '@tabler/icons-vue';
import { GitHubIcon, GitLabIcon } from '../shared/icons/app-icons';
import type { AppMenuItem } from '../shared/menu/app-menu';

export type StartWorkAction = 'new' | 'github' | 'gitlab' | 'local' | 'url';

export function startWorkMenuItems(t: (key: string) => string): AppMenuItem[] {
  return [
    { id: 'new', type: 'action', label: t('startWork.newProject'), icon: FolderPlusIcon },
    { id: 'local', type: 'action', label: t('startWork.localFolder'), icon: FolderIcon },
    { id: 'github', type: 'action', label: t('startWork.githubRepository'), icon: GitHubIcon },
    { id: 'gitlab', type: 'action', label: t('startWork.gitlabRepository'), icon: GitLabIcon },
    { id: 'url', type: 'action', label: t('startWork.repositoryUrl'), icon: LinkIcon },
  ];
}

export function isStartWorkAction(action: string): action is StartWorkAction {
  return action === 'new' || action === 'local' || action === 'github' || action === 'gitlab' || action === 'url';
}
