// @vitest-environment jsdom
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, it, expect, vi } from "vitest";
import { RouterView, createMemoryHistory } from "vue-router";
import { createConsoleRouter } from "../router";
import { createConsoleSession } from "../console-session";
import { metrics } from "./metrics-fixture";
enableAutoUnmount(afterEach);
vi.mock("vue-chartjs", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    Chart: defineComponent({
      props: ["data", "options", "plugins", "type"],
      setup(_, { attrs }) {
        return () => h("canvas", attrs);
      },
    }),
  };
});
// Report failures: duplicated overview content, mismatched periods, wrong week
// alignment, lost decimal subtotals, and controls that reset data or truncate labels.
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
// Full rendered router workflow verifies each report route and its controls.
it("keeps overview weekly and gives each detail route its own breakdowns", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T20:00:00Z"));
  const base = metrics(),
    days = Array.from({ length: 14 }, (_, i) =>
      new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10),
    );
  const data = {
    ...base,
    range: { ...base.range, from: days[0]!, to: days.at(-1)! },
    overview: { ...base.overview, participatingInstalls: "20" },
    daily: days.map((day, i) => ({
      ...base.totals,
      day,
      turns: String(i + 1),
      inputTokens: i < 7 ? "500" : "1000",
      outputTokens: i < 7 ? "100" : "200",
      totalTokens: i < 7 ? (i === 6 ? "2400" : "600") : "1200",
      estimatedCostUsd: i < 7 ? "1.25" : "2.50",
    })),
    modelDaily: [
      { ...base.modelDaily[0]!, day: days[0]!, estimatedCostUsd: "0.10000001" },
      {
        ...base.modelDaily[1]!,
        day: days[0]!,
        model: "gpt-6-astra",
        estimatedCostUsd: "0.20000002",
        performance: {
          ...base.totals.performance,
          outputTokensPerSecond: "100",
          timeToFirstOutputMs: "1000",
        },
      },
      {
        ...base.modelDaily[0]!,
        day: days[0]!,
        provider: "claude",
        model: "claude-sonnet-5-5",
        serviceTier: "standard",
        estimatedCostUsd: null,
      },
      {
        ...base.modelDaily[0]!,
        day: days.at(-1)!,
        provider: "claude",
        model: "claude-sonnet-5-5",
        serviceTier: "standard",
        estimatedCostUsd: "0",
      },
    ],
    activity: days.map((day, i) => ({
      day,
      activeInstalls: "3",
      firstReportedInstalls: i === 0 ? "0" : i === 1 ? "4" : i < 7 ? "2" : "1",
    })),
    models: [
      {
        ...base.totals,
        provider: "codex",
        model: "gpt-6-sol",
        serviceTier: "fast",
        turns: "10",
        totalTokens: "9007199254740993",
        inputTokens: "30",
        outputTokens: "10",
        estimatedCostUsd: "0.10000001",
        performance: {
          ...base.totals.performance,
          outputTokensPerSecond: "70",
          timeToFirstOutputMs: "500",
        },
      },
      {
        ...base.totals,
        provider: "codex",
        model: "gpt-6-astra",
        serviceTier: "standard",
        turns: "20",
        totalTokens: "9007199254740992",
        inputTokens: "10",
        outputTokens: "30",
        estimatedCostUsd: "0.20000002",
        performance: {
          ...base.totals.performance,
          outputTokensPerSecond: "100",
          timeToFirstOutputMs: "1000",
        },
      },
      {
        ...base.totals,
        provider: "claude",
        model: "claude-sonnet-5-5",
        serviceTier: "standard",
        turns: "5",
        totalTokens: null,
        inputTokens: "20",
        outputTokens: "20",
        estimatedCostUsd: null,
        performance: {
          ...base.totals.performance,
          outputTokensPerSecond: null,
          timeToFirstOutputMs: null,
          speedTurns: "0",
          ttftTurns: "0",
        },
      },
    ],
  };
  const fetcher = vi.fn(async (url: string) => {
    const params = new URL(url, "https://console.test").searchParams;
    return Response.json(
      params.get("to") === "2026-10-25"
        ? { ...data, overview: { ...data.overview, wau: "2" } }
        : data,
    );
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const session = createConsoleSession();
  session.authenticate();
  const router = createConsoleRouter(session, createMemoryHistory());
  await router.push("/overview");
  await router.isReady();
  const wrapper = mount(RouterView, {
    attachTo: document.body,
    global: { plugins: [router] },
  });
  try {
    await flushPromises();
    const request = new URL(
      String(fetcher.mock.calls[0]?.[0]),
      "https://console.test",
    );
    expect(
      (Date.parse(request.searchParams.get("to")!) -
        Date.parse(request.searchParams.get("from")!)) /
        86400000,
    ).toBe(13);
    expect(wrapper.find('[aria-label="Reporting range"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Usage filters"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Latest report");
    expect(wrapper.get(".masthead-subtitle").text()).toBe(
      "Oct 26 – Nov 1 · compared with the previous week",
    );
    expect(wrapper.findAll(".weekly-card")).toHaveLength(4);
    expect(wrapper.get('[aria-label="Tokens last 7 days"]').text()).toContain(
      "8.4K",
    );
    expect(wrapper.get('[aria-label="Spend last 7 days"]').text()).toContain(
      "$17.50",
    );
    expect(
      wrapper.get('[aria-label="Spend last 7 days"] .weekly-change').text(),
    ).toContain("100%");
    expect(
      wrapper.get('[aria-label="Weekly active installs"]').text(),
    ).toContain("4");
    expect(wrapper.get('[aria-label="Weekly new installs"]').text()).toContain(
      "7",
    );
    expect(
      wrapper.get('[aria-label="Weekly active installs"]').text(),
    ).toContain("100%");
    expect(wrapper.get('[aria-label="Weekly new installs"]').text()).toContain(
      "50%",
    );
    expect(
      wrapper
        .get('[aria-label="Weekly new installs"] .weekly-change')
        .attributes("data-trend"),
    ).toBe("down");
    expect(wrapper.get('[aria-label="Weekly overview"]').text()).not.toContain(
      "vs Oct",
    );
    expect(wrapper.find(".weekly-comparison").exists()).toBe(false);
    expect(
      wrapper.findAll(".chart").map((chart) => chart.attributes("aria-label")),
    ).toEqual(["Weekly tokens"]);
    const trend = wrapper.get('[aria-label="Weekly tokens"]');
    await trend.get("canvas").trigger("keydown", { key: "Home" });
    expect(trend.findAll(".tooltip-name").map(row=>row.text())).toEqual(["This week","Previous week"]);
    await trend.get("canvas").trigger("keydown", { key: "End" });
    expect(trend.get('[role="status"]').text()).toContain("This week1.2K");
    expect(trend.get('[role="status"]').text()).toContain("Previous week2.4K");
    expect(trend.findAll(".tooltip-name").map(row=>row.text())).toEqual(["This week","Previous week"]);
    await wrapper.get('[aria-label="Weekly active installs"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/activity");
    for (const title of ["Daily activity", "New activations per day"])
      expect(wrapper.find(`[aria-label="${title}"] canvas`).exists()).toBe(
        true,
      );
    expect(wrapper.find('[aria-label="New installs"]').exists()).toBe(false);
    const dailyActivity = wrapper.get('[aria-label="Daily activity"]');
    await dailyActivity.get("canvas").trigger("keydown", { key: "End" });
    expect(dailyActivity.get('[role="status"]').text()).toContain(
      "Active installs3",
    );
    expect(dailyActivity.text()).not.toContain("New installs");
    const activations = wrapper.get('[aria-label="New activations per day"]');
    await activations.get("canvas").trigger("keydown", { key: "End" });
    expect(activations.get('[role="status"]').text()).toContain("New activations1");
    await activations.get("canvas").trigger("keydown", { key: "Home" });
    expect(activations.get('[role="status"]').text()).toContain("New activations0");
    await activations.get("canvas").trigger("keydown", { key: "ArrowRight" });
    expect(activations.get('[role="status"]').text()).toContain("New activations4");
    await router.push("/overview");
    await flushPromises();
    await wrapper.get('[aria-label="Tokens last 7 days"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/tokens");
    expect(
      (wrapper.get('input[aria-label="From day"]').element as HTMLInputElement)
        .value,
    ).toBe("2026-10-26");
    expect(
      (wrapper.get('input[aria-label="To day"]').element as HTMLInputElement)
        .value,
    ).toBe("2026-11-01");
    for (const title of ["Total tokens", "Tokens by model"])
      expect(wrapper.find(`[aria-label="${title}"]`).exists()).toBe(true);
    expect(wrapper.find('[aria-label="Weekly tokens"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Measured input"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Cache-read share"]').exists()).toBe(
      false,
    );
    await router.push("/overview");
    await flushPromises();
    await wrapper.get('[aria-label="Spend last 7 days"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/spend");
    expect(wrapper.get('[aria-label="Spend by provider"]').text()).toContain(
      "Codex",
    );
    expect(
      wrapper
        .get('[aria-label="Spend by provider"] [title="$0.30000003"]')
        .text(),
    ).toBe("$0.30");
    const spendChart = wrapper.get('[aria-label="Daily estimated spend"]');
    expect(spendChart.get('[aria-label="Series"]').text()).toBe("CodexClaude");
    await spendChart.get("canvas").trigger("keydown", { key: "Home" });
    expect(spendChart.get('[role="status"]').text()).toContain("Codex$0.30");
    expect(spendChart.get('[role="status"]').text()).not.toContain("Claude");
    expect(spendChart.get(".tooltip-total b").attributes("title")).toBe(
      "$0.30000003",
    );
    expect(spendChart.get(".tooltip-total").text()).toBe("Total$0.30");
    await spendChart.get("canvas").trigger("keydown", { key: "End" });
    expect(spendChart.get('[role="status"]').text()).toContain("Claude$0.00");
    expect(spendChart.get('[role="status"]').text()).not.toContain("Codex");
    expect(spendChart.get(".tooltip-total").text()).toBe("Total$0.00");
    await spendChart.get("canvas").trigger("keydown", { key: "Home" });
    await spendChart.get("canvas").trigger("keydown", { key: "ArrowRight" });
    expect(spendChart.get('[role="status"]').text()).toContain("Unavailable");
    expect(spendChart.find(".tooltip-total").exists()).toBe(false);
    await wrapper
      .get('[aria-label="Spend grouping"]')
      .findAll("label")
      .find((item) => item.text() === "Model")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[aria-label="Spend by model"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Spend by provider"]').exists()).toBe(
      false,
    );
    expect(spendChart.get('[aria-label="Series"]').text()).toContain(
      "gpt-6-astra",
    );
    await spendChart.get("canvas").trigger("keydown", { key: "Home" });
    expect(spendChart.get(".tooltip-total b").attributes("title")).toBe(
      "$0.30000003",
    );
    expect(wrapper.find('[aria-label="Measured input"]').exists()).toBe(false);
    await router.push("/models");
    await flushPromises();
    expect(wrapper.get('[aria-label="Model usage view"]').text()).toBe(
      "TrendRanking",
    );
    expect(
      wrapper.find('canvas[aria-label^="Model usage over time"]').exists(),
    ).toBe(true);
    expect(wrapper.get('[aria-label="Model usage measure"]').text()).toBe(
      "TurnsTokensCost",
    );
    expect(
      wrapper
        .find('[aria-label="Model token measure"]')
        .attributes("aria-hidden"),
    ).toBe("true");
    const table = wrapper.get('[aria-label="Provider and model"]');
    for (const [label, header, expected] of [
      ["Turns", "Turns", ["gpt-6-astra", "gpt-6-sol", "claude-sonnet-5-5"]],
      [
        "Tokens",
        "Total tokens",
        ["gpt-6-sol", "gpt-6-astra", "claude-sonnet-5-5"],
      ],
      [
        "Input",
        "Inclusive input",
        ["gpt-6-sol", "claude-sonnet-5-5", "gpt-6-astra"],
      ],
      ["Output", "Output", ["gpt-6-astra", "claude-sonnet-5-5", "gpt-6-sol"]],
    ] as const) {
      await wrapper
        .get(
          ["Input", "Output"].includes(label)
            ? '[aria-label="Model token measure"]'
            : '[aria-label="Model usage measure"]',
        )
        .findAll("label")
        .find((item) => item.text() === label)!
        .trigger("click");
      await flushPromises();
      expect(
        table
          .findAll("tbody tr th span:last-child")
          .map((item) => item.text().split(" · ")[0]),
      ).toEqual(expected);
      expect(table.get('th[aria-sort="descending"]').text()).toBe(header);
    }
    expect(wrapper.get('[aria-label="Model token measure"]').text()).toBe(
      "TotalInputOutputRatio",
    );
    await wrapper
      .get('[aria-label="Model token measure"]')
      .findAll("label")
      .find((item) => item.text() === "Ratio")!
      .trigger("click");
    await flushPromises();
    expect(table.get('th[aria-sort="descending"]').text()).toBe("Input ratio");
    expect(
      table.findAll("tbody tr th span:last-child").at(-1)!.text(),
    ).toContain("claude-sonnet-5-5");
    expect(table.get("tbody tr td:nth-child(7)").text()).toContain("%");
    await wrapper
      .get('[aria-label="Model usage measure"]')
      .findAll("label")
      .find((item) => item.text() === "Cost")!
      .trigger("click");
    await flushPromises();
    expect(
      wrapper
        .find('[aria-label="Model token measure"]')
        .attributes("aria-hidden"),
    ).toBe("true");
    expect(table.get('th[aria-sort="descending"]').text()).toBe(
      "Estimated USD",
    );
    expect(
      table
        .findAll("tbody tr th span:last-child")
        .map((item) => item.text().split(" · ")[0]),
    ).toEqual(["gpt-6-astra", "gpt-6-sol", "claude-sonnet-5-5"]);
    const modelChart = wrapper.get('[aria-label="Model usage over time"]');
    await modelChart.get("canvas").trigger("keydown", { key: "Home" });
    expect(modelChart.get('[role="status"]').text()).toContain("$0.20");
    await modelChart.get("canvas").trigger("keydown", { key: "End" });
    expect(
      modelChart.findAll(".tooltip-name").map((row) => row.text()),
    ).toEqual(["Claude / claude-sonnet-5-5"]);
    await wrapper
      .findAll("label")
      .find((label) => label.text() === "Trend")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[aria-label="Model usage over time"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[aria-label="Model trend style"]').exists()).toBe(
      false,
    );
    await wrapper
      .get('[aria-label="Model usage grouping"]')
      .findAll("label")
      .find((item) => item.text() === "Provider")!
      .trigger("click");
    await flushPromises();
    expect(table.findAll("tbody tr")).toHaveLength(2);
    expect(table.find("tbody tr").text()).toContain("Codex");
    expect(table.get('[title="$0.30000003"]').text()).toBe("$0.30");
    expect(table.get('[title="18,014,398,509,481,985"]').text()).toBeTruthy();
    expect(
      wrapper.find('[aria-label="Provider usage over time"]').exists(),
    ).toBe(true);
    await wrapper
      .get('[aria-label="Model usage grouping"]')
      .findAll("label")
      .find((item) => item.text() === "Model")!
      .trigger("click");
    await flushPromises();
    expect(table.findAll("tbody tr")).toHaveLength(3);
    await router.push("/performance");
    await flushPromises();
    expect(wrapper.findAll("canvas")).toHaveLength(1);
    expect(
      wrapper.find('[aria-label="Output speed over time"] canvas').exists(),
    ).toBe(true);
    expect(
      wrapper
        .get('[aria-label="Time to first output summary"]')
        .element.compareDocumentPosition(
          wrapper.get('[aria-label="Output speed over time"]').element,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(wrapper.find('[aria-label="Performance by model"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("Timing coverage");
    expect(
      wrapper
        .get('[aria-label="Output speed ranking"]')
        .findAll("tbody tr td:first-child")
        .map((cell) => cell.text()),
    ).toEqual(["gpt-6-astra", "gpt-6-sol · fast", "claude-sonnet-5-5"]);
    expect(
      wrapper
        .get('[aria-label="Time to first token ranking"]')
        .findAll("tbody tr td:first-child")
        .map((cell) => cell.text()),
    ).toEqual(["gpt-6-sol · fast", "gpt-6-astra", "claude-sonnet-5-5"]);
    expect(
      wrapper
        .get('[aria-label="Output speed ranking"]')
        .findAll("tbody tr")
        .at(-1)!
        .text(),
    ).toContain("Unavailable");
    await wrapper.get('input[aria-label="From day"]').setValue("2026-10-19");
    await wrapper.get('input[aria-label="From day"]').trigger("change");
    await wrapper.get('input[aria-label="To day"]').setValue("2026-10-25");
    await wrapper.get('input[aria-label="To day"]').trigger("change");
    await wrapper.get('form[aria-label="Reporting range"]').trigger("submit");
    await flushPromises();
    await wrapper.get('[aria-label="Provider"]').trigger("click");
    await flushPromises();
    (
      Array.from(document.querySelectorAll('[role="option"]')).find(
        (option) => option.textContent?.trim() === "Codex",
      ) as HTMLElement
    ).click();
    await flushPromises();
    await router.push("/overview");
    await flushPromises();
    const weeklyRequest = new URL(
      String(fetcher.mock.calls.at(-2)?.[0]),
      "https://console.test",
    );
    expect(weeklyRequest.searchParams.get("to")).toBe("2026-11-01");
    expect(weeklyRequest.searchParams.has("provider")).toBe(false);
    await router.push("/performance");
    await flushPromises();
    expect(
      (wrapper.get('input[aria-label="To day"]').element as HTMLInputElement)
        .value,
    ).toBe("2026-10-25");
    expect(
      new URL(
        String(fetcher.mock.calls.at(-1)?.[0]),
        "https://console.test",
      ).searchParams.get("provider"),
    ).toBe("codex");
    data.models.push({...data.models[0]!,provider:"cursor",model:"cursor/custom"});
    data.models.push({...data.models[0]!,provider:"custom/harness",model:"custom/model"});
    await wrapper.get('[aria-label="Refresh metrics"]').trigger("click");
    await flushPromises();
    await wrapper.get('[aria-label="Provider"]').trigger("click");
    await flushPromises();
    const options=Array.from(document.querySelectorAll('[role="option"]'));
    expect(options.some(option=>option.textContent?.trim()==="Cursor")).toBe(true);
    const custom=options.find(option=>option.textContent?.trim()==="custom/harness") as HTMLElement;
    expect(custom).toBeTruthy();
    custom.click();
    await flushPromises();
    expect(new URL(String(fetcher.mock.calls.at(-1)?.[0]),"https://console.test").searchParams.get("provider")).toBe("custom/harness");
  } finally {
    wrapper.unmount();
  }
}, 5_000);
