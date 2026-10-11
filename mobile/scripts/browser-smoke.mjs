import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = fileURLToPath(
  new URL("../.native-build/browser/", import.meta.url),
);
const server = await preview({
  root,
  configFile: `${root}vite.config.ts`,
  preview: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole("button", { name: "Open demo laptop" }).click();
  await page
    .getByRole("combobox", { name: "Team", exact: true })
    .selectOption("demo-team");
  await page
    .getByRole("combobox", { name: "Agent", exact: true })
    .selectOption("demo-agent");
  const editor = page.locator("[contenteditable=true]");
  await editor.fill("Browser prompt");
  assert.ok(
    (await editor.evaluate((node) =>
      parseFloat(getComputedStyle(node).fontSize),
    )) >= 16,
    "iOS keyboard focus must not zoom the composer",
  );
  await page.getByRole("button", { name: "Send prompt", exact: true }).click();
  await page.getByText("Demo prompt received.", { exact: false }).waitFor();
  assert.equal(
    await page.getByText("Browser prompt", { exact: true }).count(),
    1,
  );
  await editor.fill("Draft survives disconnect");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Send prompt", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await page.getByText("Connected to demo laptop", { exact: false }).waitFor();
  assert.equal(await editor.innerText(), "Draft survives disconnect");
  assert.equal(
    await page.getByText("Browser prompt", { exact: true }).count(),
    1,
  );
  await page
    .getByRole("combobox", { name: "Agent", exact: true })
    .selectOption("demo-reviewer");
  assert.equal(await editor.innerText(), "");
  assert.equal(
    await page.getByText("Browser prompt", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("combobox", { name: "Agent", exact: true })
    .selectOption("demo-agent");
  assert.equal(await editor.innerText(), "Draft survives disconnect");
  const viewports = [];
  await mkdir(artifacts, { recursive: true });
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width, height });
    const result = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      composer: document
        .querySelector("[contenteditable=true]")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.ok(result.scrollWidth <= width, "companion must fit horizontally");
    assert.ok(
      result.composer.top >= 0 && result.composer.bottom <= height,
      "composer must remain in the viewport",
    );
    viewports.push(result);
    await page.screenshot({ path: `${artifacts}${width}x${height}.png` });
  }
  await page
    .getByRole("button", { name: "Forget laptop", exact: true })
    .click();
  await page.getByRole("button", { name: "Open demo laptop" }).waitFor();
  assert.equal(await editor.count(), 0);
  assert.deepEqual(errors, []);
  const evidence = {
    errors,
    viewports,
    promptCountAfterReconnect: 1,
    draftPreserved: true,
    revoked: true,
  };
  await writeFile(
    `${artifacts}result.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    "Mobile browser smoke passed: send, selection isolation, draft/reconnect, revocation, keyboard font and four viewport sizes.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : resolve())),
  );
}
