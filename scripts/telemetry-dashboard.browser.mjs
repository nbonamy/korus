import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Real built console → authenticated nginx → read service → seeded Postgres.
// Protects arithmetic/render drift, private access, filter scope, missing-data
// interpolation, horizontal overflow and unexpected browser network dependencies.
export async function dashboardWorkflow({
  port,
  password,
  seed,
  sql,
  desktopProfile,
  replaceProfile,
}) {
  const output =
    process.env.TELEMETRY_DASHBOARD_EVIDENCE ||
    (await mkdtemp(path.join(os.tmpdir(), "telemetry-dashboard-")));
  await mkdir(output, { recursive: true });
  const origin = `http://console.invalid:${port}`;
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-proxy-server",
      "--host-resolver-rules=MAP console.invalid 127.0.0.1",
    ],
  });
  try {
    const signedOut = await browser.newContext();
    const denied = await signedOut.request.get(
      `http://127.0.0.1:${port}/v1/telemetry/metrics?from=2026-10-18&to=2026-10-24`,
      { headers: { Host: "console.invalid" } },
    );
    assert.equal(denied.status(), 401);
    assert.equal(
      (await denied.text()).includes("participatingInstalls"),
      false,
    );
    await signedOut.close();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      httpCredentials: { username: "viewer", password },
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date() });
    const errors = [],
      external = [],
      aggregateBodies = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    page.on("response", async (response) => {
      if (
        response.url().includes("/v1/telemetry/metrics") &&
        response.status() === 200
      )
        aggregateBodies.push(await response.text());
    });
    await page.goto(origin);
    await page.getByRole("region", { name: "Global activity" }).waitFor();
    async function range(from, to) {
      await page.getByLabel("From UTC day", { exact: true }).fill(from);
      await page.getByLabel("To UTC day", { exact: true }).fill(to);
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes(`from=${from}&to=${to}`) && r.status() === 200,
        ),
        page.getByRole("button", { name: "Apply range", exact: true }).click(),
      ]);
      await page.getByRole("region", { name: "Global activity" }).waitFor();
    }
    if (desktopProfile) {
      await range(desktopProfile.reportDay, desktopProfile.emptyDay);
      await page
        .getByLabel("Measured total tokens", { exact: true })
        .getByText("120", { exact: true })
        .waitFor();
      await page
        .getByLabel("Participating installs", { exact: true })
        .getByText("1", { exact: true })
        .waitFor();
      await page
        .getByLabel("Daily active installs", { exact: true })
        .getByText("1", { exact: true })
        .waitFor();
      await page.screenshot({
        path: path.join(output, "desktop-profile.png"),
        fullPage: true,
      });
      await replaceProfile();
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes("/v1/telemetry/metrics") && r.status() === 200,
        ),
        page.getByRole("button", { name: "Refresh metrics" }).click(),
      ]);
      await page
        .getByLabel("Measured total tokens", { exact: true })
        .getByText("70", { exact: true })
        .waitFor();
      await page
        .getByLabel("Participating installs", { exact: true })
        .getByText("1", { exact: true })
        .waitFor();
      const table = await page
        .getByRole("region", { name: "Provider and model", exact: true })
        .innerText();
      assert.equal(table.includes("codex"), false);
      assert.equal(table.includes("claude"), true);
      await page.screenshot({
        path: path.join(output, "desktop-profile-corrected.png"),
        fullPage: true,
      });
    }
    await sql("TRUNCATE usage_daily,install_days,installs");
    await sql(seed);
    await page.clock.setFixedTime(new Date("2026-10-25T12:00:00Z"));
    await range("2026-10-18", "2026-10-24");
    for (const [label, value] of [
      ["Participating installs", "6"],
      ["Daily active installs", "3"],
      ["Weekly active installs", "4"],
      ["Monthly active installs", "5"],
      ["Turns", "7"],
      ["Measured total tokens", "660"],
      ["Known estimated spend", "$1.5"],
      ["Measured cache-read share", "55%"],
    ])
      assert.equal(
        (await page.getByLabel(label, { exact: true }).innerText()).includes(
          value,
        ),
        true,
        label,
      );
    const global = await page
      .getByRole("region", { name: "Global activity" })
      .innerText();
    assert.match(
      await page
        .getByLabel("Known estimated spend", { exact: true })
        .innerText(),
      /2 unknown/,
    );
    const cost = page.getByRole("region", {
      name: "Daily estimated spend",
      exact: true,
    });
    const gapHasPaint = await cost.getByRole("img").evaluate((svg) => {
      const labels = [...svg.querySelectorAll(".date-label text")];
      const first = Number(labels[0].getAttribute("x"));
      const last = Number(labels.at(-1).getAttribute("x"));
      // Probe the unmeasured interior days; both the line and its area must be absent.
      const paths = [...svg.querySelectorAll("path")];
      return [2.5, 3.5, 4.5].some((day) => {
        const x = first + ((last - first) * day) / 6;
        for (let y = 0; y < svg.viewBox.baseVal.height; y += 0.5) {
          const point = new DOMPoint(x, y);
          if (
            paths.some(
              (p) =>
                (getComputedStyle(p).fill !== "none" &&
                  p.isPointInFill(point)) ||
                p.isPointInStroke(point),
            )
          )
            return true;
        }
        return false;
      });
    });
    assert.equal(
      gapHasPaint,
      false,
      "unmeasured spend dates must contain no curve or area",
    );
    assert.equal(
      await cost.locator("circle").count(),
      0,
      "no persistent point markers",
    );
    await cost.getByRole("img").focus();
    await page.keyboard.press("End");
    assert.match(
      await cost.getByRole("status").innerText(),
      /2026-10-24.*\$0.*partial/is,
    );
    await page.keyboard.press("ArrowLeft");
    assert.match(
      await cost.getByRole("status").innerText(),
      /2026-10-23.*Unavailable/is,
    );
    const weekly = page.getByRole("region", {
      name: "Weekly tokens",
      exact: true,
    });
    await weekly.getByText("View data", { exact: true }).click();
    assert.match(
      await weekly.getByRole("table").innerText(),
      /2026-10-12[\s\S]*110[\s\S]*2026-10-19[\s\S]*550/,
    );
    const chartBounds = await page
      .locator("path.chart-line")
      .evaluateAll((paths) =>
        paths.map((p) => {
          const box = p.getBBox();
          const grid = [
            ...p.ownerSVGElement.querySelectorAll(".grid line"),
          ].map((line) => Number(line.getAttribute("y1")));
          return {
            plotTop: Math.min(...grid),
            plotBottom: Math.max(...grid),
            top: box.y,
            bottom: box.y + box.height,
            stroke: getComputedStyle(p).strokeWidth,
          };
        }),
      );
    assert.equal(
      chartBounds.every(
        (b) =>
          b.top >= b.plotTop - 0.01 &&
          b.bottom <= b.plotBottom + 0.01 &&
          b.stroke === "1.5px",
      ),
      true,
    );
    const models = page.getByRole("region", {
      name: "Provider and model",
      exact: true,
    });
    assert.match(await models.innerText(), /claude-sonnet-4-6/);
    await page.screenshot({
      path: path.join(output, "desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("provider=codex") && r.status() === 200,
      ),
      page.getByLabel("Provider", { exact: true }).selectOption("codex"),
    ]);
    await page
      .getByLabel("Measured total tokens", { exact: true })
      .getByText("440", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("region", { name: "Global activity" }).innerText(),
      global,
    );
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("model=claude-sonnet-4-6") && r.status() === 200,
      ),
      page
        .getByLabel("Model", { exact: true })
        .selectOption("claude-sonnet-4-6"),
    ]);
    await page
      .getByText("No usage for this selection.", { exact: true })
      .waitFor();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("provider=claude") && r.status() === 200,
      ),
      page.getByLabel("Provider", { exact: true }).selectOption("claude"),
    ]);
    await page
      .getByLabel("Measured total tokens", { exact: true })
      .getByText("220", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("region", { name: "Global activity" }).innerText(),
      global,
    );
    await Promise.all([
      page.waitForResponse(
        (r) =>
          !r.url().includes("model=") &&
          r.url().includes("/metrics") &&
          r.status() === 200,
      ),
      page.getByLabel("Model", { exact: true }).selectOption(""),
    ]);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("provider=antigravity") && r.status() === 200,
      ),
      page.getByLabel("Provider", { exact: true }).selectOption("antigravity"),
    ]);
    await page
      .getByLabel("Measured cache-read share", { exact: true })
      .getByText("Unavailable", { exact: true })
      .waitFor();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          !r.url().includes("provider=") &&
          r.url().includes("/metrics") &&
          r.status() === 200,
      ),
      page.getByLabel("Provider", { exact: true }).selectOption(""),
    ]);
    await range("2020-01-01", "2020-01-01");
    assert.match(
      await page
        .getByLabel("Measured total tokens", { exact: true })
        .innerText(),
      /1,100/,
    );
    await range("2026-10-18", "2026-10-24");
    // A complete replacement changes usage totals, never install/activity cards.
    await sql(
      "DELETE FROM usage_daily WHERE install_id='00000000-0000-4000-8000-000000000001' AND day='2026-10-24'",
    );
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/metrics") && r.status() === 200,
      ),
      page.getByLabel("Refresh metrics").click(),
    ]);
    await page
      .getByLabel("Measured total tokens", { exact: true })
      .getByText("330", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("region", { name: "Global activity" }).innerText(),
      global,
    );
    await sql("TRUNCATE usage_daily,install_days,installs");
    await sql(seed);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/metrics") && r.status() === 200,
      ),
      page.getByLabel("Refresh metrics").click(),
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByLabel("Measured total tokens", { exact: true })
      .getByText("660", { exact: true })
      .waitFor();
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      charts: [...document.querySelectorAll("svg")].map((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
    }));
    assert.equal(
      geometry.page <= geometry.viewport,
      true,
      JSON.stringify(geometry),
    );
    assert.equal(
      geometry.charts.every(
        (c) => c.width >= 260 && c.width <= 390 && c.height >= 200,
      ),
      true,
    );
    const mobileChart = page
      .getByRole("region", { name: "Daily activity", exact: true })
      .getByRole("img");
    await mobileChart.scrollIntoViewIfNeeded();
    const mobileBox = await mobileChart.boundingBox();
    await page.touchscreen.tap(
      mobileBox.x + mobileBox.width - 18,
      mobileBox.y + 45,
    );
    assert.match(
      await page
        .getByRole("region", { name: "Daily activity", exact: true })
        .getByRole("status")
        .innerText(),
      /2026-10-24/,
    );
    await page.screenshot({
      path: path.join(output, "mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await range("2026-10-20", "2026-10-20");
    await page
      .getByText("No usage for this selection.", { exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "empty.png"),
      fullPage: true,
      animations: "disabled",
    });
    // Failure injection only after the complete real end-to-end path above.
    let release;
    await page.route("**/v1/telemetry/metrics?**", async (route) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 503, body: "PRIVATE SQL DIAGNOSTIC" });
    });
    await page.getByLabel("Refresh metrics").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Loading metrics…" })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "loading.png"),
      fullPage: true,
      animations: "disabled",
    });
    release();
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /unavailable/);
    assert.equal(
      (await page.locator("body").innerText()).includes("PRIVATE SQL"),
      false,
    );
    await page.screenshot({
      path: path.join(output, "failure.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.unroute("**/v1/telemetry/metrics?**");
    await page.route("**/v1/telemetry/metrics?**", (route) =>
      route.fulfill({ status: 401, body: "unauthorized" }),
    );
    await page.getByLabel("Refresh metrics").click();
    await page
      .getByRole("alert")
      .filter({ hasText: /Private access/ })
      .waitFor();
    assert.equal(
      await page.getByLabel("Participating installs", { exact: true }).count(),
      0,
    );
    await page.screenshot({
      path: path.join(output, "access-required.png"),
      fullPage: true,
      animations: "disabled",
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.equal(aggregateBodies.length > 5, true);
    assert.equal(
      aggregateBodies.some((b) =>
        /00000000|installId|install_id|SENTINEL_OPERATOR/.test(b),
      ),
      false,
    );
    if (desktopProfile) {
      const installation = JSON.parse(
        desktopProfile.attempts[0].body,
      ).installId;
      assert.equal(
        aggregateBodies.some((body) => body.includes(installation)),
        false,
      );
    }
    await writeFile(
      path.join(output, "evidence.json"),
      JSON.stringify(
        {
          desktopProfile: desktopProfile
            ? {
                participatingInstalls: 1,
                activeDays: 2,
                tokensBeforeCorrection: 120,
                tokensAfterReplacement: 70,
                removedProvider: "codex",
                replacementProvider: "claude",
              }
            : null,
          cards: { participating: 6, dau: 3, wau: 4, mau: 5 },
          tokens: 660,
          knownCostUsd: 1.5,
          unknownCostGroups: 2,
          cacheReadShare: 0.55,
          oldHistoryTokens: 1100,
          correctedTokens: 330,
          geometry,
          chartBounds,
          externalRequests: external,
          pageErrors: errors,
          aggregateResponses: aggregateBodies.map(JSON.parse),
        },
        null,
        2,
      ),
    );
    await context.close();
  } finally {
    await browser.close();
  }
  return output;
}
