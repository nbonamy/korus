import product from '../../../core/src/product.json' with { type: 'json' };
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appTextDescriptorKeys,
  literalTemplateCopy,
  messagePaths,
  missingAppTextMessages,
} from './check-i18n.mjs';

test('extracts app-text descriptors through the TypeScript AST', () => {
  const keys = appTextDescriptorKeys(`
    const status = { detail: { key: 'backend.connected' } };
    const permission = { key: \`permissions.approval.ask.label\` };
    const unrelated = { key: 'surface.settings' };
  `);

  assert.deepEqual(keys, ['backend.connected', 'permissions.approval.ask.label']);
});

test('indexes nested renderer messages', () => {
  const paths = messagePaths(`
    export const messages = {
      en: {
        provider: { connected: 'Connected' },
        permissions: { approval: { ask: { label: 'Ask' } } },
      },
    } as const;
  `);

  assert.equal(paths.has('backend.connected'), true);
  assert.equal(paths.has('permissions.approval.ask.label'), true);
  assert.equal(paths.has('backend.missing'), false);
});

test('reports app-text descriptors missing from the renderer catalog', () => {
  const catalog = new Set(['backend.connected']);

  assert.deepEqual(missingAppTextMessages([{
    file: 'fixture.ts',
    source: `
      const connected = { key: 'backend.connected' };
      const missing = { key: 'backend.missing' };
    `,
  }], catalog), [{ file: 'fixture.ts', key: 'backend.missing' }]);
});

test('reports literal template copy but allows bindings and the product name', () => {
  assert.deepEqual(literalTemplateCopy(`
    <template>
      <section>
        Literal copy
        <button aria-label="Literal label">{{ translated }}</button>
        <img :alt="translatedAlt" title="${product.name}">
      </section>
    </template>
  `), {
    text: ['Literal copy'],
    attributes: ['Literal label'],
  });
});
