import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { chromium } from "playwright";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const repo = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const value = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const source = path.resolve(value("--source", repo)),
  output = path.resolve(value("--out", "/tmp/korus-chart-comparison/before"));
const baseline = args.includes("--baseline");
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(os.tmpdir(), "korus-chart-capture-"));
const tokens = (
  await readFile(
    path.join(source, "client/vue/src/styles/variables.css"),
    "utf8",
  )
)
  .split("\n")
  .filter((line) => !line.startsWith("@import"))
  .join("\n");
await writeFile(
  path.join(root, "index.html"),
  `<html><head><style>${tokens}</style></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`,
);
await writeFile(
  path.join(root, "entry.js"),
  `import {createApp} from 'vue';import {i18n} from '${source}/client/vue/src/i18n/index.ts';import App from '${repo}scripts/fixtures/AnalyticsChartCapture.vue';import '${source}/server/frontend/src/style.css';createApp(App).use(i18n).mount('#app');`,
);
const server = await createServer({
  root,
  configFile: false,
  plugins: [vue()],
  optimizeDeps: {
    noDiscovery: true,
    exclude: [
      "vue",
      "vue-i18n",
      "@vue/runtime-core",
      "@vue/runtime-dom",
      "@vue/reactivity",
      "@vue/shared",
    ],
  },
  resolve: {
    alias: {
      vue: path.join(repo, "node_modules/vue/dist/vue.runtime.esm-bundler.js"),
      "@workspace/core": path.join(source, "core/src"),
      "@analytics-desktop": path.join(source, "client/vue/src"),
      "@analytics-server": path.join(source, "server/frontend/src"),
    },
    dedupe: ["vue"],
  },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [repo, source, root] } },
  logLevel: "error",
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [],
  captures = [];
