import type { WorkProviderSettings } from '@workspace/core/contracts';

const PACKAGED_LINEAR_CLIENT_ID = typeof __APP_LINEAR_CLIENT_ID__ === 'string' ? __APP_LINEAR_CLIENT_ID__ : '';

export function runtimeLinearOAuthSettings(settings?: WorkProviderSettings): WorkProviderSettings {
  return {
    oauthClientId: settings?.oauthClientId?.trim() || process.env.APP_LINEAR_CLIENT_ID?.trim() || PACKAGED_LINEAR_CLIENT_ID.trim(),
  };
}

const PACKAGED_GITHUB_CLIENT_ID =
  typeof __APP_GITHUB_CLIENT_ID__ === 'string'
    ? __APP_GITHUB_CLIENT_ID__
    : '';

export type RuntimeGitHubOAuthSettings = {
  oauthClientId?: string | null;
};

type RuntimeGitHubOAuthSources = {
  environmentClientId?: string | null;
  packagedClientId?: string | null;
};

export function runtimeGitHubOAuthClientId(
  settings?: RuntimeGitHubOAuthSettings,
  sources?: RuntimeGitHubOAuthSources,
): string {
  return (
    settings?.oauthClientId
    ?? (sources ? sources.environmentClientId : process.env.APP_GITHUB_CLIENT_ID)
    ?? (sources ? sources.packagedClientId : PACKAGED_GITHUB_CLIENT_ID)
    ?? ''
  ).trim();
}

const PACKAGED_GITLAB_CLIENT_ID = typeof __APP_GITLAB_CLIENT_ID__ === 'string' ? __APP_GITLAB_CLIENT_ID__ : '';

export function runtimeGitLabOAuthClientId(settings?: WorkProviderSettings): string {
  return settings?.oauthClientId?.trim() || process.env.APP_GITLAB_CLIENT_ID?.trim() || PACKAGED_GITLAB_CLIENT_ID.trim();
}
