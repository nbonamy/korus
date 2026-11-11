import { product } from './product';
import type { HarnessProvider, ProviderCommandSummary } from './contracts';

export const codexProviderCommands: ProviderCommandSummary[] = [
  {
    id: 'codex.compact',
    provider: 'codex',
    name: 'compact',
    displayName: 'Compact',
    description: 'Compact the current Codex context.',
    slashName: 'compact',
    submitOnSelect: true,
  },
  {
    id: 'app.review',
    provider: 'codex',
    name: 'review',
    displayName: 'Review',
    description: `Open ${product.name}'s code review workflow.`,
    slashName: 'review',
    submitOnSelect: true,
  },
  {
    id: 'app.design',
    provider: 'codex',
    name: 'design',
    displayName: 'Design',
    description: `Open ${product.name} Design workspace.`,
    slashName: 'design',
    submitOnSelect: true,
  },
  {
    id: 'app.visualize',
    provider: 'codex',
    name: 'visualize',
    displayName: 'Visualize',
    description: `Open ${product.name} Visualize mode for diagrams.`,
    slashName: 'visualize',
    submitOnSelect: true,
  },
  {
    id: 'app.mission',
    provider: 'codex',
    name: 'mission',
    displayName: 'Mission',
    description: `Start a ${product.name} Mission from this prompt.`,
    slashName: 'mission',
    submitOnSelect: true,
  },
  {
    id: 'codex.plan',
    provider: 'codex',
    name: 'plan',
    displayName: 'Plan',
    description: 'Switch to Codex Plan mode.',
    slashName: 'plan',
    submitOnSelect: true,
  },
  {
    id: 'codex.goal',
    provider: 'codex',
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

export const claudeProviderCommands: ProviderCommandSummary[] = [
  {
    id: 'claude.compact',
    provider: 'claude',
    name: 'compact',
    displayName: 'Compact',
    description: 'Compact the current Claude context while preserving a summary.',
    slashName: 'compact',
    submitOnSelect: true,
  },
  {
    id: 'app.review',
    provider: 'claude',
    name: 'review',
    displayName: 'Review',
    description: `Open ${product.name}'s code review workflow.`,
    slashName: 'review',
    submitOnSelect: true,
  },
  {
    id: 'app.design',
    provider: 'claude',
    name: 'design',
    displayName: 'Design',
    description: `Open ${product.name} Design workspace.`,
    slashName: 'design',
    submitOnSelect: true,
  },
  {
    id: 'app.visualize',
    provider: 'claude',
    name: 'visualize',
    displayName: 'Visualize',
    description: `Open ${product.name} Visualize mode for diagrams.`,
    slashName: 'visualize',
    submitOnSelect: true,
  },
  {
    id: 'app.mission',
    provider: 'claude',
    name: 'mission',
    displayName: 'Mission',
    description: `Start a ${product.name} Mission from this prompt.`,
    slashName: 'mission',
    submitOnSelect: true,
  },
  {
    id: 'claude.plan',
    provider: 'claude',
    name: 'plan',
    displayName: 'Plan',
    description: 'Switch to Claude Plan mode.',
    slashName: 'plan',
    submitOnSelect: true,
  },
  ...worktreeDelegationCommands('claude'),
];

function worktreeDelegationCommands(provider: HarnessProvider): ProviderCommandSummary[] {
  return ['delegate', 'worktree'].map((name) => ({
    id: `app.${name}`,
    provider: provider,
    name,
    displayName: name === 'delegate' ? 'Delegate' : 'Worktree',
    description: name === 'delegate'
      ? 'Delegate this task to a new agent in a worktree.'
      : 'Alias for /delegate: start a new agent in a worktree.',
    slashName: name,
    submitOnSelect: true,
  }));
}

export function defaultProviderCommands(provider: HarnessProvider): ProviderCommandSummary[] {
  if (provider === 'cursor') return [
    ...codexProviderCommands
      .filter(command => ['app.design', 'app.visualize', 'app.mission', 'app.delegate', 'app.worktree'].includes(command.id))
      .map(command => ({ ...command, provider: provider })),
    { id: 'cursor.plan', provider: provider, name: 'plan', displayName: 'Plan', description: 'Switch to Cursor Plan mode.', slashName: 'plan', submitOnSelect: true },
  ];
  if (provider === 'antigravity') return [
    ...claudeProviderCommands.filter(command => command.id.startsWith('app.')).map(command => ({ ...command, provider: provider })),
    { id: 'antigravity.plan', provider: provider, name: 'plan', displayName: 'Plan', description: 'Create an Antigravity plan for review.', slashName: 'plan', submitOnSelect: true },
  ];
  return provider === 'claude' ? claudeProviderCommands : codexProviderCommands;
}
