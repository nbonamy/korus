import type { SourceBranch, AgentGitPullRequest, GlobalWorkItemQuery, WorkItem, WorkItemPage, WorkItemQuery, WorkProviderAuthorization, WorkProviderKind, WorkSource } from '@workspace/core/contracts';
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

/** A backlog item that moved inside a window. Titles are provider content: they stay on this host and its clients. */
export type WorkProviderBacklogItem = { id: string; title: string; state: 'open' | 'closed'; createdAt: string; closedAt?: string; updatedAt: string };
export type WorkProviderBacklogActivity = { open: number | null; items: WorkProviderBacklogItem[] };
/** `approved` is null when the provider records no review decision for the request. */
export type WorkProviderOpenPullRequest = { number: number; url: string; branch: string; draft: boolean; approved: boolean | null; conflicts: boolean | null; openedAt: string };
/** Open requests, and how long recently merged ones stayed open, which is what \"open too long\" is measured against. */
export type WorkProviderPullRequestActivity = { open: WorkProviderOpenPullRequest[]; mergeTimesMs: number[] };
export type WorkProviderPipelineRun = { id: string; branch: string; status: import('@workspace/core/project-overview').ProjectOverviewPipelineStatus; at: string };

export interface WorkProviderDriver {
  provider: WorkProviderKind;
  configured(): boolean;
  checkHostedMcp?(token: WorkProviderToken): Promise<'available' | 'unavailable'>;
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
  /** Read-only: items created, closed or updated since `since` (ISO), bounded by the driver. */
  listBacklogActivity?(token: WorkProviderCredential, repositoryId: string, since: string): Promise<WorkProviderBacklogActivity>;
  /** Read-only: open pull or merge requests and recent merge times, bounded by the driver. */
  listPullRequestActivity?(token: WorkProviderCredential, repositoryId: string): Promise<WorkProviderPullRequestActivity>;
  /** Read-only: pipeline runs created since `since` (ISO), bounded by the driver. */
  listPipelineRuns?(token: WorkProviderCredential, repositoryId: string, since: string): Promise<WorkProviderPipelineRun[]>;
}
