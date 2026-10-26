import type { SourceBranch, AgentGitPullRequest, GlobalWorkItemQuery, WorkItem, WorkItemKind, WorkItemPage, WorkItemQuery, WorkProviderAuthorization, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
import type { WorkProviderToken } from '@workspace/core/work-integration-tokens';

/** CLI access carries identity only. It can never supply a bearer token. */
export type WorkProviderCliCredential = { kind: 'cli'; provider: 'github' | 'gitlab'; accountLabel: string; connectedAt: string };
export type GitHubCliCredential = WorkProviderCliCredential & { provider: 'github' };
export class WorkProviderCliAuthenticationError extends Error {}
export interface WorkProviderCliDriver extends WorkProviderDriver {
  detectConnection(): Promise<WorkProviderCliCredential | null>;
}
export type WorkProviderCredential = WorkProviderToken | WorkProviderCliCredential;

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

/** One issue or merge request with its human comments, for agents that need the whole conversation. */
export type WorkItemDetail = {
  item: WorkItem;
  notes: { author: string; createdAt: string; body: string }[];
  request?: { sourceBranch: string; targetBranch: string; draft: boolean; mergeStatus?: string; pipeline?: { status: string; url?: string } };
};

export interface WorkProviderDriver {
  provider: WorkProviderKind;
  configured(): boolean;
  checkHostedMcp?(token: WorkProviderToken): Promise<'available' | 'restricted' | 'unavailable'>;
  cancelAuthorization?(): void;
  startAuthorization(options?: { hostedMcp?: boolean }): Promise<WorkProviderDeviceAuthorization>;
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
  getItemDetail?(token: WorkProviderCredential, repositoryId: string, kind: WorkItemKind, iid: number): Promise<WorkItemDetail>;
  addItemNote?(token: WorkProviderCredential, repositoryId: string, kind: WorkItemKind, iid: number, body: string): Promise<{ id: string; url: string }>;
}
