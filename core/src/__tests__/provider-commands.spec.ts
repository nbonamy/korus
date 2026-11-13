import { describe, expect, it } from 'vitest';
import { defaultProviderCommands } from '../provider-commands';

describe('backend command catalog', () => {
  it.each(['codex', 'claude', 'antigravity'] as const)('keeps interactive planning out of the %s slash-command catalog', provider => {
    expect(defaultProviderCommands(provider).some(command => command.slashName === 'html-plan')).toBe(false);
  });
  it('does not offer native compact or goal controls for Antigravity', () => {
    expect(defaultProviderCommands('antigravity').filter(command => ['compact', 'goal'].includes(command.slashName ?? ''))).toEqual([]);
  });
  it.each(['codex', 'claude'] as const)('offers commands for the selected %s engine without ambiguous slash names', (backend) => {
    const commands = defaultProviderCommands(backend);
    expect(commands.every((command) => command.provider === backend)).toBe(true);
    expect(new Set(commands.map((command) => command.slashName)).size).toBe(commands.length);
    expect(commands.find((command) => command.slashName === 'compact')).toMatchObject({
      id: `${backend}.compact`, submitOnSelect: true,
    });
  });
});

it('offers native Cursor plan mode, then supported app commands, without Codex controls', () => {
  expect(defaultProviderCommands('cursor').map(({id,provider: provider,slashName,submitOnSelect}) => ({id,provider: provider,slashName,submitOnSelect})))
    .toStrictEqual([
      {id:'cursor.plan',provider:'cursor',slashName:'plan',submitOnSelect:true},
      ...['review','design','visualize','mission','delegate','worktree'].map(name => ({id:`app.${name}`,provider:'cursor',slashName:name,submitOnSelect:true})),
    ]);
});

it.each(['codex', 'claude', 'cursor', 'antigravity'] as const)('offers the %s harness commands first, then Korus commands', provider => {
  const commands = defaultProviderCommands(provider);
  const firstApp = commands.findIndex(command => command.id.startsWith('app.'));
  expect(commands.slice(0, firstApp).every(command => command.id === `${provider}.${command.name}`)).toBe(true);
  expect(commands.slice(firstApp).every(command => command.id.startsWith('app.'))).toBe(true);
});
