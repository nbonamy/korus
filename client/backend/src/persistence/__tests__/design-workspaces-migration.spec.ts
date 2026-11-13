import { expect, it } from 'vitest';
import { migrateData, rosterMigrations } from '../migrations';

// Frozen schema-5 input: one `designWorkspace` per agent.
it('turns the one design workspace of a schema-5 agent into the first of a list', () => {
  const workspace = { isOpen: true, document: { id: 'design-a', revision: 2 } };
  const migrated = migrateData('roster.json', { agents: [{ id: 'a', designWorkspace: workspace }, { id: 'b' }] }, 5, 6, rosterMigrations);
  expect(migrated).toStrictEqual({ agents: [{ id: 'a', designWorkspaces: [workspace] }, { id: 'b' }] });
});
