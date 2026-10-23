import type { Component } from 'vue';
import type { WorkProviderKind } from '@workspace/core/contracts';
import { BacklogIcon, GitHubIcon, LinearIcon } from '../shared/icons/app-icons';

const icons: Partial<Record<WorkProviderKind, Component>> = { github: GitHubIcon, linear: LinearIcon };

export function workProviderIcon(provider: WorkProviderKind): Component {
  return icons[provider] ?? BacklogIcon;
}
