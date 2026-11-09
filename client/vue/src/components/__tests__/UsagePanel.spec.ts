import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("vue-chartjs", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    Chart: defineComponent({
      props: ["data", "options", "plugins", "type"],
      setup(_props, { attrs }) {
        return () => h("canvas", { ...attrs, "data-chart-fixture": "true" });
      },
    }),
  };
});
import { setElectronTestClient } from "../../../tests/support/client";
import UsagePanel from "../UsagePanel.vue";
import type { UsageSummary } from "@workspace/core/usage";
import SettingsView from "../SettingsView.vue";
import { defaultGeneralSettings, defaultThemeSettings } from "@workspace/core/settings";
import { ElMessageBox } from "element-plus";
import {
  activityWindow,
  browserTimeZone,
  localDay,
  shiftDay,
} from "../usage-chart";

// Keep request fixtures and rendered ranges on one calendar day across async loads.
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 1, 12) }));
afterEach(() => vi.useRealTimers());

it("warns for enabled providers whose driver does not report tokens", async () => {
  setElectronTestClient({ getUsage: vi.fn(async () => ({ recordedSince: 1, retainedSince: 1, rows: [], daily: [] })) });
  const connection = { backend: "cursor" as const, installed: true, connected: false, checking: false, enabled: true };
  const wrapper = mount(SettingsView, { props: { activeTab: "usage", settings: defaultThemeSettings, generalSettings: { ...defaultGeneralSettings, providerEnabled: { cursor: false } }, providerConnections: [connection] } });
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  await wrapper.setProps({ generalSettings: { ...defaultGeneralSettings, providerEnabled: { cursor: true } } });
  const warning = () => wrapper.get('[role="alert"]');
  expect(warning().text()).toBe("Cursor turns are reported, but token usage and cost are unavailable.");
  expect(warning().classes()).toContain("el-alert--warning");
  expect(warning().find(".el-alert__close-btn").exists()).toBe(false);
  await wrapper.get("#usage-tab-performance").trigger("click");
  expect(warning().isVisible()).toBe(true);
  await wrapper.setProps({ providerConnections: [{ ...connection, enabled: false }] });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  await wrapper.setProps({ providerConnections: [{ ...connection, installed: false }] });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  await wrapper.setProps({
    generalSettings: { ...defaultGeneralSettings, providerEnabled: { claude: true } },
    providerConnections: [{ ...connection, backend: "claude" }],
    backendRuntimes: [{ backend: "claude", status: "running", capabilities: { reportsTokens: false } }],
  });
  expect(warning().text()).toBe("Claude Code turns are reported, but token usage and cost are unavailable.");
  await wrapper.setProps({ backendRuntimes: [{ backend: "claude", status: "running", capabilities: { reportsTokens: true } }] });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  wrapper.unmount();
});

it.each(["unmeasured", "missing-total", "partial", "unavailable"])(
  "shows only the known token total for %s activity",
  async (state) => {
    const row = {
      label: "claude",
      started: 2,
      completed: 2,
      failed: 0,
      interrupted: 0,
      inProgress: 0,
      measuredTurns: state === "partial" ? 1 : 0,
      tokens:
        state === "partial"
          ? { input: 8, output: 2, total: 10, cacheRead: 0, cacheWrite: 0 }
          : state === "missing-total"
            ? { input: 8, output: 2, cacheRead: 0, cacheWrite: 0 }
            : null,
    };
    const summary = {
      recordedSince: 1,
      retainedSince: 1,
      rows: [row],
      daily: [{ ...row, day: activityWindow().to, groups: [row] }],
    };
    setElectronTestClient({
      getUsage: vi.fn(async (filter) => {
        if (state === "unavailable" && filter?.from === activityWindow().from)
          throw Error("unavailable");
        return summary;
      }),
    });
    const wrapper = mount(UsagePanel);
    await flushPromises();
    expect(wrapper.find('canvas[data-chart-fixture="true"]').exists()).toBe(true);
    expect(
      wrapper
        .get('[aria-label="Analytics totals"]')
        .findAll(".usage-stat__value")[1]!
        .text(),
    ).toBe(
      state === "partial" ? "1.4" : "0",
    );
    expect(
      wrapper
        .findAll(".activity-stats .usage-stat__value")
        .slice(0, 2)
        .map((value) => value.text()),
    ).toStrictEqual(state === "partial" ? ["10", "10"] : state === "unavailable" ? ["N/A", "N/A"] : ["0", "0"]);
    await wrapper
      .findAll(".activity-cell:not(.activity-cell--future)")
      .at(-1)!
      .trigger("pointerenter");
    expect(wrapper.get(".activity-tooltip strong").text()).toBe(
      state === "partial" ? "10 tokens" : state === "unavailable" ? "N/A" : "0 tokens",
    );
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  },
);
const choose = async (
  wrapper: ReturnType<typeof mount>,
  group: string,
  label: string,
) =>
  wrapper
    .get(group)
    .findAll("label")
    .find((option) => option.text() === label)!
    .get('input[type="radio"]')
    .setValue();
const chooseProvider = async (
  wrapper: ReturnType<typeof mount>,
  value: string,
) =>
  wrapper
    .getComponent({ name: "ElSelect" })
    .vm.$emit("update:modelValue", value);

