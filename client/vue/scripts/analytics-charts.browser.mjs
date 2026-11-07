import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { chromium } from "playwright";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const repo = fileURLToPath(new URL("../../../", import.meta.url));
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
const reportMode = args.includes("--reports");
if (reportMode) {
  await writeFile(
    path.join(root, "entry.js"),
    `import {createApp} from 'vue';import {RouterView,createMemoryHistory} from 'vue-router';import {createConsoleRouter} from '${source}/server/frontend/src/router.ts';import {createConsoleSession} from '${source}/server/frontend/src/console-session.ts';import {reportFixture} from '${source}/server/frontend/src/__tests__/report-fixture.ts';import {Chart} from '${repo}node_modules/chart.js/dist/chart.js';import '${repo}node_modules/element-plus/es/components/button/style/css.mjs';import '${repo}node_modules/element-plus/es/components/input/style/css.mjs';import '${repo}node_modules/element-plus/es/components/date-picker/style/css.mjs';import '${repo}node_modules/element-plus/es/components/select/style/css.mjs';import '${repo}node_modules/element-plus/es/components/option/style/css.mjs';import '${repo}node_modules/element-plus/es/components/segmented/style/css.mjs';import '${repo}node_modules/element-plus/es/components/popover/style/css.mjs';import '${repo}node_modules/element-plus/es/components/tooltip/style/css.mjs';import '${source}/server/frontend/src/style.css';
 const query=new URLSearchParams(location.search);const page=query.get('scene')||'overview';
 globalThis.fetch=async input=>{const q=new URL(String(input),location.origin).searchParams;return Response.json(reportFixture(q.get('from')||undefined,q.get('to')||undefined));};
 const session=createConsoleSession();session.authenticate();const router=createConsoleRouter(session,createMemoryHistory());await router.push('/'+page);await router.isReady();createApp(RouterView).use(router).mount('#app');window.captureCharts=()=>[...document.querySelectorAll('canvas')].map(canvas=>Chart.getChart(canvas));`,
  );
} else {
  await writeFile(
    path.join(root, "entry.js"),
    `import {createApp} from 'vue';import {i18n} from '${source}/client/vue/src/i18n/index.ts';import App from '${repo}client/vue/scripts/fixtures/AnalyticsChartCapture.vue';import '${source}/server/frontend/src/style.css';createApp(App).use(i18n).mount('#app');`,
  );
}
const server = await createServer({
  root,
  configFile: false,
  plugins: [vue()],
  optimizeDeps: {
    noDiscovery: true,
    include: reportMode ? ["element-plus", "vue-router"] : [],
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
      "element-plus": path.join(repo, "node_modules/element-plus"),
      "vue-router": path.join(
        repo,
        "node_modules/vue-router/dist/vue-router.mjs",
      ),
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
  if (reportMode) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        hasTouch: true,
        timezoneId: "America/Chicago",
      });
      page.setDefaultTimeout(2_500);
      page.setDefaultNavigationTimeout(15_000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date("2026-11-01T20:00:00Z"));
      for (const scene of [
        "overview",
        "activity",
        "tokens",
        "spend",
        "models",
        "performance",
      ]) {
        await page.goto(`${origin}/?scene=${scene}`);
        await page
          .getByRole("heading", {
            name: scene[0].toUpperCase() + scene.slice(1),
            exact: true,
          })
          .waitFor({ timeout: 15_000 }); // Cold route/module startup.
        await page
          .getByText("Loading metrics…", { exact: true })
          .waitFor({ state: "hidden" });
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          scene + " overflow",
        );
        if (scene === "overview") {
          assert.equal(await page.locator("canvas").count(), 1);
          const sets = await page.evaluate(
            () => window.captureCharts()[0].data.datasets,
          );
          assert.equal(sets.length, 2);
          assert.ok(sets.every((row) => row.fill === false));
        }
        if (scene === "activity") {
          const paint = await page.evaluate(() =>
            window.captureCharts().map((c) => ({
              labels: c.data.datasets.map((row) => row.label),
              color: c.data.datasets[0].borderColor,
              gradient:
                c.getDatasetMeta(0).dataset.options.backgroundColor instanceof
                CanvasGradient,
              fill: c.data.datasets[0].fill,
            })),
          );
          assert.deepEqual(
            paint.map((chart) => chart.labels),
            [["Active installs"], ["Participating installs"]],
          );
          assert.ok(paint.every((chart) => chart.gradient && chart.fill));
          assert.notEqual(paint[0].color, paint[1].color);
        }
        if (scene === "models") {
          const control = page.getByRole("radiogroup", {
            name: "Model usage view",
          });
          assert.ok((await control.innerText()).includes("Trend"));
          assert.ok(
            await control.evaluate(
              (el) =>
                parseFloat(getComputedStyle(el).borderRadius) >=
                el.getBoundingClientRect().height / 2,
            ),
            "Model view control must retain its pill shape",
          );
          const labels = await control
            .locator(".el-segmented__item-label")
            .evaluateAll((rows) =>
              rows.map((el) => ({
                width: el.clientWidth,
                scroll: el.scrollWidth,
              })),
            );
          assert.ok(
            labels.every((row) => row.scroll <= row.width),
            "segmented labels clipped",
          );
        }
        if (scene === "performance") {
          const boxes = await page
            .locator(".performance-grid>.performance-ranking")
            .evaluateAll((rows) =>
              rows.map((el) => ({
                x: el.getBoundingClientRect().x,
                y: el.getBoundingClientRect().y,
              })),
            );
          assert.equal(boxes.length, 2);
          assert.equal(boxes[0].y === boxes[1].y, width === 1440);
        }
        const file = `console-${scene}-${width}.png`;
        await page.screenshot({
          path: path.join(output, file),
          fullPage: true,
        });
        captures.push({ app: "console", scene, width, file });
      }
      await page.close();
    }
  } else
    for (const width of [1200, 390])
      for (const app of baseline ? ["desktop"] : ["desktop", "server"]) {
        const page = await browser.newPage({
          viewport: { width, height: 800 },
          timezoneId: "America/Chicago",
          hasTouch: true,
        });
        page.setDefaultTimeout(2_500);
        page.setDefaultNavigationTimeout(15_000);
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
          "stacked",
          ...(app === "server" ? ["latency"] : []),
        ]) {
          await page.goto(`${origin}/?app=${app}&scene=${scene}`);
          await page.locator(".capture-frame").waitFor({ timeout: 15_000 }); // Cold route/module startup.
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
            if (app === "server") {
              const legendRows = await page
                .locator(".legend li")
                .evaluateAll((rows) =>
                  rows.map((row) => row.getBoundingClientRect().y),
                );
              assert.ok(
                new Set(legendRows).size <= 1,
                "Legend items must stay on one scrollable row",
              );
            }
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
                type: chart.config.type,
                stacked: chart.options.scales.y.stacked,
                axis: { min: chart.scales.y.min, max: chart.scales.y.max },
                datasets: chart.data.datasets.map((set, index) => ({
                  data: set.data,
                  fill: set.fill,
                  gradient:
                    (chart.getDatasetMeta(index).dataset?.options
                      .backgroundColor ??
                      chart.getDatasetMeta(index).data[0]?.options
                        .backgroundColor) instanceof CanvasGradient,
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
            if (scene === "stacked") {
              const emptyPixels = await page.evaluate(() => {
                const chart = window.captureChart(),
                  line = chart.getDatasetMeta(
                    chart.data.datasets.length - 1,
                  ).dataset,
                  ratio = chart.currentDevicePixelRatio,
                  baseline = chart.scales.y.getPixelForValue(0);
                let empty = 0;
                // Sample inside fully observed curved layers, away from outlines.
                for (
                  let x = chart.scales.x.getPixelForValue(0) + 4;
                  x < chart.scales.x.getPixelForValue(3) - 4;
                  x += 3
                ) {
                  const top = line.interpolate({ x }, "x").y;
                  for (let y = top + 4; y < baseline - 4; y += 3)
                    if (
                      chart.ctx.getImageData(
                        Math.round(x * ratio),
                        Math.round(y * ratio),
                        1,
                        1,
                      ).data[3] === 0
                    )
                      empty++;
                }
                return empty;
              });
              assert.equal(
                emptyPixels,
                0,
                `${app}: stacked curves must have no empty bands between layers`,
              );
              assert.equal(rendered.type, "line");
              assert.equal(rendered.stacked, true);
              assert.ok(
                rendered.datasets.every((set) => set.gradient),
                `${app}/${scene} must use shared quantity gradients`,
              );
              const fillSamples = await page.evaluate(() => {
                const chart = window.captureChart(),
                  sets = chart.data.datasets;
                const day = sets[0].data.findIndex(
                  (value, index) =>
                    (value === null || value === 0) &&
                    sets.some((row) => row.data[index] > 0),
                );
                const layer = sets.findIndex((row) => row.data[day] > 0);
                const x = chart.scales.x.getPixelForValue(day),
                  top = chart.getDatasetMeta(layer).data[day].y,
                  bottom = chart.scales.y.getPixelForValue(0),
                  ratio = chart.currentDevicePixelRatio;
                return [0.25, 0.5, 0.75].map(
                  (fraction) =>
                    chart.ctx.getImageData(
                      Math.round(x * ratio),
                      Math.round((top + (bottom - top) * fraction) * ratio),
                      1,
                      1,
                    ).data[3],
                );
              });
              assert.ok(
                fillSamples.filter((alpha) => alpha > 0).length >= 2,
                `${app}: a missing lower series must not punch a hole in the upper fill`,
              );
            }
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
                missing.segments.every(
                  (run) => !(run.start < 4 && run.end > 4),
                ),
                "missing speed must break the curve",
              );
              assert.equal(rendered.axis.max, 400);
              const canvas = page.locator("canvas");
              const bounds = await canvas.boundingBox();
              const point = rendered.datasets[0].points[4];
              await page.touchscreen.tap(
                bounds.x + point.x,
                bounds.y + point.y,
              );
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
                () =>
                  document.querySelectorAll(".chart-tooltip li").length === 3,
              );
              const tooltip = await page.locator(".chart-tooltip").innerText();
              if (app === "server") {
                const lines = await page
                  .locator(".tooltip-name")
                  .evaluateAll((labels) =>
                    labels.map((label) => {
                      const range = document.createRange();
                      range.selectNodeContents(label);
                      return range.getClientRects().length;
                    }),
                  );
                assert.ok(
                  lines.every((count) => count === 1),
                  "Tooltip labels must stay on one line",
                );
              }
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
          if (!baseline && scene === "stacked")
            await page.locator(".capture-frame").screenshot({
              path: path.join(output, `${app}-stacked-${width}.png`),
            });
          if (app === "desktop" && scene !== "stacked") {
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
                window.captureChart().options.plugins.legend.labels.color !==
                old,
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
