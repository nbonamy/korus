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
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
  });
  try {
    const signedOut = await browser.newContext();
    const denied = await signedOut.request.get(
      `http://127.0.0.1:${port}/v1/telemetry/metrics?from=2026-10-18&to=2026-10-24`,
    );
    assert.equal(denied.status(), 401);
    assert.equal(
      (await denied.text()).includes("participatingInstalls"),
      false,
    );
    assert.equal(denied.headers()["www-authenticate"], undefined);
    const protectedHtml = await signedOut.request.get(origin, {
      maxRedirects: 0,
    });
    assert.equal(protectedHtml.status(), 302);
    assert.equal(
      new URL(protectedHtml.headers().location, origin).pathname,
      "/login",
    );
    const protectedReport = await signedOut.request.get(origin + "/models", {
      maxRedirects: 0,
    });
    assert.equal(protectedReport.status(), 302);
    assert.equal(
      new URL(protectedReport.headers().location, origin).searchParams.get(
        "redirect",
      ),
      "/models",
    );
    await signedOut.close();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      timezoneId: "UTC",
    });
    const page = await context.newPage();
    // Fix calendar dates while keeping canvas animation frames and resize timers real.
    await page.clock.setFixedTime(new Date());
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
    const responseReads = [];
    page.on("response", (response) => {
      if (
        response.url().includes("/v1/telemetry/metrics") &&
        response.status() === 200
      )
        responseReads.push(
          response.text().then((body) => {
            aggregateBodies.push(body);
          }),
        );
    });
    async function finishMetricsRead() {
      await page
        .getByText("Loading metrics…", { exact: true })
        .waitFor({ state: "hidden" });
      await Promise.all(responseReads);
    }
    await page.goto(origin);
    await page
      .getByRole("heading", { level: 1, name: "Sign in", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Username", { exact: true }).inputValue(),
      "admin",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const signInFields = await page
      .locator(".sign-in-panel input")
      .evaluateAll((fields) =>
        fields.map((field) => ({
          fontSize: Number.parseFloat(getComputedStyle(field).fontSize),
          width: field.getBoundingClientRect().width,
        })),
      );
    assert.ok(
      signInFields.length >= 2 &&
        signInFields.every((field) => field.fontSize >= 16),
      `Sign-in inputs must not trigger iOS focus zoom: ${JSON.stringify(signInFields)}`,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page
      .getByLabel("Password", { exact: true })
      .fill("incorrect-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("alert")
      .getByText("Incorrect username or password.", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Password", { exact: true }).inputValue(),
      "",
    );
    await page.screenshot({
      path: path.join(output, "sign-in.png"),
      fullPage: true,
      animations: "disabled",
    });
    async function signIn() {
      await page.getByLabel("Password", { exact: true }).fill(password);
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().endsWith("/auth/session") &&
            r.request().method() === "POST" &&
            r.status() === 204,
        ),
        page.getByRole("button", { name: "Sign in", exact: true }).click(),
      ]);
      await page.getByLabel("Refresh metrics", { exact: true }).waitFor();
    }
    await signIn();
    await page.getByRole("region", { name: "Weekly overview" }).waitFor();
    await page.addInitScript(() => {
      window.__loginFormRendered = false;
      new MutationObserver(() => {
        if (document.querySelector('form[aria-label="Console sign in"]'))
          window.__loginFormRendered = true;
      }).observe(document, { subtree: true, childList: true });
    });
    let sessionGate = Promise.resolve();
    await page.route("**/auth/session", async (route) => {
      if (route.request().method() === "GET") await sessionGate;
      await route.continue();
    });
    async function checkPendingSession(navigate) {
      let release;
      sessionGate = new Promise((resolve) => {
        release = resolve;
      });
      try {
        await navigate();
        await page
          .getByRole("status", { name: "Loading console", exact: true })
          .waitFor();
        assert.equal(
          await page.evaluate(() => window.__loginFormRendered),
          false,
        );
      } finally {
        release();
        sessionGate = Promise.resolve();
      }
    }
    await finishMetricsRead();
    for (const target of [
      "/overview",
      "/login?redirect=/overview",
      "/#/tokens",
      "/models",
    ]) {
      await checkPendingSession(() => page.goto(origin + target));
      await page
        .getByRole("heading", {
          level: 1,
          name:
            target === "/models"
              ? "Models"
              : target === "/#/tokens"
                ? "Tokens"
                : "Overview",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.__loginFormRendered),
        false,
      );
      await finishMetricsRead();
    }
    await checkPendingSession(() => page.reload());
    await page
      .getByRole("heading", { level: 1, name: "Models", exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => window.__loginFormRendered), false);
    await finishMetricsRead();
    await page.screenshot({
      path: path.join(output, "authenticated-reload.png"),
      fullPage: true,
    });
    await page.goto(origin + "/overview");
    await page
      .getByRole("heading", { level: 1, name: "Overview", exact: true })
      .waitFor();

    const sessionCookie = (await context.cookies()).find(
      (cookie) => cookie.httpOnly,
    );
    assert.ok(sessionCookie);
    assert.equal(sessionCookie.sameSite, "Strict");
    assert.equal(await page.evaluate(() => document.cookie), "");
    assert.equal(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
      0,
    );
    async function visit(name) {
      const menu = page.getByRole("button", {
        name: "Toggle navigation",
        exact: true,
      });
      if (
        (await menu.isVisible()) &&
        (await menu.getAttribute("aria-expanded")) === "false"
      )
        await menu.click();
      await page
        .getByRole("navigation", { name: "Analytics sections" })
        .getByRole("link", { name, exact: true })
        .click();
      await page
        .getByRole("heading", { level: 1, name, exact: true })
        .waitFor();
      await finishMetricsRead();
    }
    await visit("Performance");
    assert.equal(
      await page.getByLabel("Compare models", { exact: true }).count(),
      0,
    );
    await visit("Overview");
    assert.equal(await page.getByLabel("From day", { exact: true }).count(), 0);
    assert.equal(await page.locator(".weekly-card").count(), 4);
    await visit("Tokens");
    // Detail pages preserve the selected range.
    const initialFrom = await page
      .getByLabel("From day", { exact: true })
      .inputValue();
    await visit("Tokens");
    await page
      .getByRole("region", { name: "Total tokens", exact: true })
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
        .getByRole("region", { name: "Total tokens", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.getByLabel("From day", { exact: true }).inputValue(),
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
    await visit("Tokens");
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
        label === "Provider"
          ? providerLabels[value]
          : value === "unknown"
            ? "Unknown model"
            : value || "All models";
      await page.getByRole("option", { name, exact: true }).click();
    }
    async function range(from, to) {
      if (!(await page.getByLabel("From day", { exact: true }).isVisible()))
        await page
          .getByRole("button", { name: "Toggle filters", exact: true })
          .click();
      await page.getByLabel("From day", { exact: true }).fill(from);
      await page.getByLabel("To day", { exact: true }).fill(to);
      await page.getByLabel("To day", { exact: true }).press("Tab");
      await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes(`from=${from}&to=${to}`) && r.status() === 200,
        ),
        page.getByRole("button", { name: "Apply range", exact: true }).click(),
      ]);
      await finishMetricsRead();
    }
    async function summary(label) {
      return (await page.getByLabel(label).innerText()).replace(/\s+/g, " ");
    }
    async function globalActivity() {
      await visit("Activity");
      await finishMetricsRead();
      const text = await page
        .getByRole("region", { name: "Global activity" })
        .innerText();
      await visit("Tokens");
      await finishMetricsRead();
      return text;
    }
    if (desktopProfile) {
      await range(desktopProfile.reportDay, desktopProfile.emptyDay);
      await page
        .getByLabel("Measured total tokens", { exact: true })
        .getByText("120", { exact: true })
        .waitFor();
      await visit("Activity");
      await finishMetricsRead();
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
      assert.match(await summary("Output speed summary"), /20 tokens\/s/);
      assert.match(await summary("Time to first output summary"), /0.3 s/);
      await visit("Tokens");
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
      await visit("Activity");
      await finishMetricsRead();
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
    await visit("Tokens");
    await sql("TRUNCATE usage_daily,install_days,installs");
    await sql(seed);
    await page.clock.setFixedTime(new Date("2026-10-25T12:00:00Z"));
    await range("2026-10-18", "2026-10-24");
    await page
      .getByRole("combobox", { name: "Model", exact: true })
      .press("ArrowDown");
    assert.deepEqual(
      await page
        .getByRole("listbox", { name: "Model", exact: true })
        .getByRole("option")
        .allTextContents(),
      ["All models", "claude-sonnet-4-6", "Unknown model"],
    );
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("model=unknown") && r.status() === 200,
      ),
      page.getByRole("option", { name: "Unknown model", exact: true }).click(),
    ]);
    await page
      .getByRole("combobox", { name: "Model", exact: true })
      .press("ArrowDown");
    await page
      .getByRole("option", { name: "claude-sonnet-4-6", exact: true })
      .waitFor();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/v1/telemetry/metrics?") &&
          !new URL(r.url()).searchParams.has("model") &&
          r.status() === 200,
      ),
      page.getByRole("option", { name: "All models", exact: true }).click(),
    ]);
    for (const [label, value] of [
      ["Measured total tokens", "700"],
      ["Measured cache-read share", "55.0%"],
    ])
      assert.ok(
        (await page.getByLabel(label, { exact: true }).innerText()).includes(
          value,
        ),
        label,
      );
    const aggregate = await (
      await context.request.get(
        origin +
          "/v1/telemetry/metrics?from=2026-10-18&to=2026-10-24&timeZone=UTC",
      )
    ).json();
    assert.equal(aggregate.totals.turns, "7");
    assert.deepEqual(aggregate.weeklyTopUsers, [
      {
        rank: 1,
        turns: "7",
        totalTokens: "700",
        estimatedCostUsd: "1.5",
        turnShare: "1",
      },
    ]);
    await visit("Activity");
    await finishMetricsRead();
    for (const [label, value] of [
      ["Participating installs", "6"],
      ["Daily active installs", "3"],
      ["Weekly active installs", "4"],
      ["Monthly active installs", "5"],
    ])
      assert.ok(
        (await page.getByLabel(label, { exact: true }).innerText()).includes(
          value,
        ),
        label,
      );
    const global = await globalActivity();
    await visit("Spend");
    await finishMetricsRead();
    assert.match(
      await page
        .getByLabel("Known estimated spend", { exact: true })
        .innerText(),
      /^Estimated spend\s+\$1\.50$/,
    );
    const cost = page.getByRole("region", {
      name: "Daily estimated spend",
      exact: true,
    });
    assert.equal(await cost.locator("canvas").count(), 1);
    // Known zeroes remain inspectable; missing dates have no observations.
    assert.equal(await cost.locator(".chart-observation").count(), 3);
    await cost.getByRole("img").focus();
    await page.keyboard.press("End");
    assert.match(await cost.getByRole("status").innerText(), /Oct 24.*\$0/is);
    await page.keyboard.press("ArrowLeft");
    assert.match(
      await cost.getByRole("status").innerText(),
      /Oct 23.*Unavailable/is,
    );
    await visit("Tokens");
    await finishMetricsRead();
    const weekly = page.getByRole("region", {
      name: "Total tokens",
      exact: true,
    });
    await weekly.getByRole("img").focus();
    await page.keyboard.press("Home");
    assert.equal(
      await weekly.locator(".tooltip-day").getAttribute("title"),
      "2026-10-18",
    );
    assert.equal(await weekly.locator(".tooltip-total b").innerText(), "110");
    await page.keyboard.press("End");
    assert.equal(
      await weekly.locator(".tooltip-day").getAttribute("title"),
      "2026-10-24",
    );
    assert.equal(await weekly.locator(".tooltip-total b").innerText(), "370");
    assert.equal(await page.getByText("View data", { exact: true }).count(), 0);
    assert.equal(
      await page.getByText("About the data", { exact: true }).count(),
      0,
    );
    const chartBounds = await page
      .locator('canvas[role="img"]')
      .evaluateAll((charts) =>
        charts.map((chart) => ({
          width: chart.getBoundingClientRect().width,
          height: chart.getBoundingClientRect().height,
        })),
      );
    assert.ok(chartBounds.length > 0);
    assert.ok(
      chartBounds.every((chart) => chart.width > 0 && chart.height === 300),
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
    for (const name of [
      "Activity",
      "Models",
      "Tokens",
      "Spend",
      "Performance",
    ]) {
      await visit(name);
      assert.equal(
        /turns? missing usage|partial estimate|^partial$/im.test(
          await page.locator("main").innerText(),
        ),
        false,
      );
      await page.screenshot({
        path: path.join(output, `${name.toLowerCase()}-report.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await visit("Tokens");
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
    assert.equal(await globalActivity(), global);
    const modelControl = page.getByRole("combobox", {
      name: "Model",
      exact: true,
    });
    await modelControl.press("ArrowDown");
    assert.deepEqual(
      await page
        .getByRole("listbox", { name: "Model", exact: true })
        .getByRole("option")
        .allTextContents(),
      ["All models", "Unknown model"],
    );
    await modelControl.press("Escape");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("provider=claude") && r.status() === 200,
      ),
      select("Provider", "claude"),
    ]);
    await page
      .getByLabel("Measured total tokens", { exact: true })
      .getByText("260", { exact: true })
      .waitFor();
    assert.equal(await globalActivity(), global);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("model=claude-sonnet-4-6") && r.status() === 200,
      ),
      select("Model", "claude-sonnet-4-6"),
    ]);
    await page
      .getByLabel("Measured total tokens", { exact: true })
      .getByText("220", { exact: true })
      .waitFor();
    // This Claude model has no Codex usage: changing provider clears it and refetches.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("provider=codex") &&
          !new URL(r.url()).searchParams.has("model") &&
          r.status() === 200,
      ),
      select("Provider", "codex"),
    ]);
    await page
      .getByLabel("Measured total tokens", { exact: true })
      .getByText("440", { exact: true })
      .waitFor();
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
    assert.equal(await globalActivity(), global);
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
      .getByText("700", { exact: true })
      .waitFor();
    const navigationToggle = page.getByRole("button", {
      name: "Toggle navigation",
      exact: true,
    });
    assert.equal(await navigationToggle.count(), 1);
    await visit("Overview");
    assert.equal(await navigationToggle.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page
        .getByRole("navigation", { name: "Analytics sections" })
        .isVisible(),
      false,
    );
    const overviewBottom = await page
      .locator(".weekly-cards")
      .evaluate((el) => el.getBoundingClientRect().bottom);
    assert.ok(
      overviewBottom < 460,
      `Overview tiles push charts too far down: ${overviewBottom}`,
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await visit("Overview");
      assert.ok(
        await page.locator(".top-users tbody td").evaluateAll((cells) =>
          cells.every((el) => {
            const r = el.getBoundingClientRect();
            return r.right <= innerWidth && r.left >= 0;
          }),
        ),
        "Leaderboard values clipped on phone",
      );
      for (const name of [
        "Models",
        "Tokens",
        "Spend",
        "Performance",
        "Activity",
      ]) {
        await visit(name);
        const filtersToggle = page.getByRole("button", {
          name: "Toggle filters",
          exact: true,
        });
        assert.equal(
          await filtersToggle.getAttribute("aria-expanded"),
          "false",
        );
        for (const shortcut of ["7d", "30d", "90d"])
          assert.equal(
            await page.getByLabel("Recent ranges", { exact: true }).getByText(shortcut, { exact: true }).isVisible(),
            true,
            `${name}: ${shortcut} hidden behind filters`,
          );
        assert.equal(
          await page.getByLabel("From day", { exact: true }).isVisible(),
          false,
        );
        const layout = await page.evaluate(() => ({
          viewport: innerWidth,
          width: document.documentElement.scrollWidth,
          controls: [
            ...document.querySelectorAll(
              ".popularity > .panel-heading .el-segmented",
            ),
          ]
            .filter((el) => getComputedStyle(el).visibility !== "hidden")
            .map((el) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right };
            }),
          labels: [
            ...document.querySelectorAll(".performance-ranking .model-cell"),
          ].map((el) => ({ width: el.clientWidth, content: el.scrollWidth })),
        }));
        assert.ok(layout.width <= width, `${name}: ${JSON.stringify(layout)}`);
        assert.ok(
          layout.controls.every((r) => r.left >= 0 && r.right <= width),
          `${name}: clipped report controls`,
        );
        assert.ok(
          layout.labels.every((r) => r.content <= r.width + 1),
          `${name}: overlapping model labels`,
        );
      }
    }
    await page
      .getByRole("button", { name: "Toggle filters", exact: true })
      .click();
    await page.getByLabel("From day", { exact: true }).click();
    const calendar = page.locator(".el-picker-panel:visible");
    await calendar.waitFor();
    const calendarBox = await calendar.boundingBox();
    assert.ok(
      calendarBox.x >= 0 && calendarBox.x + calendarBox.width <= 320,
      "Date picker clipped on phone",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Toggle filters", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Toggle filters", exact: true })
      .click();
    assert.equal(
      await page.getByRole("form", { name: "Reporting range" }).isVisible(),
      true,
    );
    await page
      .getByRole("button", { name: "Toggle filters", exact: true })
      .click();
    await navigationToggle.click();
    await page.keyboard.press("Escape");
    assert.equal(await navigationToggle.getAttribute("aria-expanded"), "false");
    assert.equal(
      await navigationToggle.evaluate((el) => el === document.activeElement),
      true,
    );
    await finishMetricsRead();
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      page: document.documentElement.scrollWidth,
      charts: [...document.querySelectorAll('canvas[role="img"]')].map(
        (el) => ({
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        }),
      ),
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
    // Chart.js dispatches pointer inspection on the next animation frame.
    await page
      .getByRole("region", { name: "Daily activity", exact: true })
      .locator('.tooltip-day[title="2026-10-24"]')
      .waitFor();
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
    await finishMetricsRead();
    await visit("Performance");
    assert.match(await summary("Output speed summary"), /30 tokens\/s/);
    assert.match(await summary("Time to first output summary"), /0.5 s/);
    assert.match(
      await page
        .getByRole("region", { name: "Output speed ranking", exact: true })
        .innerText(),
      /Unavailable/,
    );
    const speedChart = page.getByRole("region", {
      name: "Output speed over time",
      exact: true,
    });
    assert.equal(
      await speedChart.getByRole("list", { name: "Series" }).count(),
      0,
    );
    await speedChart.getByRole("img").focus();
    await page.keyboard.press("End");
    assert.match(
      await speedChart.getByRole("status").innerText(),
      /30 tokens\/s/,
    );
    assert.equal(
      (await speedChart.getByRole("status").innerText()).includes(
        "Unavailable",
      ),
      false,
    );
    assert.equal(await speedChart.locator("canvas").count(), 1);
    await page.screenshot({
      path: path.join(output, "performance.png"),
      fullPage: true,
      animations: "disabled",
    });
    await visit("Models");
    await range("2026-10-20", "2026-10-20");
    await page
      .getByText("No usage for this selection.", { exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "empty.png"),
      fullPage: true,
      animations: "disabled",
    });
    // A second authenticated viewer reads the same UTC buckets in Chicago.
    await sql("TRUNCATE usage_daily,install_days,installs");
    const localId = "10000000-0000-4000-8000-000000000001";
    await sql(`INSERT INTO installs(install_id,first_reported_day,first_reported_hour) VALUES ('${localId}','2026-10-24',4);
      INSERT INTO install_days(install_id,day,app_version,os,reported_hours) VALUES
      ('${localId}','2026-10-24','1.0.0','macos',ARRAY[4,5]::smallint[]),
      ('${localId}','2026-10-25','1.0.0','macos',ARRAY[4]::smallint[]);
      INSERT INTO usage_daily(install_id,day,report_hour,provider,model,turns,input_tokens,cached_input_tokens,output_tokens,estimated_cost_usd) VALUES
      ('${localId}','2026-10-24',4,'codex','unknown',1,10,0,0,0),
      ('${localId}','2026-10-24',5,'codex','unknown',1,20,0,0,0),
      ('${localId}','2026-10-25',4,'codex','unknown',1,30,0,0,0)`);
    const localContext = await browser.newContext({
      timezoneId: "America/Chicago",
      storageState: await context.storageState(),
    });
    try {
      const localPage = await localContext.newPage();
      localPage.on("pageerror", (error) => errors.push(error.message));
      await localPage.goto(origin + "/tokens");
      await localPage
        .getByLabel("From day", { exact: true })
        .fill("2026-10-24");
      await localPage.getByLabel("To day", { exact: true }).fill("2026-10-24");
      await localPage.getByLabel("To day", { exact: true }).press("Tab");
      const [response] = await Promise.all([
        localPage.waitForResponse(
          (r) =>
            r.url().includes("from=2026-10-24&to=2026-10-24") &&
            r.status() === 200,
        ),
        localPage
          .getByRole("button", { name: "Apply range", exact: true })
          .click(),
      ]);
      assert.equal(
        new URL(response.url()).searchParams.get("timeZone"),
        "America/Chicago",
      );
      const localMetrics = await response.json();
      assert.equal(localMetrics.totals.totalTokens, "50");
      assert.equal(localMetrics.overview.dau, "1");
      await localPage
        .getByLabel("Measured total tokens", { exact: true })
        .getByText("50", { exact: true })
        .waitFor();
      assert.match(
        await localPage.locator(".freshness").innerText(),
        /America\/Chicago/,
      );
      await localPage.screenshot({
        path: path.join(output, "viewer-timezone.png"),
        fullPage: true,
      });
      await writeFile(
        path.join(output, "viewer-timezone.json"),
        JSON.stringify(localMetrics, null, 2),
      );
    } finally {
      await localContext.close();
    }
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
      .getByRole("heading", { level: 1, name: "Sign in", exact: true })
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
    await page.unroute("**/v1/telemetry/metrics?**");
    await signIn();
    await finishMetricsRead();
    const currentCookie = (await context.cookies()).find(
      (cookie) => cookie.httpOnly,
    );
    assert.ok(currentCookie);
    const signOutMenu = page.getByRole("button", {
      name: "Toggle navigation",
      exact: true,
    });
    if (await signOutMenu.isVisible()) await signOutMenu.click();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/auth/session") &&
          r.request().method() === "DELETE" &&
          r.status() === 204,
      ),
      page.getByRole("button", { name: "Sign out", exact: true }).click(),
    ]);
    await page
      .getByRole("heading", { level: 1, name: "Sign in", exact: true })
      .waitFor();
    const revoked = await context.request.get(
      `${origin}/v1/telemetry/metrics?from=2026-10-18&to=2026-10-24`,
      { headers: { Cookie: `${currentCookie.name}=${currentCookie.value}` } },
    );
    assert.equal(revoked.status(), 401);
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
          tokens: 700,
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