it("plots service-tier model rates without stacking or treating missing measurements as zero", async () => {
  const day = (offset: number) => shiftDay(localDay(), -offset);
  const row = (label: string, outputTokens: number, generationMs: number) => ({
    label: "gpt-6.1-sol",
    key: label,
    modelVariant: {
      model: "gpt-6.1-sol",
      serviceTier: label === "sonnet" ? "standard" : "fast",
    },
    started: 2,
    completed: 2,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
    measuredTurns: 2,
    tokens: null,
    speed: { turns: 2, outputTokens, generationMs, ttftMs: 2000, ttftTurns: 2 },
  });
  const first = [row("sonnet", 100, 4000), row("gpt-6-luna", 250, 10000)];
  const summary = {
    recordedSince: 1,
    retainedSince: 1,
    rows: [
      row("sonnet", 300, 8000),
      { ...row("gpt-6-luna", 250, 10000), started: 20 },
    ],
    daily: [
      {
        day: day(2),
        started: 4,
        measuredTurns: 4,
        tokens: null,
        groups: first,
      },
      {
        day: day(1),
        started: 1,
        measuredTurns: 0,
        tokens: null,
        groups: [{ ...first[0]!, speed: undefined }],
      },
      {
        day: day(0),
        started: 2,
        measuredTurns: 2,
        tokens: null,
        groups: [row("sonnet", 200, 4000)],
      },
    ],
  };
  const grouped = {
    ...summary,
    rows: [
      {
        ...row("grouped", 550, 18000),
        key: "gpt-6.1-sol",
        modelVariant: undefined,
        started: 22,
      },
    ],
    daily: [],
  };
  const getUsage = vi.fn(async (filter?: { groupServiceTiers?: boolean }) =>
    filter?.groupServiceTiers ? grouped : summary,
  );
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "Performance")!
      .trigger("click");
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({ group: "model" }),
    );
    expect(wrapper.get('[aria-label="Output Speed"] tbody').text()).toContain(
      "gpt-6.1-sol · fast",
    );
    const chart = wrapper.get('canvas[aria-label="Output speed over time"]');
    expect(
      wrapper.findAll(".chart-legend span").map((row) => row.text()),
    ).toStrictEqual(["gpt-6.1-sol", "gpt-6.1-sol · fast"]);
    const sonnet = wrapper.get(
      `[aria-label="${day(2)} · gpt-6.1-sol: 25 tokens/s"]`,
    );
    const gpt = wrapper.get(
      `[aria-label="${day(2)} · gpt-6.1-sol · fast: 25 tokens/s"]`,
    );
    expect(gpt.attributes("aria-label")).toContain("25 tokens/s");
    expect(wrapper.findAll(".chart-observation")).toHaveLength(3);
    await sonnet.trigger("focus");
    expect(wrapper.get(".chart-tooltip").text()).toContain("25 tokens/s");
    expect(wrapper.get(".chart-tooltip").text()).not.toContain("Total");
    expect(
      wrapper.findAll(".chart-tooltip .tooltip-name").map((row) => row.text()),
    ).toStrictEqual(["gpt-6.1-sol", "gpt-6.1-sol · fast"]);
    await chart.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.get(".chart-tooltip").text()).toContain("N/A");
    await wrapper.get('[aria-label="Analytics options"]').trigger("click");
    const toggle = () =>
      document.body.querySelector<HTMLElement>(
        '[role="menu"][aria-label="Analytics options"] [role="menuitemcheckbox"]',
      )!;
    expect(toggle().textContent).toContain("Group service tiers");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().querySelector(".tabler-icon-bolt")).not.toBeNull();
    toggle().click();
    await flushPromises();
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({ group: "model", groupServiceTiers: true }),
    );
    expect(wrapper.get('[aria-label="Output Speed"] tbody').text()).toContain(
      "30.6",
    );
    expect(
      wrapper.get('[aria-label="Output Speed"] tbody').text(),
    ).not.toContain(" · fast");
    await wrapper.get("#usage-tab-usage").trigger("click");
    expect(
      wrapper.get('[aria-label="Usage breakdown"] tbody').findAll("tr"),
    ).toHaveLength(1);
    await wrapper.get("#usage-tab-performance").trigger("click");
    await wrapper.get('[aria-label="Analytics options"]').trigger("click");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(toggle().querySelector(".tabler-icon-check")).not.toBeNull();
    expect(toggle().querySelector(".tabler-icon-bolt")).toBeNull();
    toggle().click();
    await flushPromises();
    expect(wrapper.get('[aria-label="Output Speed"] tbody').text()).toContain(
      " · fast",
    );
    await chooseProvider(wrapper, "claude");
    await flushPromises();
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", group: "model" }),
    );
    getUsage.mockResolvedValue({ ...summary, rows: [], daily: [] });
    await wrapper.get('[aria-label="Refresh"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find('canvas[aria-label="Output speed over time"]').exists(),
    ).toBe(false);
    expect(wrapper.find('[aria-label="Output speed over time"]').exists())
      .toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it("shows unknown consumption with measured denominators and filters the local owning API", async () => {
  const getUsage = vi.fn().mockResolvedValue({
    recordedSince: 1,
    retainedSince: 1,
    rows: [
      {
        label: "codex",
        started: 3,
        completed: 1,
        failed: 1,
        interrupted: 0,
        inProgress: 1,
        measuredTurns: 0,
        tokens: null,
      },
    ],
  });
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain("N/A");
  expect(wrapper.find('[role="meter"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain("0 of 3 turns measured");
  expect(wrapper.getComponent({ name: 'ElSelect' }).findAllComponents({ name: 'ElOption' }).map(option => option.props('label'))).toContain('Cursor');
  await chooseProvider(wrapper, "cursor");
  await flushPromises();
  expect(getUsage).toHaveBeenCalledWith(
    expect.objectContaining({ group: "provider", provider: "cursor" }),
  );
  wrapper.unmount();
});
it("opens on total tokens by provider and regroups every chart from one toolbar control", async () => {
  const row = (label: string, started: number, known: boolean) => ({
    label,
    started,
    completed: started,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
    measuredTurns: known ? started : 0,
    tokens: known
      ? { total: 300, input: 200, output: 100, cacheRead: 0, cacheWrite: null }
      : null,
    speed: known
      ? {
          turns: 1,
          outputTokens: 100,
          generationMs: 4000,
          ttftMs: 1500,
          ttftTurns: 1,
        }
      : undefined,
  });
  const getUsage = vi.fn(async ({ group }) => {
    const rows =
      group === "provider"
        ? [row("claude", 1, true), row("codex", 3, false)]
        : [row("sonnet", 1, true), row("Unknown", 3, false)];
    return {
      recordedSince: Date.now(),
      retainedSince: Date.now(),
      rows,
      daily: [
        {
          day: localDay(),
          started: 4,
          measuredTurns: 1,
          tokens: rows[0]!.tokens,
          groups: rows,
        },
      ],
    };
  });
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe(
    "Total tokens",
  );
  for (const label of ["Usage share", "Activity over time", "Usage breakdown"])
    expect(wrapper.get(`[aria-label="${label}"]`).text()).toContain("sonnet");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("100%");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("Unknown model0%0");
  expect(
    wrapper
      .get("#usage-measure")
      .findAll("label")
      .map((option) => option.text()),
  ).toStrictEqual(["Turns", "Tokens", "Cost"]);
  expect(
    wrapper
      .get("#usage-token-measure")
      .findAll("label")
      .map((option) => option.text()),
  ).toStrictEqual(["Total", "Input", "Output", "Ratio"]);
  await choose(wrapper, "#usage-token-measure", "Input");
  expect(wrapper.get(".hero-number strong").text()).toBe("200");
  expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe(
    "Input tokens",
  );
  expect(
    wrapper
      .get("#usage-measure")
      .findAll("label")
      .filter(
        (option) =>
          option.get<HTMLInputElement>('input[type="radio"]').element.checked,
      )
      .map((option) => option.text()),
  ).toStrictEqual(["Tokens"]);
  await choose(wrapper, "#usage-token-measure", "Output");
  expect(wrapper.get(".hero-number strong").text()).toBe("100");
  expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe(
    "Output tokens",
  );
  await choose(wrapper, "#usage-measure", "Cost");
  expect(wrapper.find("#usage-token-measure").exists()).toBe(false);
  await choose(wrapper, "#usage-measure", "Tokens");
  expect(wrapper.get(".hero-number strong").text()).toBe("300");
  expect(
    wrapper
      .get("#usage-token-measure")
      .findAll("label")
      .filter(
        (option) =>
          option.get<HTMLInputElement>('input[type="radio"]').element.checked,
      )
      .map((option) => option.text()),
  ).toStrictEqual(["Total"]);
  expect(
    wrapper.get('#usage-grouping [role="radiogroup"]').attributes("aria-label"),
  ).toBe("Group by");
  await choose(wrapper, "#usage-grouping", "Provider");
  for (const label of ["Usage share", "Activity over time", "Usage breakdown"])
    expect(wrapper.get(`[aria-label="${label}"]`).text()).toContain(
      "Claude Code",
    );
  await choose(wrapper, "#usage-grouping", "Model");
  await choose(wrapper, "#usage-measure", "Turns");
  expect(wrapper.find("#usage-token-measure").exists()).toBe(false);
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("75%");
  expect(
    wrapper
      .get('[aria-label="Usage breakdown"]')
      .findAll("tbody tr")
      .map((row) => row.findAll("td").map((cell) => cell.text())),
  ).toStrictEqual([
    ["sonnet", "1", "300", "Unavailable", "100%"],
    ["Unknown model", "3", "0", "Unavailable", "0%"],
  ]);
  expect(
    wrapper
      .get('[aria-label="Activity over time"]')
      .findAll(".chart-observation")
      .filter((r) => r.attributes("aria-label")?.includes("sonnet")).length,
  ).toBe(1);
  expect(getUsage).toHaveBeenCalledTimes(4); // Both projections, the activity window and the comparison period load once; chart controls do not fetch or mix periods.
  await wrapper
    .findAll('[role="tab"]')
    .find((t) => t.text() === "Performance")!
    .trigger("click");
  await flushPromises();
  // 100 provider-reported tokens over 4 working seconds after the first token.
  expect(wrapper.text()).toContain("25");
  expect(wrapper.text()).toContain("tok/sec");
  expect(wrapper.findAll(".performance-grid table")).toHaveLength(2);
  const totals = wrapper.get('[aria-label="Analytics totals"]');
  expect(
    totals.findAll(".usage-stat__label").map((label) => label.text()),
  ).toStrictEqual(["Time to First Token (TTFT)", "Output Speed"]);
  const ttft = wrapper.get('[aria-label="Time to First Token (TTFT)"]');
  const speed = wrapper.get('[aria-label="Output Speed"]');
  expect(ttft.get("header").text()).toBe("Time to First Token (TTFT)");
  expect(speed.get("header").text()).toBe("Output Speed");
  expect(
    ttft.findAll("thead th").map((heading) => heading.text()),
  ).toStrictEqual(["Model", "sec"]);
  expect(
    speed.findAll("thead th").map((heading) => heading.text()),
  ).toStrictEqual(["Model", "tok/sec"]);
  expect(
    ttft
      .find("tbody tr")
      .findAll("td")
      .map((cell) => cell.text()),
  ).toStrictEqual(["sonnet", "1.5"]);
  expect(speed.find("tbody tr").text()).toContain("sonnet");
  expect(
    totals.findAll(".usage-stat__unit").map((unit) => unit.text()),
  ).toStrictEqual(["s", "tokens/s"]);
  expect(totals.text()).not.toContain("Timed turns");

  // Refreshing the same dashboard keeps compact values consistent across its views.
  const total = 19_223_027;
  const largeRow = {
    label: "gpt-6-luna",
    started: total,
    completed: total,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
    measuredTurns: 1,
    tokens: {
      total,
      input: 19_000_000,
      output: 223_027,
      cacheRead: 0,
      cacheWrite: null,
      reasoning: null as number | null,
    },
    speed: {
      turns: 1,
      outputTokens: 1_234_567,
      generationMs: 1_000,
      ttftMs: 1_234_500,
      ttftTurns: 1,
    },
  };
  const refreshed = (rows: typeof largeRow[]) => ({
    recordedSince: 0,
    retainedSince: 0,
    rows,
    daily: [{
      day: localDay(),
      started: total,
      measuredTurns: 1,
      tokens: rows[0]!.tokens,
      groups: rows,
    }],
  });
  getUsage.mockResolvedValue(refreshed([largeRow]));
  await wrapper.get('[aria-label="Refresh"]').trigger("click");
  await flushPromises();
  expect(
    wrapper
      .get('[aria-label="Analytics totals"]')
      .findAll(".usage-stat__value")
      .map((value) => value.text()),
  ).toStrictEqual(["1.2K", "1.2M"]);
  expect(
    wrapper.get('[aria-label="Time to First Token (TTFT)"] tbody tr')
      .findAll("td").map((cell) => cell.text()),
  ).toStrictEqual(["gpt-6-luna", "1.2K"]);
  expect(
    wrapper.get('[aria-label="Output Speed"] tbody tr')
      .findAll("td").map((cell) => cell.text()),
  ).toStrictEqual(["gpt-6-luna", "1.2M"]);
  await wrapper.get("#usage-tab-usage").trigger("click");
  expect(wrapper.get(".hero-number strong").text()).toBe("19.2M");
  expect(
    wrapper.get('[aria-label="Usage breakdown"] tbody tr')
      .findAll("td").map((cell) => cell.text()),
  ).toStrictEqual(["gpt-6-luna", "19.2M", "19.2M", "Unavailable", "100%"]);

  // Parent-relative counters must not be counted a second time in the token stack.
  const mixedRow = {
    ...largeRow,
    tokens: { total: 140, input: 100, output: 40, cacheRead: 60, cacheWrite: null, reasoning: 10 },
  };
  getUsage.mockResolvedValue(refreshed([mixedRow]));
  await wrapper.get('[aria-label="Refresh"]').trigger("click");
  await flushPromises();
  expect(
    wrapper.findAll(".mix-bar > span")
      .map((part) => (part.element as HTMLElement).style.flexGrow),
  ).toStrictEqual(["100", "40"]);
  expect(wrapper.findAll(".mix-legend li").map((part) => part.text()))
    .toStrictEqual([
      "Input tokens71.4%",
      "Cache read (% of input)60%",
      "Output tokens28.6%",
      "Reasoning (% of output)25%",
    ]);
  getUsage.mockResolvedValue(refreshed([{
    ...mixedRow,
    tokens: { ...mixedRow.tokens, cacheRead: 0, reasoning: null },
  }]));
  await wrapper.get('[aria-label="Refresh"]').trigger("click");
  await flushPromises();
  expect(wrapper.findAll(".mix-legend li").map((part) => part.text()))
    .toStrictEqual(["Input tokens71.4%", "Output tokens28.6%"]);
  wrapper.unmount();
});

it("scales model behavior bars by value and uses each model provider color", async () => {
  const row = (label: string, generationMs: number, ttftMs: number) => ({
    label,
    started: 1,
    completed: 1,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
    measuredTurns: 0,
    tokens: null,
    speed: {
      turns: 1,
      outputTokens: 100,
      generationMs,
      ttftMs,
      ttftTurns: 1,
    },
  });
  const summary = {
    recordedSince: 1,
    retainedSince: 1,
    rows: [
      row("claude-sonnet-5-5", 2000, 2000),
      row("gpt-6-luna", 1000, 4000),
      row("antigravity-gemini-1", 4000, 1000),
    ],
  };
  setElectronTestClient({ getUsage: vi.fn(async () => summary) });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  await wrapper
    .findAll('[role="tab"]')
    .find((tab) => tab.text() === "Performance")!
    .trigger("click");
  await flushPromises();

  const ttft = wrapper.get('[aria-label="Time to First Token (TTFT)"]');
  const speed = wrapper.get('[aria-label="Output Speed"]');
  const ttftRows = ttft.findAll("tbody tr");
  const speedRows = speed.findAll("tbody tr");
  expect(
    ttft.findAll("thead th").map((heading) => heading.text()),
  ).toStrictEqual(["Model", "sec"]);
  expect(
    speed.findAll("thead th").map((heading) => heading.text()),
  ).toStrictEqual(["Model", "tok/sec"]);
  expect(ttftRows.map((row) => row.findAll("td")[1]?.text())).toStrictEqual([
    "1",
    "2",
    "4",
  ]);
  expect(speedRows.map((row) => row.findAll("td")[1]?.text())).toStrictEqual([
    "100",
    "50",
    "25",
  ]);
  expect(ttftRows.map((row) => row.findAll("td")[0]?.text())).toStrictEqual([
    "antigravity-gemini-1",
    "claude-sonnet-5-5",
    "gpt-6-luna",
  ]);
  expect(speedRows.map((row) => row.findAll("td")[0]?.text())).toStrictEqual([
    "gpt-6-luna",
    "claude-sonnet-5-5",
    "antigravity-gemini-1",
  ]);
  expect(ttftRows[0]?.get(".value-fill").attributes("style")).toContain(
    "width: 25%",
  );
  expect(ttftRows[0]?.get(".value-fill").attributes("style")).toContain(
    "var(--chart-3)",
  );
  expect(ttftRows[1]?.get(".value-fill").attributes("style")).toContain(
    "width: 50%",
  );
  expect(ttftRows[1]?.get(".value-fill").attributes("style")).toContain(
    "var(--chart-2)",
  );
  expect(ttftRows[2]?.get(".value-fill").attributes("style")).toContain(
    "width: 100%",
  );
  expect(ttftRows[2]?.get(".value-fill").attributes("style")).toContain(
    "var(--chart-1)",
  );
  expect(speedRows[0]?.get(".value-fill").attributes("style")).toContain(
    "width: 100%",
  );
  expect(speedRows[0]?.get(".value-fill").attributes("style")).toContain(
    "var(--chart-1)",
  );
  expect(speedRows[1]?.get(".value-fill").attributes("style")).toContain(
    "width: 50%",
  );
  expect(speedRows[1]?.get(".value-fill").attributes("style")).toContain(
    "var(--chart-2)",
  );
  expect(speedRows[2]?.get(".value-fill").attributes("style")).toContain(
    "width: 25%",
  );
  expect(speedRows[2]?.get(".value-fill").attributes("style")).toContain(
    "var(--chart-3)",
  );
  expect(ttft.text()).not.toContain("Samples");
  expect(speed.text()).not.toContain("Timed turns");
  wrapper.unmount();
});

it("keeps TTFT models while omitting unmeasured speed and absent tiers", async () => {
  const summary: UsageSummary = {
    recordedSince: 1,
    retainedSince: 1,
    rows: [
      {
        label: "grok-4.5",
        reportsTokens: false,
        modelVariant: { model: "grok-4.5", serviceTier: null },
        started: 1,
        completed: 1,
        failed: 0,
        interrupted: 0,
        inProgress: 0,
        measuredTurns: 0,
        tokens: null,
        speed: {
          turns: 1,
          outputTokens: 100,
          generationMs: 1000,
          ttftMs: 56800,
          ttftTurns: 1,
        },
      },
    ],
  };
  summary.rows.push({
    ...summary.rows[0]!,
    label: "gemini-3.8-flash",
    reportsTokens: true,
    modelVariant: { model: "gemini-3.8-flash", serviceTier: null },
    speed: { turns: 0, outputTokens: 0, generationMs: 0, ttftMs: 0, ttftTurns: 0 },
  });
  const getUsage = vi.fn(async () => summary);
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  await wrapper
    .findAll('[role="tab"]')
    .find((t) => t.text() === "Performance")!
    .trigger("click");
  await flushPromises();
  const ttft = wrapper.get('[aria-label="Time to First Token (TTFT)"]');
  expect(
    ttft
      .findAll("tbody tr")[0]
      ?.findAll("td")
      .map((cell) => cell.text()),
  ).toStrictEqual(["grok-4.5", "56.8"]);
  expect(ttft.findAll("tbody tr")).toHaveLength(1);
  expect(ttft.text()).not.toContain("gemini-3.8-flash");
  expect(wrapper.text()).not.toContain("Unknown tier");
  expect(wrapper.text()).not.toContain("Output Speed");
  expect(wrapper.text()).not.toContain("Output speed over time");
  expect(wrapper.get('[aria-label="Analytics totals"]').findAll(".usage-stat")).toHaveLength(1);

  // A measured provider remains comparable without adding empty Cursor rows.
  getUsage.mockResolvedValue({
    ...summary,
    rows: [...summary.rows, {
      ...summary.rows[0]!,
      label: "gpt-6-luna",
      reportsTokens: true,
      modelVariant: { model: "gpt-6-luna", serviceTier: "fast" },
      speed: { turns: 1, outputTokens: 100, generationMs: 2000, ttftMs: 1000, ttftTurns: 1 },
    }],
  });
  await wrapper.get('[aria-label="Refresh"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[aria-label="Time to First Token (TTFT)"]').text())
    .toContain("grok-4.5");
  expect(wrapper.get('[aria-label="Output Speed"] tbody').findAll("tr")
    .map(row => row.findAll("td").map(cell => cell.text())))
    .toStrictEqual([["gpt-6-luna · fast", "50"]]);
  await wrapper.get("#usage-tab-usage").trigger("click");
  const share = wrapper.get('[aria-label="Usage share"]');
  expect(share.text()).not.toContain("grok-4.5");
  await choose(wrapper, "#usage-measure", "Turns");
  expect(share.text()).toContain("grok-4.5");
  wrapper.unmount();
});

it("ignores stale filter responses and clears previous statistics when a new query fails", async () => {
  const pending: Array<{
    filter: { provider?: string; group?: string };
    resolve: (value: unknown) => void;
  }> = [];
  const getUsage = vi
    .fn()
    .mockImplementation(
      (filter) => new Promise((resolve) => pending.push({ filter, resolve })),
    );
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await chooseProvider(wrapper, "claude");
  const summary = (label: string) => ({
    recordedSince: 1,
    retainedSince: 1,
    rows: [
      {
        label,
        started: 1,
        completed: 1,
        failed: 0,
        interrupted: 0,
        inProgress: 0,
        measuredTurns: 0,
        tokens: null,
      },
    ],
  });
  pending
    .filter((request) => request.filter.provider === "claude")
    .forEach((request) =>
      request.resolve(
        summary(request.filter.group === "model" ? "sonnet" : "claude"),
      ),
    );
  await flushPromises();
  pending
    .filter((request) => !request.filter.provider)
    .forEach((request) =>
      request.resolve(
        summary(request.filter.group === "model" ? "Unknown" : "codex"),
      ),
    );
  await flushPromises();
  expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain(
    "sonnet",
  );
  expect(wrapper.get('[aria-label="Usage breakdown"]').text()).not.toContain(
    "Unknown model",
  );
  getUsage.mockRejectedValueOnce(Error("offline"));
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Refresh")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  expect(wrapper.find('[aria-label="Usage breakdown"]').exists()).toBe(false);
  wrapper.unmount();
});

it("requires confirmation before clearing statistics, keeps data on failure and refreshes after success", async () => {
  const summary = {
    recordedSince: 1,
    retainedSince: 1,
    rows: [
      {
        label: "codex",
        started: 3,
        completed: 3,
        failed: 0,
        interrupted: 0,
        inProgress: 0,
        measuredTurns: 0,
        tokens: null,
      },
    ],
  };
  const getUsage = vi.fn().mockResolvedValue(summary);
  const clearUsage = vi
    .fn()
    .mockRejectedValueOnce(Error("disk"))
    .mockImplementationOnce(async () => {
      getUsage.mockResolvedValue({ ...summary, rows: [] });
    });
  const confirm = vi
    .spyOn(ElMessageBox, "confirm")
    .mockRejectedValueOnce("cancel")
    .mockResolvedValue("confirm" as never);
  setElectronTestClient({ getUsage, clearUsage });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  try {
    const headerActions = wrapper.get(".settings-panel__actions");
    expect(
      headerActions.findAll("button").map((button) => button.text()),
    ).toStrictEqual(["Clear", "Refresh"]);
    const refresh = headerActions.get('[aria-label="Refresh"]');
    const clearButton = headerActions
      .findAll("button")
      .find((button) => button.text() === "Clear")!;
    expect(refresh.classes()).toContain("app-button--secondary");
    expect(clearButton.classes()).toContain("app-button--tertiary");
    expect(wrapper.find(".analytics-data-actions").exists()).toBe(false);
    const clear = () =>
      headerActions
        .findAll("button")
        .find((button) => button.text() === "Clear")!;
    await clear().trigger("click");
    await flushPromises();
    expect(clearUsage).not.toHaveBeenCalled();
    await clear().trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Could not clear");
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain(
      "codex",
    );
    await clear().trigger("click");
    await flushPromises();
    expect(clearUsage).toHaveBeenCalledTimes(2);
    expect(
      wrapper.find('[aria-label="Usage breakdown"] tbody tr').exists(),
    ).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  } finally {
    confirm.mockRestore();
    wrapper.unmount();
  }
});

it("compares the selection with the previous period and still renders when that comparison fails", async () => {
  const row = (started: number) => ({
    label: "codex",
    started,
    completed: started,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
    measuredTurns: 0,
    tokens: null,
  });
  const today = localDay();
  const getUsage = vi.fn(async ({ to }) => ({
    recordedSince: 1,
    retainedSince: 1,
    rows: [row(to === today ? 150 : 100)],
  }));
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  await choose(wrapper, "#usage-measure", "Turns");
  expect(wrapper.get(".hero-delta").text()).toContain("50%");
  expect(wrapper.get(".hero-delta").text()).toContain("previous 7 days");
  getUsage.mockImplementation(async ({ to }) => {
    if (to !== today) throw Error("no history");
    return { recordedSince: 1, retainedSince: 1, rows: [row(150)] };
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Refresh")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find(".hero-delta").exists()).toBe(false);
  expect(wrapper.get(".hero-number").text()).toContain("150");
  wrapper.unmount();
});

it("keeps the activity grid mounted and cached across date/provider loads and failures", async () => {
  const summary = { recordedSince: 1, retainedSince: 1, rows: [], daily: [] };
  const window = activityWindow();
  let delay = false;
  const pending: Array<{
    resolve: (value: typeof summary) => void;
    reject: (error: Error) => void;
  }> = [];
  const getUsage = vi.fn((filter: Record<string, unknown>) => {
    if (!delay || filter.from === window.from) return Promise.resolve(summary);
    return new Promise<typeof summary>((resolve, reject) =>
      pending.push({ resolve, reject }),
    );
  });
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    const activity = wrapper.get(".usage-activity").element;
    const activityCalls = () =>
      getUsage.mock.calls.filter(([filter]) => filter.from === window.from);
    expect(
      wrapper
        .get('.usage-filters [role="radiogroup"]')
        .findAll(".el-segmented__item-label")
        .map((item) => item.text()),
    ).toStrictEqual(["7d", "30d", "90d"]);
    delay = true;
    await choose(wrapper, '.usage-filters [role="radiogroup"]', "30d");
    expect(wrapper.get(".usage-activity").element).toBe(activity);
    await chooseProvider(wrapper, "claude");
    expect(wrapper.get(".usage-activity").element).toBe(activity);
    expect(activityCalls()).toHaveLength(1);
    pending.splice(0).forEach((request) => request.reject(Error("offline")));
    await flushPromises();
    expect(wrapper.get(".usage-activity").element).toBe(activity);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    delay = false;
    await wrapper.get('[aria-label="Refresh"]').trigger("click");
    await flushPromises();
    expect(activityCalls()).toHaveLength(2);
    expect(activityCalls().every(([filter]) => !("provider" in filter))).toBe(
      true,
    );
    expect(wrapper.get(".usage-activity").element).toBe(activity);
  } finally {
    wrapper.unmount();
  }
});

// These client-boundary scenarios protect currency precision, request attribution,
// unknown coverage and comparison honesty through the real Analytics tree.
it("shows weighted input ratios as percentages without stacking model ratios or dividing by zero", async () => {
  const today = localDay();
  const row = (label: string, input: number | null, total: number | null) => ({
    ...costRow(label, null),
    tokens:
      input === null || total === null
        ? null
        : {
            input,
            output: total - input,
            total,
            cacheRead: 0,
            cacheWrite: 0,
          },
  });
  setElectronTestClient({
    getUsage: vi.fn(async (filter) => {
      const rows =
        filter?.group === "provider"
          ? [
              row("claude", 9980, 10000),
              ...(filter.provider === "claude" ? [] : [row("codex", 50, 200)]),
            ]
          : [
              row("model-a", 9980, 10000),
              ...(filter?.provider === "claude"
                ? []
                : [
                    row("model-b", 50, 100),
                    row("model-zero", 0, 100),
                    row("model-empty", 0, 0),
                    row("Unknown", null, null),
                  ]),
            ];
      return {
        recordedSince: 1,
        retainedSince: 1,
        rows,
        daily: [
          {
            day: today,
            started: rows.length,
            measuredTurns: rows.length,
            tokens: null,
            groups: rows,
          },
        ],
      };
    }),
  });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await choose(wrapper, "#usage-token-measure", "Ratio");
    expect(wrapper.get(".hero-number strong").text()).toBe("98.3%");
    expect(wrapper.get(".hero-label").text()).toBe("Input ratio");
    expect(wrapper.find(".hero-delta").exists()).toBe(false);
    expect(
      wrapper
        .get("#usage-measure")
        .findAll("label")
        .filter(
          (option) =>
            option.get<HTMLInputElement>('input[type="radio"]').element.checked,
        )
        .map((option) => option.text()),
    ).toStrictEqual(["Tokens"]);
    const chart = wrapper.get('canvas[aria-label="Activity over time"]');
    expect(
      wrapper.find(`[aria-label="${today} · model-a: 99.8%"]`).exists(),
    ).toBe(true);
    const b = wrapper.get(`[aria-label="${today} · model-b: 50%"]`);
    expect(
      wrapper.find(`[aria-label="${today} · model-zero: 0%"]`).exists(),
    ).toBe(true);
    await b.trigger("focus");
    expect(
      wrapper
        .get(".chart-tooltip")
        .findAll("li")
        .map((item) => item.text()),
    ).toStrictEqual(["model-a99.8%", "model-b50%", "model-zero0%"]);
    expect(wrapper.find(".tooltip-total").exists()).toBe(false);
    expect(wrapper.get('[aria-label="Usage share"] .ring-total').text()).toBe(
      "10.2K",
    );
    expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe(
      "Total tokens",
    );
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain(
      "98%",
    );
    await choose(wrapper, "#usage-grouping", "Provider");
    expect(wrapper.get(".hero-number strong").text()).toBe("98.3%");
    expect(wrapper.find(`[aria-label="${today} · Codex: 25%"]`).exists()).toBe(
      true,
    );
    await chooseProvider(wrapper, "claude");
    await flushPromises();
    expect(wrapper.get(".hero-number strong").text()).toBe("99.8%");
    expect(
      wrapper.find(`[aria-label="${today} · Claude Code: 99.8%"]`).exists(),
    ).toBe(true);
    await choose(wrapper, "#usage-measure", "Cost");
    expect(wrapper.find("#usage-token-measure").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

const costFixture = (usd: number | null, partial = false) => ({
  usd,
  coverage:
    usd === null
      ? ("unavailable" as const)
      : partial
        ? ("partial" as const)
        : ("complete" as const),
  requests: usd === null || partial ? 2 : 1,
  pricedRequests: usd === null ? 0 : 1,
  unpricedRequests: usd === null ? 2 : partial ? 1 : 0,
  unknownRequestExecutions: usd === null || partial ? 1 : 0,
  reasons:
    usd === null || partial
      ? [
          {
            reason: "missing-cache-usage" as const,
            count: usd === null ? 2 : 1,
          },
          { reason: "acp-request-evidence-unavailable" as const, count: 1 },
        ]
      : [],
});
const costRow = (label: string, usd: number | null, partial = false) => ({
  label,
  started: 1,
  completed: 1,
  failed: 0,
  interrupted: 0,
  inProgress: 0,
  measuredTurns: 1,
  tokens: { input: 8, output: 2, total: 10, cacheRead: 0, cacheWrite: 0 },
  cost: costFixture(usd, partial),
});

it("shows Codex execution costs without unavailable request metadata or pricing assumption copy", async () => {
  const cost = {
    usd: 0.25,
    coverage: "complete" as const,
    requests: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    pricedExecutions: 1,
    unknownRequestExecutions: 0,
    reasons: [],
  };
  setElectronTestClient({
    getUsage: vi.fn(async () => ({
      recordedSince: 1,
      retainedSince: 1,
      cost,
      rows: [{ ...costRow("codex", 0.25), cost }],
      daily: [],
    })),
  });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await choose(wrapper, "#usage-measure", "Cost");
    expect(wrapper.get(".hero-number strong").text()).toBe("$0.25");
    expect(wrapper.text()).not.toContain("turn priced");
    expect(wrapper.text()).not.toContain("0 of 0 observed requests");
    expect(wrapper.text()).not.toContain(
      "Runtime request evidence unavailable",
    );
    expect(wrapper.text()).not.toContain("assum");
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).not.toContain(
      "Observed requests",
    );
  } finally {
    wrapper.unmount();
  }
});

it("uses request-attributed USD across model/provider filters, daily charts and shares, then returns to tokens and performance", async () => {
  const today = localDay();
  const yesterday = shiftDay(localDay(), -1);
  const getUsage = vi.fn(async (filter) => {
    const labels =
      filter.group === "model"
        ? ["actual-model-a", "actual-model-b"]
        : ["claude", "codex"];
    const rows = labels.map((label, i) => ({
      ...costRow(label, i ? 0.000002 : 0.000004),
      started: filter.group === "model" ? 0 : 1,
      completed: filter.group === "model" ? 0 : 1,
    }));
    return {
      recordedSince: 1,
      retainedSince: 1,
      cost: { ...costFixture(0.000006), requests: 2, pricedRequests: 2 },
      rows,
      daily: [
        {
          day: yesterday,
          started: 1,
          measuredTurns: 1,
          tokens: null,
          cost: costFixture(0.000004),
          groups: [rows[0]!],
        },
        {
          day: today,
          started: 0,
          measuredTurns: 0,
          tokens: null,
          cost: costFixture(0.000002),
          groups: [{ ...rows[1]!, started: 0, tokens: null }],
        },
      ],
    };
  });
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await choose(wrapper, "#usage-measure", "Cost");
    expect(wrapper.get(".hero-number strong").text()).toBe("$0.00");
    const hero = wrapper.get(".usage-hero");
    expect(hero.text()).not.toContain("API-equivalent");
    expect(hero.text()).not.toContain("Current period");
    expect(hero.text()).not.toContain("Previous period");
    const table = wrapper.get('[aria-label="Usage breakdown"]');
    expect(table.findAll("th").map((cell) => cell.text())).toStrictEqual([
      "Model",
      "Turns",
      "Tokens",
      "Cost",
      "Usage share (tokens)",
    ]);
    const tableRows = () =>
      table
        .findAll("tbody tr")
        .map((row) => row.findAll("td").map((cell) => cell.text()));
    expect(tableRows()).toStrictEqual([
      ["actual-model-a", "0", "10", "$0.00", "50%"],
      ["actual-model-b", "0", "10", "$0.00", "50%"],
    ]);
    expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("66.7%");
    const marker = wrapper.get(
      `[aria-label="${today} · actual-model-b: $0.00"]`,
    );
    await marker.trigger("focus");
    expect(wrapper.get(".chart-tooltip").text()).toContain("$0.00");
    await choose(wrapper, "#usage-grouping", "Provider");
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain(
      "Codex",
    );
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).not.toContain(
      "actual-model-b",
    );
    await chooseProvider(wrapper, "claude");
    await flushPromises();
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", group: "model" }),
    );
    await choose(wrapper, "#usage-measure", "Tokens");
    expect(wrapper.get(".hero-number strong").text()).toBe("20");
    expect(table.findAll("th").map((cell) => cell.text())).toStrictEqual([
      "Provider",
      "Turns",
      "Tokens",
      "Cost",
      "Usage share (tokens)",
    ]);
    expect(tableRows()).toStrictEqual([
      ["Claude Code", "1", "10", "$0.00", "50%"],
      ["Codex", "1", "10", "$0.00", "50%"],
    ]);
    expect(wrapper.find(".cost-coverage").exists()).toBe(false);
    await wrapper.get("#usage-tab-performance").trigger("click");
    expect(wrapper.find('[aria-label="Time to First Token (TTFT)"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Output Speed"]').exists()).toBe(false);
    await wrapper.get("#usage-tab-usage").trigger("click");
    expect(wrapper.get(".hero-number strong").text()).toBe("20");
  } finally {
    wrapper.unmount();
  }
});

