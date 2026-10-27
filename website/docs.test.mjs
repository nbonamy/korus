import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";
import product from "../core/src/product.json" with { type: "json" };

const artifact = new URL("../dist/website/", import.meta.url);
const origin = product.websiteUrl;

// App Store metadata must resolve to a policy, not the landing-page fallback.
test("the public privacy URL has a standalone policy and a discoverable contact", async () => {
  const dom = new JSDOM(
    await readFile(new URL("privacy/index.html", artifact), "utf8"),
    { url: `${origin}/privacy/` },
  );
  const landing = new JSDOM(
    await readFile(new URL("index.html", artifact), "utf8"),
    { url: origin },
  );
  try {
    const document = dom.window.document;
    assert.match(document.querySelector("main h1").textContent, /privacy/i);
    assert.equal(
      document.querySelector('link[rel="canonical"]').href,
      `${origin}/privacy/`,
    );
    assert.ok(document.querySelector('main a[href^="mailto:"]'));
    const policyText = document
      .querySelector("main")
      .textContent.replace(/\s+/g, " ");
    assert.match(policyText, /Android/);
    const push = document.querySelector("#notifications");
    const pushParagraphs = [];
    for (
      let node = push.nextElementSibling;
      node && node.tagName !== "H2";
      node = node.nextElementSibling
    ) {
      pushParagraphs.push(node.textContent);
    }
    const pushText = pushParagraphs.join(" ").replace(/\s+/g, " ");
    assert.match(pushText, /Apple Push Notification service/);
    assert.match(pushText, /Firebase Cloud Messaging/);
    assert.ok(
      document.querySelector(
        'a[href="https://firebase.google.com/support/privacy/"]',
      ),
    );
    assert.match(policyText, /Android Keystore/);
    assert.doesNotMatch(document.documentElement.outerHTML, /__PRODUCT_\w+__/);
    assert.ok(
      landing.window.document.querySelector('footer a[href="/privacy/"]'),
      "The website footer makes the policy accessible",
    );
  } finally {
    dom.window.close();
    landing.window.close();
  }
});

