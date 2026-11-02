import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import "./downloads.test.mjs";
import { fileURLToPath } from "node:url";

// Reuse the renderer workspace's declared DOM test dependency.
const require = createRequire(
  new URL("../client/vue/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");

test("visitors can navigate the page and reach the desktop download", async () => {
  const dom = await JSDOM.fromFile(
    fileURLToPath(new URL("index.html", import.meta.url)),
  );
  try {
    const { document } = dom.window;
    const links = [...document.querySelectorAll('a[href^="#"]')];
    assert.ok(links.length > 0);
    for (const link of links) {
      assert.ok(document.querySelector(link.hash), "Link destination exists");
      const changed =
        dom.window.location.hash === link.hash
          ? Promise.resolve()
          : new Promise((resolve) =>
              dom.window.addEventListener("hashchange", resolve, {
                once: true,
              }),
            );
      link.click();
      await changed;
      assert.equal(dom.window.location.hash, link.hash);
    }

    const downloads = [
      ...document.querySelectorAll("[data-platform-download]"),
    ];
    assert.equal(downloads.length, 2);
    for (const link of downloads) assert.equal(link.hash, "#download");
    // docs.test.mjs checks final download URLs on the built artifact.
  } finally {
    dom.window.close();
  }
});
