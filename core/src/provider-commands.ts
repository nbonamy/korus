import { product } from './product';
import type { HarnessProvider, ProviderCommandSummary } from './contracts';
import { defaultProviderCapabilities } from './provider-capabilities';

type AppCommand = Omit<ProviderCommandSummary, 'id' | 'provider' | 'slashName' | 'submitOnSelect'>;
/** Korus's own commands, the same in every agent's composer. */
const appCommands: AppCommand[] = [
  { name: 'review', displayName: 'Review', description: `Open ${product.name}'s code review workflow.` },
  { name: 'design', displayName: 'Design', description: `Open ${product.name} Design workspace.` },
  { name: 'visualize', displayName: 'Visualize', description: `Open ${product.name} Visualize mode for diagrams.` },
  { name: 'mission', displayName: 'Mission', description: `Start a ${product.name} Mission from this prompt.` },
  { name: 'delegate', displayName: 'Delegate', description: 'Delegate this task to a new agent in a worktree.' },
  { name: 'worktree', displayName: 'Worktree', description: 'Alias for /delegate: start a new agent in a worktree.' },
];

/** The slash commands an agent's composer offers: its harness's own, then Korus's. */
export function defaultProviderCommands(provider: HarnessProvider): ProviderCommandSummary[] {
  const harness = (defaultProviderCapabilities(provider).commands ?? []).map(command => ({ ...command }));
  const app = appCommands.map(command => ({ ...command, id: `app.${command.name}`, provider, slashName: command.name, submitOnSelect: true }));
  return [...harness, ...app];
}