it.each([
  { name: "zero", usd: 0, partial: false, expected: "$0.00" },
  { name: "tiny", usd: 0.00000000012, partial: false, expected: "$0.00" },
  {
    name: "rounded total",
    usd: 424.3997,
    partial: false,
    expected: "$424.40",
    hero: "$424",
  },
  { name: "rounded amount", usd: 3.0129, partial: false, expected: "$3.01" },
  { name: "rounded cents", usd: 0.6595, partial: false, expected: "$0.66" },
  { name: "partial", usd: 0.04, partial: true, expected: "$0.04" },
  { name: "unavailable", usd: null, partial: false, expected: "Unavailable" },
  {
    name: "older backend",
    usd: undefined,
    partial: false,
    expected: "Unavailable",
  },
])(
  "distinguishes $name costs without diagnostic copy",
  async ({
    usd,
    partial,
    expected,
    hero,
  }: {
    usd?: number | null;
    partial: boolean;
    expected: string;
    hero?: string;
  }) => {
    const today = localDay();
    setElectronTestClient({
      getUsage: vi.fn(async (filter) => {
        const cost = usd === undefined ? undefined : costFixture(usd, partial);
        const row = { ...costRow("claude", 1), cost };
        const previous = filter.to !== today;
        return {
          recordedSince: 1,
          retainedSince: 1,
          rows: [row],
          cost: previous ? costFixture(null) : cost,
          daily: [
            {
              day: today,
              started: 1,
              measuredTurns: 1,
              tokens: null,
              cost,
              groups: [row],
            },
          ],
        };
      }),
    });
    const wrapper = mount(UsagePanel);
    try {
      await flushPromises();
      await choose(wrapper, "#usage-measure", "Cost");
      expect(wrapper.get(".hero-number strong").text()).toBe(hero ?? expected);
      const table = wrapper.get('[aria-label="Usage breakdown"]');
      expect(table.findAll("tbody td")[3]!.text()).toBe(expected);
      expect(wrapper.find(".hero-delta").exists()).toBe(false);
      expect(wrapper.get(".usage-hero").text()).not.toContain("Current period");
      expect(wrapper.get(".usage-hero").text()).not.toContain(
        "Previous period",
      );
      expect(wrapper.get(".usage-hero").find(".cost-coverage").exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain("unknown request counts");
      expect(wrapper.text()).not.toContain("observed requests priced");
      expect(wrapper.text()).not.toContain("Cache usage");
      expect(wrapper.text()).not.toContain("Runtime request evidence");
      expect(wrapper.text()).not.toContain("Partial");
      if (usd === null || usd === undefined) {
        expect(wrapper.get('[aria-label="Usage share"]').text()).not.toContain(
          "$0",
        );
        expect(
          wrapper.find('canvas[aria-label="Activity over time"]').exists(),
        ).toBe(false);
      }
    } finally {
      wrapper.unmount();
    }
  },
);

it.each([
  { current: costFixture(0.06), previous: costFixture(0.04), delta: "50%" },
  { current: costFixture(0), previous: costFixture(0.04), delta: "100%" },
  {
    current: costFixture(0.06, true),
    previous: costFixture(0.04),
    delta: null,
  },
  {
    current: costFixture(0.06),
    previous: costFixture(0.04, true),
    delta: null,
  },
  { current: costFixture(0.06), previous: costFixture(0), delta: null },
])(
  "compares only complete, nonzero-baseline cost periods ($delta)",
  async ({ current, previous, delta }) => {
    const today = localDay();
    setElectronTestClient({
      getUsage: vi.fn(async (filter) => ({
        recordedSince: 1,
        retainedSince: 1,
        rows: [costRow("claude", current.usd)],
        cost: filter.to === today ? current : previous,
      })),
    });
    const wrapper = mount(UsagePanel);
    try {
      await flushPromises();
      await choose(wrapper, "#usage-measure", "Cost");
      expect(wrapper.find(".hero-delta").exists()).toBe(delta !== null);
      if (delta) expect(wrapper.get(".hero-delta").text()).toContain(delta);
      expect(wrapper.get(".usage-hero").text()).not.toContain(
        "Previous period",
      );
    } finally {
      wrapper.unmount();
    }
  },
);

it("hides unavailable cost tooltip rows and empty days while retaining measured zeroes and chart gaps", async () => {
  const day = (offset: number) => shiftDay(localDay(), -offset);
  const rows = [
    costRow("claude", 0.04),
    costRow("codex", 0),
    costRow("unknown-model", null),
  ];
  const daily = [2, 1, 0].map((offset) => {
    const cost = costFixture(offset === 1 ? null : offset === 0 ? 0 : 0.04);
    return {
      day: day(offset),
      started: 1,
      measuredTurns: 1,
      tokens: null,
      cost,
      groups: [
        { ...rows[0]!, cost },
        ...(offset === 1 ? [] : [rows[1]!]),
        rows[2]!,
      ],
    };
  });
  setElectronTestClient({
    getUsage: vi.fn(async () => ({
      recordedSince: 1,
      retainedSince: 1,
      rows,
      daily,
      cost: costFixture(0.04, true),
    })),
  });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await choose(wrapper, "#usage-measure", "Cost");
    const chart = wrapper.get('canvas[aria-label="Activity over time"]');
    expect(
      wrapper.find(`[aria-label="${day(1)} · claude: $0.00"]`).exists(),
    ).toBe(false);
    await wrapper
      .get(`[aria-label="${day(0)} · claude: $0.00"]`)
      .trigger("focus");
    expect(wrapper.get(".chart-tooltip").text()).toContain("$0.00");
    expect(wrapper.get(".chart-tooltip").findAll("li")).toHaveLength(2);
    expect(wrapper.get(".chart-tooltip").text()).not.toContain("unknown-model");
    expect(wrapper.get(".chart-tooltip").text()).not.toContain("Unavailable");
    const first = wrapper.get(`[aria-label="${day(2)} · claude: $0.04"]`);
    await first.trigger("focus");
    expect(
      wrapper
        .get(".chart-tooltip")
        .findAll("li")
        .map((row) => row.text()),
    ).toStrictEqual(["claude$0.04", "codex$0.00"]);
    expect(wrapper.get(".tooltip-total").text()).toContain("$0.04");
    await chart.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.find(".chart-tooltip").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it("opens Analytics without sharing controls or telemetry requests", async () => {
  const getTelemetryConsent = vi.fn();
  const changeTelemetryConsent = vi.fn();
  const previewTelemetryDay = vi.fn();
  setElectronTestClient({
    getTelemetryConsent,
    changeTelemetryConsent,
    previewTelemetryDay,
  });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    expect(
      wrapper.find('[aria-label="Anonymous usage sharing"]').exists(),
    ).toBe(false);
    expect(getTelemetryConsent).not.toHaveBeenCalled();
    expect(changeTelemetryConsent).not.toHaveBeenCalled();
    expect(previewTelemetryDay).not.toHaveBeenCalled();
  } finally {
    wrapper.unmount();
  }
});

it("groups usage by repository, naming each by its folder", async () => {
  const today = localDay();
  const getUsage = vi.fn(async (filter?: { group?: string }) => {
    const rows =
      filter?.group === "repository"
        ? [
            costRow("/src/korus", 12),
            costRow("/src/website", 3),
            costRow("Unknown", 1),
            costRow("korus:missions", 2),
          ]
        : [costRow("claude", 16)];
    return {
      recordedSince: 1,
      retainedSince: 1,
      rows,
      daily: [
        {
          day: today,
          started: 3,
          measuredTurns: 3,
          tokens: null,
          groups: rows,
        },
      ],
    };
  });
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await choose(wrapper, "#usage-grouping", "Repository");
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({ group: "repository" }),
    );
    const table = wrapper.get('[aria-label="Usage breakdown"]');
    expect(table.findAll("thead th")[0]!.text()).toBe("Repository");
    expect(
      table
        .findAll("tbody tr")
        .map((row) => row.findAll("td")[0]!.text())
        .sort(),
    ).toStrictEqual(["Missions", "Quick chats", "korus", "website"]);
    expect(
      wrapper
        .get('[aria-label="Usage breakdown"]')
        .element.closest("section")!
        .querySelector("h3")!.textContent,
    ).toContain("Repository usage");
  } finally {
    wrapper.unmount();
  }
});

describe("refreshing", () => {
  const usageWith = () =>
    vi.fn(async () => ({
      recordedSince: 1,
      retainedSince: 1,
      rows: [costRow("claude", 1)],
      daily: [],
    }));

  it("catches up when the window comes back after being hidden, and stops listening once closed", async () => {
    const usage = usageWith();
    setElectronTestClient({ getUsage: usage });
    const wrapper = mount(UsagePanel);
    await flushPromises();
    const loaded = usage.mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(usage.mock.calls.length).toBeGreaterThan(loaded);
    wrapper.unmount();
    const closed = usage.mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(usage.mock.calls.length).toBe(closed);
  });
});

it("asks for days in the reader's timezone, for the selection and for the activity grid alike", async () => {
  const getUsage = vi.fn(async () => ({
    recordedSince: 1,
    retainedSince: 1,
    rows: [costRow("claude", 1)],
    daily: [],
  }));
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    expect(getUsage.mock.calls.length).toBeGreaterThan(2);
    for (const [filter] of getUsage.mock.calls as unknown as [
      { timeZone?: string },
    ][])
      expect(filter.timeZone).toBe(browserTimeZone());
  } finally {
    wrapper.unmount();
  }
});
