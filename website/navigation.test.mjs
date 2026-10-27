import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import test from "node:test";
import { chromium } from "playwright";
import { JSDOM } from "jsdom";

// Catch navigation that disappears at responsive breakpoints. This exercises
// the actual built page and its styles through a browser, without source assertions.
test("navigation, films, and cards work at desktop and phone widths", async () => {
  const artifact = new URL("../dist/website/", import.meta.url);
  const types = {
    ".css": "text/css",
    ".js": "text/javascript",
    ".html": "text/html",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".vtt": "text/vtt",
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const file = path.endsWith("/") ? `${path}index.html` : path;
    try {
      const body = await readFile(new URL(`.${file}`, artifact));
      const type = types[file.slice(file.lastIndexOf("."))];
      const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : body.length - 1;
        response.writeHead(206, {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${body.length}`,
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
        });
        response.end(body.subarray(start, end + 1));
        return;
      }
      response.writeHead(200, {
        "Content-Type": type ?? "application/octet-stream",
        "Content-Length": body.length,
        "Accept-Ranges": "bytes",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  let browser;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    for (const width of [1440, 1040, 820, 761, 760, 600, 430, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(origin);
      for (const selector of [
        ".hero-copy",
        ".hero h1",
        ".hero-lede",
        ".hero-actions .button",
        ".showcase-stage",
        '[role="tab"] >> nth=0',
        '[role="tab"] >> nth=2',
      ]) {
        const bounds = await page.locator(selector).boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width,
          `Hero copy fits at ${width}px: ${selector}`,
        );
      }
      const header = page.getByRole("banner");
      const youtube = header.getByRole("link", {
        name: "YouTube",
        exact: true,
      });
      assert.equal(
        await youtube.isVisible(),
        true,
        `YouTube is visible at ${width}px`,
      );
      assert.equal(
        await youtube.getAttribute("href"),
        "https://www.youtube.com/@korus-dev",
      );
      await youtube.focus();
      assert.equal(
        await youtube.evaluate((node) => node === document.activeElement),
        true,
      );
      const github = header.getByRole("link", { name: "GitHub", exact: true });
      assert.equal(
        await github.isVisible(),
        true,
        `GitHub is visible at ${width}px`,
      );
      assert.equal(
        await github.getAttribute("href"),
        "https://github.com/nbonamy/korus",
      );
      await github.focus();
      assert.equal(
        await github.evaluate((node) => node === document.activeElement),
        true,
      );
      const headerLinks = await header.locator("a:visible").all();
      let previousRight = 0;
      for (const link of headerLinks) {
        const rect = await link.boundingBox();
        assert.ok(
          rect.x >= previousRight && rect.x + rect.width <= width,
          `Header links fit without overlap at ${width}px`,
        );
        previousRight = rect.x + rect.width;
      }
      const docs = header.getByRole("link", { name: "Docs", exact: true });
      assert.equal(
        await docs.isVisible(),
        true,
        `Docs is visible at ${width}px`,
      );
      const bounds = await docs.boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= width,
        `Docs fits at ${width}px`,
      );
      const download = header.getByRole("link", { name: /^Download/ });
      assert.equal(await download.isVisible(), true);
      const downloadBounds = await download.boundingBox();
      assert.ok(
        downloadBounds.x >= 0 &&
          downloadBounds.x + downloadBounds.width <= width,
        `Download fits at ${width}px`,
      );
      // Card previews must neither overlap wrapped copy nor escape their cards.
      for (const card of await page.locator(".capability").all()) {
        const layout = await card.evaluate((element) => {
          const preview = element.querySelector(
            ".capability-shot, .product-film",
          );
          if (!preview) return null;
          const copy = element.querySelector("p");
          const a = copy.getBoundingClientRect();
          const b = preview.getBoundingClientRect();
          const outer = element.getBoundingClientRect();
          return {
            overlap:
              a.left < b.right &&
              b.left < a.right &&
              a.top < b.bottom &&
              b.top < a.bottom,
            contained:
              b.left >= outer.left &&
              b.right <= outer.right &&
              b.bottom <= outer.bottom,
          };
        });
        if (!layout) continue;
        assert.equal(
          layout.overlap,
          false,
          `Card preview overlaps copy at ${width}px`,
        );
        assert.equal(
          layout.contained,
          true,
          `Card preview escapes its card at ${width}px`,
        );
      }
      // Product screenshots load and stay inside the viewport.
      for (const shot of await page.locator(".capability-shot").all()) {
        await shot.scrollIntoViewIfNeeded();
        await page.waitForFunction(
          (node) => node.complete && node.naturalWidth > 0,
          await shot.elementHandle(),
        );
        const bounds = await shot.boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width,
          `Screenshot fits at ${width}px`,
        );
      }
      const films = page.locator(".product-film");
      for (const option of await page.locator(".download-option").all()) {
        const bounds = await option.boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width,
          `Download option fits at ${width}px`,
        );
        for (const link of await option.locator("a").all()) {
          const inner = await link.boundingBox();
          assert.ok(
            inner.x >= bounds.x &&
              inner.x + inner.width <= bounds.x + bounds.width,
            "Download links stay in their card",
          );
        }
      }
      assert.equal(await films.count(), 3);
      const intro = await page.locator(".hero").boundingBox();
      const project = await films.first().boundingBox();
      assert.ok(
        project.y >= intro.y + intro.height,
        "Click-to-play films follow the hero",
      );
      for (const film of await films.all()) {
        const bounds = await film.boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width,
          "Film fits viewport",
        );
        const captions = film.getByRole("button", { name: /captions$/ });
        assert.equal(
          await captions.evaluate((node) => {
            const style = getComputedStyle(node);
            const metadata = getComputedStyle(node.closest("figcaption"));
            return (
              style.borderTopWidth === "0px" &&
              style.backgroundColor === "rgba(0, 0, 0, 0)" &&
              style.color === metadata.color &&
              style.fontSize === metadata.fontSize &&
              style.fontWeight === metadata.fontWeight
            );
          }),
          true,
          "Caption toggle looks like the adjacent metadata, not a boxed button",
        );
        const captionBounds = await captions.boundingBox();
        const frameBounds = await film.locator(".film-frame").boundingBox();
        assert.ok(
          captionBounds.y >= frameBounds.y + frameBounds.height,
          "Caption toggle stays below the player, not over native controls",
        );
        assert.ok(
          captionBounds.x >= 0 &&
            captionBounds.x + captionBounds.width <= width,
          "Caption toggle fits on mobile",
        );
      }
      await docs.click();
      await page.getByRole("heading", { level: 1 }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/docs/");
    }
    await page.goto(origin);
    await page
      .locator("#automations a[href='/docs/features/automations.html']")
      .click();
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(
      new URL(page.url()).pathname,
      "/docs/features/automations.html",
    );
    // OS is a shortcut, never an inferred CPU architecture or a mobile download.
    for (const [userAgent, touch, platform] of [
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", false, "macos"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false, "windows"],
      ["Mozilla/5.0 (X11; Linux x86_64)", false, "linux"],
      ["Mozilla/5.0 (X11; Linux aarch64)", false, "linux"],
      ["Mozilla/5.0 (Linux; Android 14)", true, null],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", true, null],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true, null],
      ["Mozilla/5.0 (X11; CrOS x86_64)", false, null],
      ["Unknown browser", false, null],
    ]) {
      const context = await browser.newContext({
        userAgent,
        hasTouch: touch,
        viewport: { width: 320, height: 844 },
      });
      if (touch)
        await context.addInitScript(() =>
          Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 }),
        );
      const visitor = await context.newPage();
      await visitor.route("**/*", (route) =>
        route.request().url().startsWith(origin)
          ? route.continue()
          : route.abort(),
      );
      await visitor.goto(origin);
      const buttonBounds = await visitor
        .locator(".hero-actions .button")
        .boundingBox();
      assert.ok(
        buttonBounds.x >= 0 && buttonBounds.x + buttonBounds.width <= 320,
        `${platform}: OS-specific button fits on a small screen`,
      );
      const shortcut = visitor.locator(".header-cta");
      const installer =
        platform && platform !== "linux"
          ? visitor
              .locator(`[data-platform="${platform}"] a[data-installer]`)
              .first()
          : null;
      const target =
        installer && (await installer.count())
          ? await installer.getAttribute("href")
          : `#download${platform ? `-${platform}` : ""}`;
      assert.equal(await shortcut.getAttribute("href"), target, userAgent);
      assert.equal(
        await visitor.locator("[data-detected]").count(),
        platform ? 1 : 0,
      );
      assert.equal(
        await visitor.getByRole("link", { name: "All downloads" }).count(),
        1,
      );
      assert.equal(
        await visitor.locator(".download-architecture").count(),
        2,
        "Both Linux architectures stay available",
      );
      await context.close();
    }
    // Exercise direct-download shortcuts with published-asset DOM fixtures.
    // The public repository may have no releases while this test runs.
    for (const [platform, userAgent, filename] of [
      [
        "macos",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "app-macos-arm64.dmg",
      ],
      [
        "windows",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "app-win32-x64-setup.exe",
      ],
    ]) {
      const visitor = await browser.newPage({ userAgent });
      const installerUrl = `https://github.com/example/app/releases/download/v1.2.3/${filename}`;
      await visitor.route("**/*", async (route) => {
        if (route.request().url() === `${origin}/`) {
          const response = await route.fetch();
          const fixture = new JSDOM(await response.text());
          const link = fixture.window.document.querySelector(
            `[data-platform="${platform}"] a`,
          );
          link.href = installerUrl;
          link.setAttribute("data-installer", "");
          await route.fulfill({ response, body: fixture.serialize() });
          fixture.window.close();
        } else if (route.request().url().startsWith(origin))
          await route.continue();
        else await route.abort();
      });
      await visitor.goto(origin);
      for (const shortcut of await visitor
        .locator("[data-platform-download]")
        .all())
        assert.equal(await shortcut.getAttribute("href"), installerUrl);
      await visitor.close();
    }
    // The hero previews its films muted, in tab order, loading only the selected one.
    const heroRequests = [];
    const hero = await browser.newPage();
    hero.on("request", (request) => {
      if (/\.(mp4|vtt)$/.test(request.url()))
        heroRequests.push(new URL(request.url()).pathname);
    });
    await hero.goto(origin);
    const heroFilms = new Set(
      await hero.evaluate(() =>
        [...document.querySelectorAll(".showcase [data-src]")].map(
          (node) => `/${node.dataset.src}`,
        ),
      ),
    );
    const heroVideo = (name) => hero.locator(`#showcase-${name}`);
    const playing = (name) =>
      hero.waitForFunction((id) => {
        const video = document.getElementById(id);
        return video.currentTime > 0 && !video.paused;
      }, `showcase-${name}`);
    await playing("delegation");
    assert.equal(
      await heroVideo("delegation").evaluate(
        (video) => video.muted && !video.controls,
      ),
      true,
      "The hero preview plays muted without controls",
    );
    assert.deepEqual(
      [...new Set(heroRequests)],
      [`/${await heroVideo("delegation").getAttribute("data-src")}`],
    );
    const tabs = hero.getByRole("tab");
    assert.equal(await tabs.count(), 3);
    await tabs.nth(1).click();
    await playing("review");
    assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
    assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "false");
    assert.equal(
      await heroVideo("delegation").evaluate((video) => video.paused),
      true,
      "Switching tabs pauses the previous film",
    );
    await tabs.nth(1).press("ArrowRight");
    await playing("mission");
    assert.equal(
      await tabs.nth(2).evaluate((tab) => tab === document.activeElement),
      true,
      "Arrow keys move between tabs",
    );
    // A preview that finishes hands over to the next tab.
    await heroVideo("mission").evaluate((video) => {
      video.currentTime = video.duration - 0.2;
    });
    await playing("delegation");
    assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "true");
    const watch = hero.getByRole("link", { name: "Watch with sound" });
    await watch.click();
    await hero.waitForFunction(() => {
      const video = document.getElementById("showcase-delegation");
      return (
        !video.muted &&
        video.controls &&
        video.textTracks[0].mode === "showing" &&
        video.currentTime > 0
      );
    });
    assert.equal(await watch.isVisible(), false);
    // A watched film stays put when it ends rather than advancing.
    await heroVideo("delegation").evaluate((video) => {
      video.currentTime = video.duration - 0.2;
    });
    await hero.waitForFunction(
      () => document.getElementById("showcase-delegation").ended,
    );
    assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "true");
    await hero.locator(".product-film .film-cover").first().click();
    await hero.waitForFunction(
      () => document.querySelector(".product-film video").currentTime > 0,
    );
    assert.equal(
      await heroVideo("delegation").evaluate((video) => video.paused),
      true,
      "Starting another film pauses the hero",
    );
    await tabs.nth(1).click();
    await playing("review");
    assert.equal(
      await hero.evaluate(
        () => document.querySelector(".product-film video").paused,
      ),
      true,
      "Only one film plays at a time",
    );
    await hero.close();
    const still = await browser.newContext({ reducedMotion: "reduce" });
    const calm = await still.newPage();
    const calmRequests = [];
    calm.on("request", (request) => {
      if (/\.(mp4|vtt)$/.test(request.url())) calmRequests.push(request.url());
    });
    await calm.goto(origin);
    await calm.getByRole("tab").nth(1).click();
    assert.equal(
      await calm
        .locator("#showcase-review")
        .evaluate(
          (video) =>
            video.classList.contains("is-active") &&
            video.paused &&
            video.poster.length > 0,
        ),
      true,
    );
    assert.equal(calmRequests.length, 0, "Reduced motion keeps posters still");
    await still.close();
    // Fetch other media only after intent; exercise decoding, controls and single playback.
    const mediaRequests = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/\.(mp4|vtt)$/.test(path) && !heroFilms.has(path))
        mediaRequests.push(path);
    });
    await page.goto(origin);
    for (const film of await page.locator(".product-film").all())
      await film.scrollIntoViewIfNeeded();
    assert.equal(
      mediaRequests.length,
      0,
      "Browsing the page does not fetch films",
    );
    const assertCaptionPreference = async (enabled) => {
      await page.waitForFunction(
        (enabled) =>
          [...document.querySelectorAll(".film-captions")].every(
            (button) => button.getAttribute("aria-pressed") === String(enabled),
          ) &&
          [...document.querySelectorAll("track[src]")].every(
            (track) => track.track.mode === (enabled ? "showing" : "disabled"),
          ),
        enabled,
      );
    };
    await page.locator(".film-captions").first().click();
    await assertCaptionPreference(false);
    await page.locator(".film-captions").last().click();
    await assertCaptionPreference(true);
    assert.equal(
      mediaRequests.length,
      0,
      "Shared preferences keep unopened films lazy",
    );
    let previous;
    for (const film of await page.locator(".product-film").all()) {
      const captions = film.getByRole("button", { name: /captions$/ });
      assert.equal(await captions.getAttribute("aria-pressed"), "true");
      assert.equal((await captions.textContent()).trim(), "Captions on");
      if (previous) {
        await captions.click();
        assert.equal(await captions.getAttribute("aria-pressed"), "false");
        assert.equal((await captions.textContent()).trim(), "Captions off");
        await captions.click();
      }
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await captions.isEnabled(),
        true,
        "Selecting CC before Play must not mark valid captions unavailable",
      );
      const cover = film.getByRole("link", { name: /^Play / });
      await cover.focus();
      await page.keyboard.press("Enter");
      const video = film.locator("video");
      assert.equal(
        await video.evaluate((node) => node.muted),
        !previous,
        "Films start muted, then inherit the visitor's sound preference",
      );
      if (!previous) {
        await video.evaluate((node) => {
          node.muted = false;
          node.volume = 0.6;
        });
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".product-film video")].every(
            (video) => !video.muted && video.volume === 0.6,
          ),
        );
      }
      await video.evaluate(
        (node) =>
          new Promise((resolve, reject) => {
            if (node.currentTime > 0) return resolve();
            const timer = setTimeout(
              () => reject(new Error("Video did not play")),
              10000,
            );
            node.addEventListener(
              "timeupdate",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          }),
      );
      assert.equal(
        await video.evaluate(
          (node) => node.videoWidth > 0 && node.controls && !node.paused,
        ),
        true,
      );
      await page.waitForFunction(
        (id) => {
          const video = document.getElementById(id);
          return (
            video.textTracks[0]?.cues?.length > 0 &&
            video.webkitAudioDecodedByteCount > 0
          );
        },
        await video.getAttribute("id"),
      );
      await video.evaluate((node) => {
        node.pause();
        node.currentTime = node.textTracks[0].cues[0].startTime + 0.15;
      });
      await page.waitForFunction(
        (id) =>
          document.getElementById(id).textTracks[0]?.activeCues?.length > 0,
        await video.getAttribute("id"),
      );
      assert.equal(
        await video.evaluate((node) =>
          [...node.textTracks[0].cues].every(
            (cue) =>
              !cue.snapToLines &&
              (1 - cue.line / 100) * node.clientHeight >= 60 &&
              (1 - cue.line / 100) * node.clientHeight <= 80 &&
              cue.lineAlign === "end",
          ),
        ),
        true,
        "Captions sit low with room for native controls",
      );
      await captions.click();
      await assertCaptionPreference(false);
      assert.equal(
        await video.evaluate((node) => node.textTracks[0].mode),
        "disabled",
      );
      // Changing captions in the native menu must also update the external button.
      await video.evaluate((node) => {
        node.textTracks[0].mode = "showing";
      });
      await page.waitForFunction(
        (id) =>
          document
            .querySelector(`[aria-controls="${id}"]`)
            .getAttribute("aria-pressed") === "true",
        await video.getAttribute("id"),
      );
      await assertCaptionPreference(true);
      await video.evaluate((node) => node.play());
      if (previous)
        assert.equal(
          await previous.evaluate((node) => node.paused),
          true,
          "Starting another film pauses the first",
        );
      previous = video;
    }
    await previous.evaluate((node) => {
      node.muted = true;
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".product-film video")].every(
        (video) => video.muted,
      ),
    );
    await previous.evaluate((node) => {
      node.currentTime = node.duration - 0.1;
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".product-film video")].some(
        (video) => video.ended,
      ),
    );
    // A disabled preference must survive opening a previously unopened film.
    await page.reload();
    await page.locator(".film-captions").first().click();
    const unopenedFilm = page.locator(".product-film").nth(1);
    await unopenedFilm.locator(".film-cover").click();
    await page.waitForFunction(
      () => document.getElementById("film-visualize").currentTime > 0,
    );
    await assertCaptionPreference(false);
    assert.equal(
      await unopenedFilm.locator("video").evaluate((video) => video.muted),
      true,
      "A reload resets sound to muted",
    );
    await unopenedFilm.locator(".film-captions").click();
    await assertCaptionPreference(true);
    await page.waitForFunction(
      () =>
        document.getElementById("film-visualize").textTracks[0]?.cues?.length >
        0,
    );
    await page.route("**/media/*.vtt", (route) => route.abort());
    await page.reload();
    const firstFilm = page.locator(".product-film").first();
    await firstFilm.getByRole("link", { name: /^Play / }).click();
    await page.waitForFunction(
      () => document.querySelector(".film-captions").disabled,
    );
    assert.match(
      await firstFilm.locator(".film-captions").textContent(),
      /unavailable/,
    );
    await page.waitForFunction(
      () => document.querySelector(".product-film video").currentTime > 0,
    );
    await page.unroute("**/media/*.vtt");
    await page.route("**/media/*.mp4", (route) => route.abort());
    await page.reload();
    await page
      .getByRole("link", { name: /^Play / })
      .first()
      .click();
    const error = page.getByRole("status");
    await error.waitFor();
    assert.equal(
      await error.getByRole("link", { name: "Open video" }).count(),
      1,
    );
    const noScript = await browser.newPage({ javaScriptEnabled: false });
    await noScript.goto(origin);
    assert.equal(
      await noScript.locator(".header-cta").getAttribute("href"),
      "#download",
    );
    await noScript.locator(".header-cta").click();
    assert.equal(new URL(noScript.url()).hash, "#download");
    assert.equal(await noScript.locator(".download-option").count(), 3);
    assert.equal(await noScript.locator(".download-architecture").count(), 2);
    for (const link of await noScript.locator(".download-formats a").all())
      assert.match(await link.getAttribute("href"), /^https:\/\/github\.com\//);
    const heroLink = noScript.getByRole("link", { name: "Watch with sound" });
    const heroMedia = await noScript.request.get(
      new URL(await heroLink.getAttribute("href"), origin).href,
    );
    assert.equal(heroMedia.headers()["content-type"], "video/mp4");
    const direct = noScript.getByRole("link", { name: /^Play / }).first();
    assert.equal(
      await noScript.locator(".film-captions").first().isVisible(),
      false,
      "Do not show a nonfunctional caption toggle without JavaScript",
    );
    assert.equal(
      await direct.evaluate((node) => {
        for (let parent = node; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).opacity === "0") return false;
        }
        return true;
      }),
      true,
      "Film covers remain visible without JavaScript",
    );
    const media = await noScript.request.get(
      new URL(await direct.getAttribute("href"), origin).href,
    );
    assert.equal(media.status(), 200);
    assert.equal(media.headers()["content-type"], "video/mp4");
    await noScript.close();
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