try {
  for (const width of [1200, 390])
    for (const app of baseline ? ["desktop"] : ["desktop", "server"]) {
      const page = await browser.newPage({
        viewport: { width, height: 800 },
        timezoneId: "America/Chicago",
        hasTouch: true,
      });
      await page.clock.setFixedTime(new Date("2026-11-01T20:00:00Z"));
      page.on("pageerror", (error) => errors.push(error.message));
      for (const scene of [
        "activity",
        "tokens",
        "input",
        "output",
        "spend",
        "ratio",
        "speed",
        ...(app === "desktop" ? ["share"] : []),
        ...(app === "server" ? ["latency", "stacked"] : []),
      ]) {
        await page.goto(`${origin}/?app=${app}&scene=${scene}`);
        await page.locator(".capture-frame").waitFor();
        await page
          .locator('svg[role="img"],canvas[role="img"]')
          .first()
          .waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        if (!baseline) {
          assert.equal(
            await page.locator('canvas[role="img"]').count(),
            1,
            `${app}/${scene} must use Chart.js`,
          );
          const rendered = await page.evaluate(() => {
            const chart = window.captureChart();
            if (chart.config.type === "doughnut")
              return {
                width: chart.width,
                height: chart.height,
                datasets: [],
                area: chart.chartArea,
              };
            return {
              width: chart.width,
              height: chart.height,
              axis: { min: chart.scales.y.min, max: chart.scales.y.max },
              datasets: chart.data.datasets.map((set, index) => ({
                data: set.data,
                fill: set.fill,
                points: chart.getDatasetMeta(index).data.map((point) => ({
                  x: point.x,
                  y: point.y,
                  skip: point.skip,
                })),
                segments: chart
                  .getDatasetMeta(index)
                  .dataset?.segments.map((run) => ({
                    start: run.start,
                    end: run.end,
                  })),
              })),
              area: chart.chartArea,
            };
          });
          if (scene !== "share") assert.equal(rendered.height, 300);
          assert.ok(rendered.width <= width && rendered.width > 190);
          for (const set of rendered.datasets)
            for (const point of set.points)
              if (!point.skip) {
                assert.ok(
                  point.y >= rendered.area.top - 0.1 &&
                    point.y <= rendered.area.bottom + 0.1,
                  `${app}/${scene} clipped a point`,
                );
              }
          if (["speed", "ratio", "latency"].includes(scene))
            assert.ok(rendered.datasets.every((set) => set.fill === false));
          if (scene === "speed") {
            const missing = rendered.datasets.find(
              (set) => set.data[4] === null,
            );
            assert.ok(missing, "missing speed must remain null");
            assert.ok(
              missing.segments.every((run) => !(run.start < 4 && run.end > 4)),
              "missing speed must break the curve",
            );
            assert.equal(rendered.axis.max, 400);
            const canvas = page.locator("canvas");
            const bounds = await canvas.boundingBox();
            const point = rendered.datasets[0].points[4];
            await page.touchscreen.tap(bounds.x + point.x, bounds.y + point.y);
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
            assert.equal(
              await page.locator(".chart-tooltip li").count(),
              3,
              `${app}/${width} tap: ${await page.locator(".chart-stage").innerText()}`,
            );
            await page.mouse.move(bounds.x + point.x, bounds.y + point.y);
            await page.waitForFunction(
              () => document.querySelectorAll(".chart-tooltip li").length === 3,
            );
            const tooltip = await page.locator(".chart-tooltip").innerText();
            for (const rate of ["61.5", "59.9", "30.7"])
              assert.ok(tooltip.includes(rate), tooltip);
            assert.ok(
              !tooltip.includes("Unavailable") && !tooltip.includes("N/A"),
              tooltip,
            );
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
            await page.mouse.move(0, 0);
            await page.touchscreen.tap(
              bounds.x + bounds.width - 1,
              bounds.y + 45,
            );
            await page.waitForFunction(() =>
              document
                .querySelector(".tooltip-day")
                ?.textContent.includes("Nov 1"),
            );
            await canvas.focus();
            await page.keyboard.press("End");
            await page.keyboard.press("ArrowLeft");
            await page.keyboard.press("ArrowLeft");
            assert.equal(await page.locator(".chart-tooltip li").count(), 3);
            await page.keyboard.press("Escape");
            await canvas.evaluate((element) => element.blur());
            await page.mouse.move(0, 0);
          }
          if (scene === "speed" && width === 1200) {
            const canvas = page.locator("canvas");
            await canvas.evaluate(
              (element) => (element.style.maxWidth = "260px"),
            );
            const box = await canvas.boundingBox();
            await page.touchscreen.tap(box.x + box.width - 8, box.y + 40);
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
            assert.match(
              await page.locator(".tooltip-day").innerText(),
              /Nov 1/,
              "scaled canvas touch coordinates",
            );
            await canvas.evaluate((element) =>
              element.style.removeProperty("max-width"),
            );
            await canvas.press("Escape");
            await canvas.evaluate((element) => element.blur());
          }
          if (scene === "spend")
            assert.ok(
              rendered.datasets.every((set) => set.data[2] === 0),
              "measured zero cost must be retained",
            );
        }
        // The review artifacts are desktop only; the console gets runtime checks above.
        if (app === "desktop") {
          const file = `${app}-${scene}-${width}.png`;
          await page
            .locator(".capture-frame")
            .screenshot({ path: path.join(output, file) });
          captures.push({ app, scene, width, file });
          if (scene === "speed") {
            await page
              .locator('[aria-label^="2026-10-30 ·"][aria-label*="61.5"]')
              .evaluate((element) => element.focus());
            await page.locator(".chart-tooltip").waitFor();
            const file = `desktop-speed-tooltip-${width}.png`;
            await page
              .locator(".capture-frame")
              .screenshot({ path: path.join(output, file) });
            captures.push({ app, scene: "speed-tooltip", width, file });
            if (!baseline) {
              const box = await page.locator(".chart-tooltip").boundingBox();
              assert.ok(
                box.x >= 0 && box.x + box.width <= width,
                "tooltip must fit the viewport",
              );
            }
          }
        }
      }

      if (!baseline) {
        if (app === "desktop") {
          await page.goto(`${origin}/?app=desktop&scene=speed`);
          await page.locator("canvas").waitFor();
        }
        const before = await page.evaluate(() => window.captureChart().width);
        await page.setViewportSize({
          width: width === 1200 ? 500 : 700,
          height: 800,
        });
        await page.waitForFunction(
          (old) => window.captureChart().width !== old,
          before,
        );
        const oldColor = await page.evaluate(
          () => window.captureChart().options.plugins?.legend?.labels?.color,
        );
        await page.evaluate(() =>
          document.documentElement.classList.add("dark"),
        );
        if (app === "server")
          await page.waitForFunction(
            (old) =>
              window.captureChart().options.plugins.legend.labels.color !== old,
            oldColor,
          );
      }
      await page.close();
    }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "receipt.json"),
    JSON.stringify({ source, baseline, captures, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      output,
      captures: captures.length,
      errors: errors.length,
    }),
  );
} finally {
  await browser.close();
  await server.close();
  await rm(root, { recursive: true, force: true });
}
