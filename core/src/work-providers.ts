import type { AppText } from './contracts/shared';

type WorkProviderDefinition = {
  label: string;
  sourceLabel: Exclude<AppText, string>;
  description: Exclude<AppText, string>;
  configurationDetail: AppText;
  repositoryBacked: boolean;
  pullRequests: boolean;
  initialView: 'source' | 'assignedToMe';
  branchPrefix: string;
  automationBranchPrefix: string;
  hostedMcp?: { url: string; plugin?: string };
};

/** Product capabilities and presentation, shared by every work-source consumer. */
export const workProviders = {
  github: {
    label: 'GitHub', sourceLabel: { key: 'backlogSource.repository' },
    description: { key: 'surface.settingsIntegrationsPanel.issuesAndPullRequests' },
    configurationDetail: { key: 'workProvider.oauthNotConfigured', params: { provider: 'GitHub' } },
    repositoryBacked: true, pullRequests: true, initialView: 'assignedToMe',
    branchPrefix: 'gh', automationBranchPrefix: 'github',
    hostedMcp: { url: 'https://api.githubcopilot.com/mcp/', plugin: 'github@openai-curated-remote' },
  },
  gitlab: {
    label: 'GitLab', sourceLabel: { key: 'backlogSource.repository' },
    description: { key: 'gitlabIntegration.description' },
    configurationDetail: { key: 'gitlabIntegration.setup' },
    repositoryBacked: true, pullRequests: true, initialView: 'assignedToMe',
    branchPrefix: 'gl', automationBranchPrefix: 'gitlab',
  },
  linear: {
    label: 'Linear', sourceLabel: { key: 'backlogSource.teamProject' },
    description: { key: 'linearIntegration.setup' },
    configurationDetail: 'The Linear OAuth client ID is not configured for this build.',
    repositoryBacked: false, pullRequests: false, initialView: 'source',
    branchPrefix: '', automationBranchPrefix: '',
    hostedMcp: { url: 'https://mcp.linear.app/mcp', plugin: 'linear@openai-curated-remote' },
  },
} satisfies Record<string, WorkProviderDefinition>;

export type WorkProviderKind = keyof typeof workProviders;
export const workProviderKinds = Object.keys(workProviders) as WorkProviderKind[];

export function isWorkProviderKind(value: unknown): value is WorkProviderKind {
  return typeof value === 'string' && Object.hasOwn(workProviders, value);
}

export function workProviderDefinition(provider: WorkProviderKind): WorkProviderDefinition {
  return workProviders[provider];
}
