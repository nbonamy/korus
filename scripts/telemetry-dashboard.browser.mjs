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
    async function visit(name) {
      await page
        .getByRole("navigation", { name: "Analytics sections" })
        .getByRole("link", { name, exact: true })
        .click();
      await page
        .getByRole("heading", { level: 1, name, exact: true })
        .waitFor();
    }
    // Reports are separate, addressable pages; changing page preserves the range.
    const initialFrom = await page
      .getByLabel("From UTC day", { exact: true })
      .inputValue();
    await visit("Tokens");
    await page
      .getByRole("region", { name: "Weekly tokens", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("region", { name: "Daily activity", exact: true })
        .count(),
      0,
    );
    await visit("Models");
    await page
      .getByRole("region", { name: "Provider and model", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("region", { name: "Weekly tokens", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByLabel("From UTC day", { exact: true }).inputValue(),
      initialFrom,
    );
    await page.goBack();
    await page
      .getByRole("heading", { level: 1, name: "Tokens", exact: true })
      .waitFor();
    await page.goForward();
    await page
      .getByRole("heading", { level: 1, name: "Models", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("heading", { level: 1, name: "Models", exact: true })
      .waitFor();
    await visit("Overview");
    const providerLabels = {
      "": "All providers",
      codex: "Codex",
      claude: "Claude",
      antigravity: "Antigravity",
    };
    async function select(label, value) {
      await page
        .getByRole("combobox", { name: label, exact: true })
        .press("ArrowDown");
      const name =
        label === "Provider" ? providerLabels[value] : value || "All models";
      await page.getByRole("option", { name, exact: true }).click();
    }
    async function range(from, to) {
      await page.getByLabel("From UTC day", { exact: true }).fill(from);
      await page.getByLabel("To UTC day", { exact: true }).fill(to);
      await page.getByLabel("To UTC day", { exact: true }).press("Tab");
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
      await visit("Performance");
      assert.match(
        await page.getByLabel("Output speed summary").innerText(),
        /20.0 tok\/s/,
      );
      assert.match(
        await page.getByLabel("Time to first output summary").innerText(),
        /0.3 s/,
      );
      await visit("Overview");
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
      await visit("Models");
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
    await visit("Overview");
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
      ["Known estimated spend", "$1.50"],
      ["Measured cache-read share", "55.0%"],
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
    assert.equal(await cost.locator("rect").count(), 3);
    const gapHasPaint = await cost.getByRole("img").evaluate((svg) => {
      const labels = [...svg.querySelectorAll(".date-label text")];
      const first = Number(labels[0].getAttribute("x"));
      const last = Number(labels.at(-1).getAttribute("x"));
      // Probe the unmeasured interior days; both the line and its area must be absent.
      const paths = [...svg.querySelectorAll("path,rect")];
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
      /Oct 24.*\$0.*partial/is,
    );
    await page.keyboard.press("ArrowLeft");
    assert.match(
      await cost.getByRole("status").innerText(),
      /Oct 23.*Unavailable/is,
    );
    const weekly = page.getByRole("region", {
      name: "Weekly tokens",
      exact: true,
    });
    await weekly.getByRole("img").focus();
    await page.keyboard.press("Home");
    assert.equal(
      await weekly.locator(".tooltip-day").getAttribute("title"),
      "2026-10-12 UTC",
    );
    assert.equal(await weekly.locator(".tooltip-total b").innerText(), "110");
    await page.keyboard.press("End");
    assert.equal(
      await weekly.locator(".tooltip-day").getAttribute("title"),
      "2026-10-19 UTC",
    );
    assert.equal(await weekly.locator(".tooltip-total b").innerText(), "550");
    assert.equal(await page.getByText("View data", { exact: true }).count(), 0);
    assert.equal(
      await page.getByText("About the data", { exact: true }).count(),
      0,
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
    await visit("Models");
    assert.match(await models.innerText(), /claude-sonnet-4-6/);
    await visit("Overview");
    await page.screenshot({
      path: path.join(output, "desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("provider=codex") && r.status() === 200,
      ),
      select("Provider", "codex"),
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
      select("Model", "claude-sonnet-4-6"),
    ]);
    await page
      .getByText("No usage for this selection.", { exact: true })
      .waitFor();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("provider=claude") && r.status() === 200,
      ),
      select("Provider", "claude"),
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
      select("Model", ""),
    ]);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("provider=antigravity") && r.status() === 200,
      ),
      select("Provider", "antigravity"),
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
      select("Provider", ""),
    ]);
    await range("2020-01-01", "2020-01-01");
    assert.match(
      await page
        .getByLabel("Measured total tokens", { exact: true })
        .innerText(),
      /1.1K/,
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
      charts: [...document.querySelectorAll('svg[role="img"]')].map((el) => ({
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
      /Oct 24/,
    );
    await page.screenshot({
      path: path.join(output, "mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await sql(
      "UPDATE usage_daily SET speed_turns=2,speed_output_tokens=30,generation_ms=1000,ttft_ms=1000,ttft_turns=2 WHERE provider='codex' AND day='2026-10-24'",
    );
    await page.getByLabel("Refresh metrics").click();
    await page.getByLabel("Measured total tokens", { exact: true }).waitFor();
    await visit("Performance");
    assert.match(
      await page.getByLabel("Output speed summary").innerText(),
      /30.0 tok\/s/,
    );
    assert.match(
      await page.getByLabel("Time to first output summary").innerText(),
      /0.5 s/,
    );
    assert.match(
      await page
        .getByRole("region", { name: "Performance by model", exact: true })
        .innerText(),
      /Unavailable/,
    );
    const speedChart = page.getByRole("region", {
      name: "Output speed",
      exact: true,
    });
    assert.match(
      await speedChart.getByRole("list", { name: "Series" }).innerText(),
      /Codex/,
    );
    await speedChart.getByRole("img").focus();
    await page.keyboard.press("End");
    assert.match(
      await speedChart.getByRole("status").innerText(),
      /30.0 tok\/s/,
    );
    assert.equal(
      (await speedChart.locator('path[fill^="url("]').count()) > 0,
      true,
    );
    await page.screenshot({
      path: path.join(output, "performance.png"),
      fullPage: true,
      animations: "disabled",
    });
    await visit("Overview");
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