async function files(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${prefix}${entry.name}`;
      return entry.isDirectory()
        ? files(new URL(`${entry.name}/`, directory), `${path}/`)
        : [path];
    }),
  );
  return nested.flat();
}

// Protect the deployed /docs/ navigation boundary, including direct page loads.
// Inspect built HTML, never the Markdown or VitePress implementation source.
test("the built website has reachable documentation pages, anchors, and assets", async () => {
  const paths = await files(artifact);
  const documents = new Map();
  for (const path of paths.filter((path) => path.endsWith(".html"))) {
    documents.set(
      path,
      new JSDOM(await readFile(new URL(path, artifact), "utf8"), {
        url: `${origin}/${path}`,
      }),
    );
  }

  try {
    const landing = documents.get("index.html").window.document;
    assert.ok(landing.title.startsWith(product.name));
    assert.ok(
      landing.querySelector('#sharing video[aria-label="Sharing walkthrough"]'),
      "The Sharing card exposes its walkthrough",
    );
    // The deployed films and captions must preserve the approved local exports.
    const narrated = process.env.APP_NARRATED_FILMS
      ? pathToFileURL(`${resolve(process.env.APP_NARRATED_FILMS)}/`)
      : new URL("../videos/local/narrated/", import.meta.url);
    const manifest = JSON.parse(
      await readFile(new URL("narration.json", narrated), "utf8"),
    );
    for (const film of manifest.films) {
      // Feature-card covers link their film; hero films load from data-src.
      for (const [sources, filename] of [
        [
          [
            [".film-cover", "href"],
            [".showcase video", "data-src"],
          ],
          film.video,
        ],
        [[["video track", "data-src"]], film.subtitles],
      ]) {
        const published = sources
          .flatMap(([selector, attribute]) =>
            [...landing.querySelectorAll(selector)].map((node) =>
              node.getAttribute(attribute),
            ),
          )
          .find((value) => value?.endsWith(`-${filename}`));
        assert.ok(published, `${filename} is exposed by the built player`);
        assert.deepEqual(
          await readFile(new URL(published, artifact)),
          await readFile(new URL(filename, narrated)),
          `${filename} is published without changing the approved media`,
        );
      }
    }
    assert.ok(
      landing.querySelector(".brand").textContent.includes(product.name),
    );
    assert.doesNotMatch(
      landing.documentElement.outerHTML,
      /__(?:PRODUCT|DOWNLOAD)_\w+__/,
    );
    assert.equal(
      landing.querySelector('link[rel="canonical"]').href,
      `${origin}/`,
    );
    assert.equal(
      landing.querySelector('meta[property="og:url"]').content,
      `${origin}/`,
    );
    for (const selector of [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
    ]) {
      const image = new URL(landing.querySelector(selector).content);
      assert.equal(
        image.origin,
        origin,
        "Social cards use the public website origin",
      );
      assert.ok(await stat(new URL(image.pathname.slice(1), artifact)));
    }
    assert.ok(
      landing.querySelector('a[href="/docs/"]'),
      "Landing page links to the docs",
    );
    const home = documents.get("docs/index.html").window.document;
    const downloads = [...landing.querySelectorAll(".download-formats a")];
    assert.ok(
      downloads.length >= 4,
      "Each platform and Linux architecture has a download entry",
    );
    for (const link of downloads) {
      assert.ok(link.href.startsWith(`${product.repositoryUrl}/releases`));
      assert.doesNotMatch(
        link.href,
        /\/releases\/(?:tag|download)\//,
        "Public download links must not pin a release version",
      );
    }
    for (const [path, dom] of documents) {
      for (const link of dom.window.document.querySelectorAll("a[href]")) {
        const url = new URL(link.href);
        assert.ok(
          !url.pathname.startsWith("/desktop/downloads/"),
          `${path}: manual downloads go through the platform chooser or GitHub`,
        );
      }
    }
    assert.ok(
      home.querySelector(`a[href="${origin}/#download"]`),
      "Docs download navigation opens the platform chooser",
    );
    assert.ok(
      [...home.querySelectorAll("main a[href]")].some(
        (link) =>
          new URL(link.href).pathname ===
          "/docs/getting-started/quickstart.html",
      ),
      "The documentation introduction links to the quickstart",
    );

    let documentationLinks = 0;
    for (const [path, dom] of documents) {
      for (const element of dom.window.document.querySelectorAll(
        "a[href], img[src], script[src], link[href]",
      )) {
        const url = new URL(
          element.getAttribute("href") ?? element.getAttribute("src"),
          dom.window.location.href,
        );
        // Desktop release artifacts are published through a separate release workflow.
        if (url.origin !== origin || url.pathname.startsWith("/desktop/"))
          continue;
        const target = decodeURIComponent(url.pathname).slice(1);
        const info = await stat(new URL(target, artifact)).catch(() => null);
        assert.ok(
          info,
          `${path}: ${url.pathname} exists in the deployed artifact`,
        );
        const destination = info.isDirectory()
          ? `${target}${target.endsWith("/") || !target ? "" : "/"}index.html`
          : target;
        if (element.tagName === "A" && destination.startsWith("docs/"))
          documentationLinks++;
        if (info.isDirectory())
          assert.ok(
            documents.has(destination),
            `${url.pathname} has a directory index`,
          );
        if (url.hash && documents.has(destination)) {
          assert.ok(
            documents
              .get(destination)
              .window.document.getElementById(
                decodeURIComponent(url.hash.slice(1)),
              ),
            `${path}: anchor ${url.hash} exists in ${destination}`,
          );
        }
      }
    }
    assert.ok(documentationLinks > 0, "Documentation navigation was exercised");
  } finally {
    for (const dom of documents.values()) dom.window.close();
  }
});

// The deploy artifact must keep authoring files and internal documentation private.
test("the deployment artifact excludes documentation inputs and server configuration", async () => {
  const paths = await files(artifact);
  assert.ok(paths.includes("docs/index.html"));
  assert.ok(paths.includes("docs/404.html"));
  for (const path of paths) {
    assert.doesNotMatch(
      path,
      /(?:^|\/)\.(?:vitepress|env)(?:\/|$)|\.(?:md|mts|ts|mjs|conf|sh)$/,
      `${path} is a public asset rather than an authoring or operator file`,
    );
  }
});
