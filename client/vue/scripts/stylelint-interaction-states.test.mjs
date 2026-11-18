import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';

const plugin = fileURLToPath(new URL('./stylelint-interaction-states.mjs', import.meta.url));
const codeFilename = fileURLToPath(new URL('../src/interaction-fixture.css', import.meta.url));
test('interaction ownership lint rejects copied paint and permits geometry, token inputs and toolkit adapters', async () => {
  const lint = code => stylelint.lint({ code, codeFilename, config: {
    plugins: [plugin], rules: { 'app/interaction-state-owner': true },
  } });
  const rejected = await lint('.app-button:hover { background: var(--color-surface-low); color: red; } button:disabled { opacity: .4; }');
  assert.equal(rejected.results[0].warnings.length, 3);
  const permitted = await lint(`
    .app-button { border-radius: 4px; --agent-ui-state-rest-foreground: var(--color-text); }
    .app-button:hover .status { color: var(--color-error); }
    .app-button::after { background: var(--color-primary); }
    .el-button.agent-ui-interactive { color: revert-layer; --el-button-hover-bg-color: var(--agent-ui-interactive-hover); }
    li.is-active { background: var(--color-primary-container); }
  `);
  assert.equal(permitted.errored, false);
});
