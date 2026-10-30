import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';

test('Mission message links reveal a usable document beside the conversation', async () => {
  const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const require = createRequire(new URL('../package.json', import.meta.url));
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const server = await createServer({
    configFile: false, root, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
    resolve: { alias: {
      '@workspace/core': path.join(root, 'core/src'),
      '@codex-app-sdk/vue/styles.css': require.resolve('@codex-app-sdk/vue/styles.css'),
    }, dedupe: ['vue'] },
    plugins: [vue(), {
      name: 'conversation-links-fixture',
      configureServer(server) {
        server.middlewares.use('/conversation-links', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><body><div id="app"></div><script type="module" src="/link-navigation-fixture.js"></script></body></html>');
        });
      },
      resolveId(id) { if (id === '/link-navigation-fixture.js') return '\0conversation-links-fixture'; },
      load(id) {
        if (id !== '\0conversation-links-fixture') return;
        return `
          import { createApp, h, reactive } from 'vue';
          import ElementPlus from 'element-plus';
          import 'element-plus/dist/index.css';
          import '@codex-app-sdk/vue/styles.css';
          import '/vue/src/styles/variables.css';
          import '/vue/src/styles/theme.css';
          import '/vue/src/styles/base.css';
          import { i18n } from '/vue/src/i18n/index.ts';
          import { createInitialSnapshot } from '/core/src/snapshot-construction.ts';
          import { createMission } from '/core/src/missions.ts';
          import { codexConversationSnapshot, codexTextMessage } from '/vue/src/test/codex-conversation-fixtures.ts';
          import AppShell from '/vue/src/components/AppShell.vue';
          const snapshot = createInitialSnapshot();
          snapshot.providerConnections = [{ backend: 'codex', installed: true, connected: true, checking: false }];
          const agent = snapshot.agents[0];
          agent.folder = ${JSON.stringify(root)};
          const mission = createMission(snapshot, { outcome: 'Read linked documents', workflowType: 'shapeAndShipFeature', teamId: agent.teamId, orchestratorMemberId: agent.id });
          mission.execution.runs.push({ id: 'requirements', stage: 'requirements', memberId: agent.id, workerId: agent.id, status: 'running', skills: [], feedback: '', startedAt: '' });
          localStorage.setItem('app.activeMissionId', mission.id);
          window.previewCalls = [];
          window.browserCalls = [];
          window.open = (...args) => { window.browserCalls.push(args); return null; };
          const imageBlob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1xkAAAAASUVORK5CYII=')).blob();
          const imageUrl = URL.createObjectURL(imageBlob);
          const messages = reactive(codexConversationSnapshot([
            codexTextMessage('links', 'assistant', '[Relative](README.md) [Absolute](<' + agent.folder + '/README.md>) [Example](https://example.com)'),
            { ...codexTextMessage('image', 'user', ''), parts: [{ type: 'attachment', attachment: { kind: 'image', url: imageUrl, name: 'Retained screenshot', mimeType: 'image/png' } }] },
          ]));
          window.releaseConversationImage = () => { URL.revokeObjectURL(imageUrl); messages.messages = messages.messages.filter(message => message.id !== 'image'); };
          createApp({ render: () => h(AppShell, {
            snapshot, activeAgent: agent, codexConversationSnapshot: messages,
            selectMission: async () => {},
            previewAgentFile: async (agentId, filePath) => {
              window.previewCalls.push([agentId, filePath]);
              return { kind: 'text', path: 'README.md', content: ${JSON.stringify(readme)}, size: ${Buffer.byteLength(readme)} };
            },
          }) }).use(ElementPlus).use(i18n).mount('#app');
        `;
      },
    }],
  });
  let browser;
  const artifacts = process.env.CONVERSATION_LINK_ARTIFACTS;
  try {
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    page.setDefaultTimeout(15_000);
    await page.goto(`${server.resolvedUrls.local[0]}conversation-links`);
    await page.locator('.app-shell').waitFor();
    const conversation = page.locator('.mission-conversation-rail');
    await conversation.getByRole('link', { name: 'Example', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.browserCalls), [['https://example.com', '_blank', 'noopener,noreferrer']]);
    const measurements = [];
    for (const [label, width] of [['Relative', 1440], ['Absolute', 1280]]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await conversation.getByRole('link', { name: label, exact: true }).click();
      const document = page.locator('.right-workspace-panel:visible .markdown-panel');
      await document.waitFor({ state: 'visible' });
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await conversation.isVisible(), true, 'the Mission conversation must remain visible below its 980px container breakpoint');
      const chatBounds = await conversation.boundingBox();
      const documentBounds = await document.boundingBox();
      assert.ok(chatBounds.width >= 300 && chatBounds.height > 300, 'the conversation must retain usable space');
      assert.ok(documentBounds.width >= 240 && documentBounds.height > 300, 'the preview must retain usable space');
      assert.ok(chatBounds.x + chatBounds.width <= documentBounds.x + 1, 'the document must sit beside the conversation');
      assert.ok(documentBounds.x + documentBounds.width <= width + 1, 'the preview must fit in the viewport');
      assert.equal(await page.locator('.mission-workspace__workbench').isVisible(), false);
      const toggle = page.getByRole('button', { name: 'Toggle right workspace' });
      await toggle.click();
      assert.equal(await page.locator('.mission-workspace__workbench').isVisible(), true);
      assert.equal(await document.isVisible(), false);
      await toggle.click();
      assert.equal(await document.isVisible(), true);
      measurements.push({ width, chatBounds, documentBounds });
      if (artifacts) {
        await mkdir(artifacts, { recursive: true });
        await page.screenshot({ path: path.join(artifacts, `mission-links-${width}.png`) });
      }
      await page.getByRole('button', { name: 'Close README.md tab', exact: true }).click();
      assert.equal(await page.locator('.mission-workspace__workbench').isVisible(), true);
    }
    assert.deepEqual(await page.evaluate(() => window.previewCalls), [['agent-dina', 'README.md'], ['agent-dina', 'README.md']]);
    // The conversation owns this temporary URL; the independent image tab must survive its release.
    await page.setViewportSize({ width: 1440, height: 900 });
    await conversation.getByRole('button', { name: 'Open Retained screenshot', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.image-preview-panel img')?.naturalWidth === 1);
    const retainedSource = await page.locator('.image-preview-panel img').getAttribute('src');
    await page.evaluate(() => window.releaseConversationImage());
    await conversation.getByRole('link', { name: 'Relative', exact: true }).click();
    await page.getByRole('tab', { name: 'Retained screenshot', exact: true }).click();
    assert.equal(await page.evaluate(async () => {
      try { return (await fetch(document.querySelector('.image-preview-panel img').src)).ok; } catch { return false; }
    }), true, 'the image tab must own readable bytes after the conversation releases its preview');
    await page.waitForFunction(() => document.querySelector('.image-preview-panel img')?.naturalWidth === 1);
    await page.getByRole('button', { name: 'Automations', exact: true }).click();
    assert.equal(await page.locator('.image-preview-panel').count(), 0);
    await page.locator('.team-rail__team').first().click();
    await page.getByRole('tab', { name: 'Retained screenshot', exact: true }).click();
    assert.equal(await page.evaluate(async () => {
      try { return (await fetch(document.querySelector('.image-preview-panel img').src)).ok; } catch { return false; }
    }), true, 'image-tab bytes must survive navigating away from the workspace');
    if (artifacts) await page.screenshot({ path: path.join(artifacts, 'image-tab-retained.png') });
    await page.getByRole('button', { name: 'Close Retained screenshot tab', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Retained screenshot', exact: true }).count(), 0);
    assert.equal(await page.locator('.image-preview-panel img').count(), 0);
    await page.waitForFunction(async source => { try { await fetch(source); return false; } catch { return true; } }, retainedSource);
    measurements.push({ imageSurvivesPreviewRelease: true, imageSurvivesWorkspaceNavigation: true, tabSourceRevokedOnClose: true });
    assert.deepEqual(errors, []);
    if (artifacts) await writeFile(path.join(artifacts, 'measurements.json'), JSON.stringify(measurements, null, 2));
  } finally {
    await browser?.close();
    await server.close();
  }
});
