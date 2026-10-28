import { describe, expect, it } from 'vitest';
import { defaultBackendCommands } from '../backend-commands';

describe('backend command catalog', () => {
  it.each(['codex', 'claude', 'antigravity'] as const)('keeps interactive planning out of the %s slash-command catalog', backend => {
    expect(defaultBackendCommands(backend).some(command => command.slashName === 'html-plan')).toBe(false);
  });
  it('does not offer native compact or goal controls for Antigravity', () => {
    expect(defaultBackendCommands('antigravity').filter(command => ['compact', 'goal'].includes(command.slashName ?? ''))).toEqual([]);
  });
  it.each(['codex', 'claude'] as const)('offers commands for the selected %s engine without ambiguous slash names', (backend) => {
    const commands = defaultBackendCommands(backend);
    expect(commands.every((command) => command.backend === backend)).toBe(true);
    expect(new Set(commands.map((command) => command.slashName)).size).toBe(commands.length);
    expect(commands.find((command) => command.slashName === 'compact')).toMatchObject({
      id: `${backend}.compact`, submitOnSelect: true,
    });
  });
});
