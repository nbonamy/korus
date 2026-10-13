import { product } from './product';
import type { AgentBackend, BackendCommandSummary } from './contracts';

export const codexBackendCommands: BackendCommandSummary[] = [
  {
    id: 'codex.compact',
    backend: 'codex',
    name: 'compact',
    displayName: 'Compact',
    description: 'Compact the current Codex context.',
    slashName: 'compact',
    submitOnSelect: true,
  },
  {
    id: 'app.review',
    backend: 'codex',
    name: 'review',
    displayName: 'Review',
    description: `Open ${product.name}'s code review workflow.`,
    slashName: 'review',
    submitOnSelect: true,
  },
  {
    id: 'app.visualize',
    backend: 'codex',
    name: 'visualize',
    displayName: 'Visualize',
    description: `Open ${product.name} Visualize mode for diagrams.`,
    slashName: 'visualize',
    submitOnSelect: true,
  },
  {
    id: 'codex.plan',
    backend: 'codex',
    name: 'plan',
    displayName: 'Plan',
    description: 'Switch to Codex Plan mode.',
    slashName: 'plan',
    submitOnSelect: true,
  },
  {
    id: 'codex.goal',
    backend: 'codex',
    name: 'goal',
    displayName: 'Goal',
    description: 'Set or view the Codex thread goal.',
    slashName: 'goal',
    composerMode: {
      label: 'Goal',
      placeholder: 'Describe the goal',
    },
  },
  ...worktreeDelegationCommands('codex'),
];

export const claudeBackendCommands: BackendCommandSummary[] = [
  {
    id: 'claude.compact',
    backend: 'claude',
    name: 'compact',
    displayName: 'Compact',
    description: 'Compact the current Claude context while preserving a summary.',
    slashName: 'compact',
    submitOnSelect: true,
  },
  {
    id: 'app.review',
    backend: 'claude',
    name: 'review',
    displayName: 'Review',
    description: `Open ${product.name}'s code review workflow.`,
    slashName: 'review',
    submitOnSelect: true,
  },
  {
    id: 'app.visualize',
    backend: 'claude',
    name: 'visualize',
    displayName: 'Visualize',
    description: `Open ${product.name} Visualize mode for diagrams.`,
    slashName: 'visualize',
    submitOnSelect: true,
  },
  {
    id: 'claude.plan',
    backend: 'claude',
    name: 'plan',
    displayName: 'Plan',
    description: 'Switch to Claude Plan mode.',
    slashName: 'plan',
    submitOnSelect: true,
  },
  ...worktreeDelegationCommands('claude'),
];

function worktreeDelegationCommands(backend: AgentBackend): BackendCommandSummary[] {
  return ['delegate', 'worktree'].map((name) => ({
    id: `app.${name}`,
    backend,
    name,
    displayName: name === 'delegate' ? 'Delegate' : 'Worktree',
    description: name === 'delegate'
      ? 'Delegate this task to a new agent in a worktree.'
      : 'Alias for /delegate: start a new agent in a worktree.',
    slashName: name,
    submitOnSelect: true,
  }));
}

export function defaultBackendCommands(backend: AgentBackend): BackendCommandSummary[] {
  if (backend === 'antigravity') return [
    ...claudeBackendCommands.filter(command => command.id.startsWith('app.')).map(command => ({ ...command, backend })),
    { id: 'antigravity.plan', backend, name: 'plan', displayName: 'Plan', description: 'Create an Antigravity plan for review.', slashName: 'plan', submitOnSelect: true },
  ];
  return backend === 'claude' ? claudeBackendCommands : codexBackendCommands;
}
