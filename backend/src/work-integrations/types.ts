import type { SourceBranch, AgentGitPullRequest, GlobalWorkItemQuery, WorkItem, WorkItemPage, WorkItemQuery, WorkProviderAuthorization, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';

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
  currentAccountLabel(token: WorkProviderToken): Promise<string>;
  listBranches?(token: WorkProviderToken, repositoryId: string): Promise<SourceBranch[]>;
  listSources(token: WorkProviderToken): Promise<WorkSource[]>;
  listGlobalItems(token: WorkProviderToken, query?: GlobalWorkItemQuery): Promise<WorkItemPage>;
  listItems(token: WorkProviderToken, repositoryId: string, query?: WorkItemQuery): Promise<WorkItem[]>;
  listAssignedItems?(token: WorkProviderToken): Promise<WorkItem[]>;
  findPullRequest?(token: WorkProviderToken, repositoryId: string, branch: string): Promise<AgentGitPullRequest | null>;
  getPullRequest?(token: WorkProviderToken, repositoryId: string, number: number): Promise<AgentGitPullRequest | null>;
  createPullRequest?(token: WorkProviderToken, repositoryId: string, input: { branch: string; title: string; body: string }): Promise<AgentGitPullRequest>;
}
