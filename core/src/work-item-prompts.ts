import type { WorkBacklogAssignmentPolicy, WorkItem } from './contracts';
import { product } from './product';
import { workItemAssignmentKey } from './work-assignments';
import { workProviderDefinition } from './work-providers';

export type WorkItemAssignmentAction = 'addressFeedback' | 'fix' | 'investigate' | 'review';

type WorkItemPromptOptions = {
  assignment?: string;
  action?: WorkItemAssignmentAction;
  completionPolicy?: WorkBacklogAssignmentPolicy;
};

export function workItemAssignmentPrompt(item: WorkItem, options: WorkItemPromptOptions = {}): string {
  const body = truncateWorkItemBody(item.body?.trim() ?? '');
  const assignmentInstructions = options.assignment?.trim();
  const workItemId = workItemAssignmentKey(item);
  const completionPolicy = options.completionPolicy ?? 'review';
  const context = [
    workItemActionInstruction(item, options.action),
    '',
    `Work item ID: ${workItemId}`,
    completionPolicy === 'complete'
      ? `When the work is fully complete, call the ${product.mcpServerName} MCP tool \`update-work-item\` with this exact Work item ID and status \`completed\`.`
      : `When the outcome is ready for the user to review, call the ${product.mcpServerName} MCP tool \`update-work-item\` with this exact Work item ID and status \`readyForReview\`.`,
    'If you need help or cannot proceed, call `update-work-item` with status `blocked` and a concise note explaining what you need. Use status `inProgress` when work resumes.',
    '',
    `Backlog source: ${item.sourceName}`,
    `${item.kind === 'pullRequest' ? (item.provider === 'gitlab' ? 'Merge request' : 'Pull request') : 'Issue'}: ${workItemDisplayIdentifier(item)} ${item.title}`,
    `URL: ${item.url}`,
    item.labels.length > 0 ? `Labels: ${item.labels.map((label) => label.name).join(', ')}` : null,
    item.authorName ? `Author: ${item.authorName}` : null,
    assignmentInstructions ? ['Assignment instructions:', assignmentInstructions].join('\n') : null,
    body ? ['Body:', body].join('\n') : null,
  ].filter((line): line is string => line !== null).join('\n');
  // The conversation view hides <context>; the user only sees the short request below it.
  return `<context>\n${context.replace(/<\/context>/giu, '&lt;/context&gt;')}\n</context>\n\n${workItemVisibleRequest(item, options.action)}`;
}

function workItemVisibleRequest(item: WorkItem, action?: WorkItemAssignmentAction): string {
  const kind = item.kind === 'pullRequest' ? (item.provider === 'gitlab' ? 'merge request' : 'pull request') : 'issue';
  const subject = `${workProviderLabel(item.provider)} ${kind} ${workItemDisplayIdentifier(item)} — ${item.title}`;
  if (action === 'investigate') return `Investigate ${subject}`;
  if (action === 'fix') return `Fix ${subject}`;
  if (action === 'review') return `Review ${subject}`;
  if (action === 'addressFeedback') return `Address review feedback on ${subject}`;
  return `Work on ${subject}`;
}

export function workItemComposerPrompt(item: WorkItem): string {
  const kind = item.kind === 'pullRequest' ? (item.provider === 'gitlab' ? 'merge request' : 'pull request') : 'issue';
  return `Regarding ${workProviderLabel(item.provider)} ${kind} ${workItemDisplayIdentifier(item)} — ${item.title}:\n\n`
    + `Work item ID: ${workItemAssignmentKey(item)}\nBacklog source: ${item.sourceName}\nURL: ${item.url}\n\n${truncateWorkItemBody(item.body?.trim() ?? '')}\n\n`;
}

export function workItemDisplayIdentifier(item: Pick<WorkItem, 'id' | 'identifier' | 'number'>): string {
  return item.identifier ?? (item.number !== undefined ? `#${item.number}` : item.id);
}

export function workItemBranchName(item: WorkItem, purpose?: 'automation'): string {
  if (!purpose && item.kind === 'pullRequest' && item.branchName?.trim()) return item.branchName.trim();
  const definition = workProviderDefinition(item.provider);
  const prefix = purpose ? definition.automationBranchPrefix : definition.branchPrefix;
  const reference = prefix ? `${prefix}-${item.number ?? item.identifier ?? item.id}` : item.identifier ?? item.id;
  return `${purpose ?? (item.kind === 'pullRequest' ? 'review' : 'fix')}/${reference.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
}

export function workProviderLabel(provider: WorkItem['provider']): string {
  return workProviderDefinition(provider)?.label ?? 'work provider';
}

function workItemActionInstruction(item: WorkItem, action?: WorkItemAssignmentAction): string {
  const provider = workProviderLabel(item.provider);
  const request = item.provider === 'gitlab' ? 'merge request' : 'pull request';
  if (action === 'investigate') {
    return `Investigate this ${provider} issue and report the root cause, impact, and recommended fix. Do not modify files or implement the fix.`;
  }
  if (action === 'fix') {
    return `Fix this ${provider} issue. Reproduce the problem, implement the fix, verify it, and summarize the outcome.`;
  }
  if (action === 'addressFeedback') {
    return `Address actionable review feedback on this ${provider} ${request}. Inspect the current review comments, update the branch, verify the changes, and summarize what you addressed.`;
  }
  if (action === 'review') {
    return `Review this ${provider} ${request} for correctness, regressions, missing tests, and maintainability. Report concrete findings and do not modify files.`;
  }
  return item.kind === 'pullRequest'
    ? `Please review this ${provider} ${request} and drive the requested work to completion.`
    : `Please take this ${provider} issue and drive it to completion.`;
}

function truncateWorkItemBody(value: string): string {
  const maxLength = 4_000;
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}\n\n[Body truncated]`;
}
