import * as z from 'zod/v4';
import type { AgentGitPullRequest, WorkItem, WorkItemKind, WorkItemQuery } from '@workspace/core/contracts';
import type { WorkItemDetail } from '../work-integrations/types';
import { McpToolError } from './agent-coordinator';
import { loggedToolResult, type AppMcpToolModuleProvider } from './tool-modules';

/** What the tools need from the GitLab connection; the work integration manager implements it. */
export type GitLabToolPort = {
  connected(): boolean;
  listItems(repositoryId: string, query: WorkItemQuery): Promise<WorkItem[]>;
  getItemDetail(repositoryId: string, kind: WorkItemKind, iid: number): Promise<WorkItemDetail>;
  addItemNote(repositoryId: string, kind: WorkItemKind, iid: number, body: string): Promise<{ id: string; url: string }>;
  createMergeRequest(repositoryId: string, input: { branch: string; title: string; body: string }): Promise<AgentGitPullRequest>;
};

const maxText = 20_000;
const projectSchema = z.string().trim().min(1).max(500).describe('GitLab project as group/subgroup/project, its gitlab.com URL, or its git remote.');
const stateSchema = z.enum(['open', 'closed', 'all']).default('open');
const limitSchema = z.number().int().min(1).max(50).default(20);
const iidSchema = z.number().int().positive().describe('The number shown in the project, without # or !.');

/** Accepts the spellings an agent finds in a remote or a browser tab and returns the canonical repository identity. */
function gitlabRepositoryId(value: string): string {
  let path = value.trim();
  path = path.replace(/^git@gitlab\.com:/u, '').replace(/^ssh:\/\/git@gitlab\.com\//u, '').replace(/^https?:\/\/gitlab\.com\//u, '').replace(/^gitlab\.com\//u, '');
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|[^/\s]+@[^/\s]+:)/iu.test(path)) throw new McpToolError('Only gitlab.com projects are supported.');
  path = path.replace(/[?#].*$/u, '').replace(/\/-\/.*$/u, '').replace(/\/+$/u, '').replace(/\.git$/iu, '');
  const segments = path.split('/');
  if (segments.length < 2 || segments.some(segment => !/^[A-Za-z0-9_.-]+$/u.test(segment))) throw new McpToolError('Use a gitlab.com project such as group/project.');
  return `gitlab.com/${segments.join('/')}`;
}

function clip(text: string | undefined): { text: string; truncated: boolean } {
  const value = text ?? '';
  return value.length > maxText ? { text: `${value.slice(0, maxText)}…`, truncated: true } : { text: value, truncated: false };
}

function summary(item: WorkItem) {
  return {
    number: item.number ?? 0, title: item.title, state: item.state, url: item.url,
    ...(item.authorName ? { author: item.authorName } : {}), assignees: item.assignees ?? [],
    labels: item.labels.map(label => label.name), updatedAt: item.updatedAt,
  };
}

export function createGitLabToolModuleProvider(port: GitLabToolPort): AppMcpToolModuleProvider {
  return {
    id: 'gitlab',
    resolve: ({ agentId }) => port.connected() ? {
      id: 'gitlab',
      register: server => {
        for (const [name, kind, noun] of [['gitlab-list-issues', 'issue', 'issues'], ['gitlab-list-merge-requests', 'pullRequest', 'merge requests']] as const) {
          server.registerTool(name, {
            description: `List ${noun} of a gitlab.com project, newest first. Returns number, title, state, url, author, assignees, labels and updatedAt; use the get tool for the description and comments. Example: {"project":"group/project","state":"open","limit":20}.`,
            inputSchema: z.strictObject({ project: projectSchema, state: stateSchema, limit: limitSchema }),
            annotations: { readOnlyHint: true, openWorldHint: true },
          }, ({ project, state, limit }) => loggedToolResult(name, { agentId, project }, async () => {
            const items = (await port.listItems(gitlabRepositoryId(project), { kind, state }))
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            return { items: items.slice(0, limit).map(summary), total: items.length, truncated: items.length > limit };
          }));
        }

        for (const [name, kind, noun] of [['gitlab-get-issue', 'issue', 'issue'], ['gitlab-get-merge-request', 'pullRequest', 'merge request']] as const) {
          server.registerTool(name, {
            description: `Read one ${noun} from a gitlab.com project with its description and human comments in order${kind === 'pullRequest' ? ', plus its branches, draft state, merge status and latest pipeline' : ''}. Long text is cut at ${maxText} characters. Example: {"project":"group/project","iid":7}.`,
            inputSchema: z.strictObject({ project: projectSchema, iid: iidSchema }),
            annotations: { readOnlyHint: true, openWorldHint: true },
          }, ({ project, iid }) => loggedToolResult(name, { agentId, project, iid }, async () => {
            const detail = await port.getItemDetail(gitlabRepositoryId(project), kind, iid);
            const description = clip(detail.item.body);
            return {
              ...summary(detail.item), description: description.text, descriptionTruncated: description.truncated,
              comments: detail.notes.slice(-50).map(note => ({ author: note.author, createdAt: note.createdAt, body: clip(note.body).text })),
              ...(detail.request ? { request: detail.request } : {}),
            };
          }));
        }

        server.registerTool('gitlab-comment', {
          description: 'Add a comment to an issue or merge request of a gitlab.com project as the connected GitLab user. It is visible to everyone with access, so write it as a final message. Example: {"project":"group/project","kind":"issue","iid":7,"body":"Fixed in !12."}.',
          inputSchema: z.strictObject({ project: projectSchema, kind: z.enum(['issue', 'merge_request']), iid: iidSchema, body: z.string().trim().min(1).max(maxText) }),
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        }, ({ project, kind, iid, body }) => loggedToolResult('gitlab-comment', { agentId, project, kind, iid }, async () => {
          const note = await port.addItemNote(gitlabRepositoryId(project), kind === 'issue' ? 'issue' : 'pullRequest', iid, body);
          return { success: true, id: note.id, url: note.url };
        }));

        server.registerTool('gitlab-create-merge-request', {
          description: 'Create a draft merge request in a gitlab.com project from an already pushed source branch into the default branch. The title is prefixed with "Draft:". Push the branch first. Example: {"project":"group/project","sourceBranch":"feature/login","title":"Fix login","description":"What changed and why."}.',
          inputSchema: z.strictObject({ project: projectSchema, sourceBranch: z.string().trim().min(1).max(250), title: z.string().trim().min(1).max(250), description: z.string().max(maxText).default('') }),
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        }, ({ project, sourceBranch, title, description }) => loggedToolResult('gitlab-create-merge-request', { agentId, project, sourceBranch }, async () => {
          const request = await port.createMergeRequest(gitlabRepositoryId(project), { branch: sourceBranch, title, body: description });
          return { success: true, number: request.number, title: request.title, url: request.url, draft: request.draft };
        }));
      },
    } : undefined,
  };
}
