import type { SourceBranch, AgentGitPullRequest, GlobalWorkItemQuery, WorkItem, WorkItemPage, WorkItemQuery, WorkProviderAuthorization, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';

/** CLI access carries identity only. It can never supply a bearer token. */
export type GitHubCliCredential = { kind: 'cli'; provider: 'github'; accountLabel: string; connectedAt: string };
export type WorkProviderCredential = WorkProviderToken | GitHubCliCredential;

export function requireWorkProviderToken(credential: WorkProviderCredential): WorkProviderToken {
  if ('kind' in credential) throw new Error('This operation requires an API connection.');
  return credential;
}

export type WorkProviderDeviceAuthorization = WorkProviderAuthorization & {
  deviceCode: string;
  intervalSeconds: number;
};

type WorkProviderDeviceTokenPending = {
  status: 'pending';
  intervalSeconds?: number;
};

type WorkProviderDeviceTokenSuccess = {
  status: 'success';
  token: Omit<WorkProviderToken, 'accountLabel' | 'connectedAt' | 'provider'>;
};

type WorkProviderDeviceTokenError = {
  status: 'error';
  code: 'access_denied' | 'expired' | 'not_configured' | 'unavailable';
  message: string;
};

export type WorkProviderDeviceTokenResult =
  | WorkProviderDeviceTokenError
  | WorkProviderDeviceTokenPending
  | WorkProviderDeviceTokenSuccess;

export interface WorkProviderDriver {
  provider: WorkProviderKind;
  configured(): boolean;
  cancelAuthorization?(): void;
  startAuthorization(): Promise<WorkProviderDeviceAuthorization>;
  pollAuthorization(deviceCode: string): Promise<WorkProviderDeviceTokenResult>;
  refreshToken?(token: WorkProviderToken): Promise<WorkProviderToken>;
  currentAccountLabel(token: WorkProviderCredential): Promise<string>;
  listBranches?(token: WorkProviderCredential, repositoryId: string): Promise<SourceBranch[]>;
  listSources(token: WorkProviderCredential): Promise<WorkSource[]>;
  listGlobalItems(token: WorkProviderCredential, query?: GlobalWorkItemQuery): Promise<WorkItemPage>;
  listItems(token: WorkProviderCredential, repositoryId: string, query?: WorkItemQuery): Promise<WorkItem[]>;
  listAssignedItems?(token: WorkProviderCredential): Promise<WorkItem[]>;
  findPullRequest?(token: WorkProviderCredential, repositoryId: string, branch: string): Promise<AgentGitPullRequest | null>;
  getPullRequest?(token: WorkProviderCredential, repositoryId: string, number: number): Promise<AgentGitPullRequest | null>;
  createPullRequest?(token: WorkProviderCredential, repositoryId: string, input: { branch: string; title: string; body: string }): Promise<AgentGitPullRequest>;
}
