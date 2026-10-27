import { flushPromises, mount } from "@vue/test-utils";
import { it, expect, vi } from "vitest";
import { setElectronTestClient } from "../../test/client";
import UsagePanel from "../UsagePanel.vue";
import { ElMessageBox } from "element-plus";
import { activityWindow } from "../usage-chart";

it.each(["unmeasured", "partial", "unavailable"])(
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
    expect(
      wrapper.findAll(".activity-totals dd").map((value) => value.text()),
    ).toStrictEqual(
      state === "partial" ? ["10", "10"] : ["N/A", "N/A"],
    );
    await wrapper
      .findAll(".activity-cell:not(.activity-cell--future)")
      .at(-1)!
      .trigger("pointerenter");
    expect(wrapper.get(".activity-tooltip strong").text()).toBe(
      state === "partial" ? "10 tokens" : "N/A",
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
const chooseProvider = async (wrapper: ReturnType<typeof mount>, value: string) =>
  wrapper
    .getComponent({ name: "ElSelect" })
    .vm.$emit("update:modelValue", value);

it("plots daily model output rates without stacking or treating missing measurements as zero", async () => {
  const day = (offset: number) =>
    new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  const row = (label: string, outputTokens: number, generationMs: number) => ({
    label,
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
    rows: [row("sonnet", 300, 8000), row("gpt-6-luna", 250, 10000)],
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
  const getUsage = vi.fn(async () => summary);
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "Model performance")!
      .trigger("click");
    const chart = wrapper.get('svg[aria-label="Output speed over time"]');
    const sonnet = chart.get(`[aria-label="${day(2)} · sonnet: 25 tokens/s"]`);
    const gpt = chart.get(`[aria-label="${day(2)} · gpt-6-luna: 25 tokens/s"]`);
    expect(sonnet.attributes("cy")).toBe(gpt.attributes("cy"));
    expect(chart.findAll("circle")).toHaveLength(3);
    await sonnet.trigger("focus");
    expect(wrapper.get(".chart-tooltip").text()).toContain("25 tokens/s");
    expect(wrapper.get(".chart-tooltip").text()).not.toContain("Total");
    const latest = chart.get(`[aria-label="${day(0)} · sonnet: 50 tokens/s"]`);
    chart.element.dispatchEvent(
      new MouseEvent("pointermove", {
        clientX:
          (Number(sonnet.attributes("cx")) + Number(latest.attributes("cx"))) /
          2,
      }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".chart-tooltip").text()).toContain("N/A");
    expect(chart.findAll("path.layer")).toHaveLength(0);
    // Isolated observations remain points; no line crosses the unmeasured day.
    expect(
      chart
        .findAll("path.edge")
        .every((path) => !path.attributes("d")?.includes("C")),
    ).toBe(true);
    await chooseProvider(wrapper, "claude");
    await flushPromises();
    expect(getUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", group: "model" }),
    );
    getUsage.mockResolvedValue({ ...summary, rows: [], daily: [] });
    await wrapper.get('[aria-label="Refresh"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.find('svg[aria-label="Output speed over time"]').exists(),
    ).toBe(false);
    expect(
      wrapper.get('[aria-label="Output speed over time"]').text(),
    ).toContain("N/A");
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
  expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain(
    "N/A",
  );
  expect(wrapper.find('[role="meter"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain("0 of 3 turns measured");
  await chooseProvider(wrapper, "claude");
  await flushPromises();
  expect(getUsage).toHaveBeenCalledWith(
    expect.objectContaining({ group: "provider", provider: "claude" }),
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
          day: new Date().toISOString().slice(0, 10),
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
  expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe("Total tokens");
  for (const label of ["Usage share", "Activity over time", "Usage breakdown"])
    expect(wrapper.get(`[aria-label="${label}"]`).text()).toContain("sonnet");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("100%");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("N/A");
  expect(wrapper.get('#usage-measure').findAll('label').map(option => option.text())).toStrictEqual([
    'Turns', 'Tokens', 'Cost',
  ]);
  expect(wrapper.get('#usage-token-measure').findAll('label').map(option => option.text())).toStrictEqual([
    'Total', 'Input', 'Output', 'Ratio',
  ]);
  await choose(wrapper, '#usage-token-measure', 'Input');
  expect(wrapper.get('.hero-number strong').text()).toBe('200');
  expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe('Input tokens');
  expect(wrapper.get('#usage-measure').findAll('label')
    .filter(option => option.get<HTMLInputElement>('input[type="radio"]').element.checked)
    .map(option => option.text())).toStrictEqual(['Tokens']);
  await choose(wrapper, '#usage-token-measure', 'Output');
  expect(wrapper.get('.hero-number strong').text()).toBe('100');
  expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe('Output tokens');
  await choose(wrapper, '#usage-measure', 'Cost');
  expect(wrapper.find('#usage-token-measure').exists()).toBe(false);
  await choose(wrapper, '#usage-measure', 'Tokens');
  expect(wrapper.get('.hero-number strong').text()).toBe('300');
  expect(wrapper.get('#usage-token-measure').findAll('label')
    .filter(option => option.get<HTMLInputElement>('input[type="radio"]').element.checked)
    .map(option => option.text())).toStrictEqual(['Total']);
  expect(wrapper.get('#usage-grouping [role="radiogroup"]').attributes("aria-label")).toBe("Group by");
  await choose(wrapper, "#usage-grouping", "Provider");
  for (const label of ["Usage share", "Activity over time", "Usage breakdown"])
    expect(wrapper.get(`[aria-label="${label}"]`).text()).toContain("Claude Code");
  await choose(wrapper, "#usage-grouping", "Model");
  await choose(wrapper, "#usage-measure", "Turns");
  expect(wrapper.find('#usage-token-measure').exists()).toBe(false);
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("75%");
  expect(wrapper.get('[aria-label="Usage breakdown"]').findAll("tbody tr").map(row =>
    row.findAll("td").map(cell => cell.text()))).toStrictEqual([
    ["sonnet", "1", "300", "Unavailable", "100%"],
    ["Unknown model", "3", "N/A", "Unavailable", "N/A"],
  ]);
  expect(
    wrapper
      .get('[aria-label="Activity over time"]')
      .findAll("circle")
      .filter((r) => r.attributes("aria-label")?.includes("sonnet")).length,
  ).toBe(1);
  expect(getUsage).toHaveBeenCalledTimes(4); // Both projections, the activity window and the comparison period load once; chart controls do not fetch or mix periods.
  await wrapper
    .findAll('[role="tab"]')
    .find((t) => t.text() === "Model performance")!
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
  expect(ttft.findAll("thead th").map((heading) => heading.text())).toStrictEqual([
    "Model",
    "sec",
  ]);
  expect(speed.findAll("thead th").map((heading) => heading.text())).toStrictEqual([
    "Model",
    "tok/sec",
  ]);
  expect(ttft.find("tbody tr").findAll("td").map((cell) => cell.text())).toStrictEqual([
    "sonnet",
    "1.5",
  ]);
  expect(
    speed.find("tbody tr").text(),
  ).toContain("sonnet");
  expect(
    totals.findAll(".usage-stat__unit").map((unit) => unit.text()),
  ).toStrictEqual(["s", "tokens/s"]);
  expect(totals.text()).not.toContain("Timed turns");
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
    .find((tab) => tab.text() === "Model performance")!
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
  expect(ttftRows[1]?.get(".value-fill").attributes("style")).toContain("width: 50%");
  expect(ttftRows[1]?.get(".value-fill").attributes("style")).toContain("var(--chart-2)");
  expect(ttftRows[2]?.get(".value-fill").attributes("style")).toContain("width: 100%");
  expect(ttftRows[2]?.get(".value-fill").attributes("style")).toContain("var(--chart-1)");
  expect(speedRows[0]?.get(".value-fill").attributes("style")).toContain(
    "width: 100%",
  );
  expect(speedRows[0]?.get(".value-fill").attributes("style")).toContain(
    "var(--chart-1)",
  );
  expect(speedRows[1]?.get(".value-fill").attributes("style")).toContain("width: 50%");
  expect(speedRows[1]?.get(".value-fill").attributes("style")).toContain("var(--chart-2)");
  expect(speedRows[2]?.get(".value-fill").attributes("style")).toContain("width: 25%");
  expect(speedRows[2]?.get(".value-fill").attributes("style")).toContain("var(--chart-3)");
  expect(ttft.text()).not.toContain("Samples");
  expect(speed.text()).not.toContain("Timed turns");
  wrapper.unmount();
});

it("keeps TTFT available and shows N/A when speed is unavailable", async () => {
  const summary = {
    recordedSince: 1,
    retainedSince: 1,
    rows: [{
      label: "gpt-6-luna",
      started: 1,
      completed: 1,
      failed: 0,
      interrupted: 0,
      inProgress: 0,
      measuredTurns: 0,
      tokens: null,
      speed: {
        turns: 0,
        outputTokens: 0,
        generationMs: 0,
        ttftMs: 56800,
        ttftTurns: 1,
      },
    }],
  };
  setElectronTestClient({ getUsage: vi.fn(async () => summary) });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  await wrapper
    .findAll('[role="tab"]')
    .find((t) => t.text() === "Model performance")!
    .trigger("click");
  await flushPromises();
  const ttft = wrapper.get('[aria-label="Time to First Token (TTFT)"]');
  const speed = wrapper.get('[aria-label="Output Speed"]');
  expect(ttft.findAll("tbody tr")[0]?.findAll("td").map((cell) => cell.text())).toStrictEqual([
    "gpt-6-luna",
    "56.8",
  ]);
  expect(speed.findAll("tbody tr")[0]?.findAll("td").map((cell) => cell.text())).toStrictEqual([
    "gpt-6-luna",
    "N/A",
  ]);
  expect(speed.text()).not.toContain("A turn is timed only");
  wrapper.unmount();
});

it("ignores stale filter responses and clears previous statistics when a new query fails", async () => {
  const pending: Array<(value: unknown) => void> = [];
  const getUsage = vi
    .fn()
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
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
  pending[4]!(summary("claude"));
  pending[5]!(summary("sonnet"));
  pending[6]!(summary("claude"));
  pending[7]!(summary("claude"));
  await flushPromises();
  pending[0]!(summary("codex"));
  pending[1]!(summary("Unknown"));
  pending[2]!(summary("codex"));
  pending[3]!(summary("codex"));
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
  const today = new Date().toISOString().slice(0, 10);
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

it("keeps the activity grid outside the provider and date filters", async () => {
  const empty = { recordedSince: 1, retainedSince: 1, rows: [] };
  const getUsage = vi.fn(async (_filter: Record<string, unknown>) => empty);
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  await chooseProvider(wrapper, "claude");
  await flushPromises();
  const window = activityWindow();
  const activityCalls = getUsage.mock.calls.filter(
    ([filter]) => filter.from === window.from,
  );
  expect(activityCalls.length).toBeGreaterThan(1);
  expect(activityCalls.every(([filter]) => !("provider" in filter))).toBe(true);
  wrapper.unmount();
});

// These client-boundary scenarios protect currency precision, request attribution,
// unknown coverage and comparison honesty through the real Analytics tree.
it("shows weighted input ratios as percentages without stacking model ratios or dividing by zero", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const row = (label: string, input: number | null, total: number | null) => ({
    ...costRow(label, null),
    tokens: input === null || total === null ? null : {
      input, output: total - input, total, cacheRead: 0, cacheWrite: 0,
    },
  });
  setElectronTestClient({ getUsage: vi.fn(async filter => {
    const rows = filter?.group === "provider"
      ? [row("claude", 9980, 10000), ...(filter.provider === "claude" ? [] : [row("codex", 50, 200)])]
      : [row("model-a", 9980, 10000), ...(filter?.provider === "claude" ? [] : [
          row("model-b", 50, 100), row("model-zero", 0, 100), row("model-empty", 0, 0), row("Unknown", null, null),
        ])];
    return { recordedSince: 1, retainedSince: 1, rows, daily: [{
      day: today, started: rows.length, measuredTurns: rows.length,
      tokens: null, groups: rows,
    }] };
  }) });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await choose(wrapper, "#usage-token-measure", "Ratio");
    expect(wrapper.get(".hero-number strong").text()).toBe("98.3%");
    expect(wrapper.get(".hero-label").text()).toBe("Input ratio");
    expect(wrapper.find(".hero-delta").exists()).toBe(false);
    expect(wrapper.get("#usage-measure").findAll("label")
      .filter(option => option.get<HTMLInputElement>('input[type="radio"]').element.checked)
      .map(option => option.text())).toStrictEqual(["Tokens"]);
    const chart = wrapper.get('svg[aria-label="Activity over time"]');
    expect(chart.findAll("path.layer")).toHaveLength(0);
    expect(chart.findAll(".gridline text").map(tick => tick.text())).toStrictEqual(["0%", "25%", "50%", "75%", "100%"]);
    const a = chart.get(`[aria-label="${today} · model-a: 99.8%"]`);
    const b = chart.get(`[aria-label="${today} · model-b: 50%"]`);
    const zero = chart.get(`[aria-label="${today} · model-zero: 0%"]`);
    expect(Number(a.attributes("cy"))).toBeLessThan(Number(b.attributes("cy")));
    expect(Number(b.attributes("cy"))).toBeLessThan(Number(zero.attributes("cy")));
    await b.trigger("focus");
    expect(wrapper.get(".chart-tooltip").findAll("li").map(item => item.text())).toStrictEqual([
      "model-zero0%", "model-b50%", "model-a99.8%",
    ]);
    expect(wrapper.find(".tooltip-total").exists()).toBe(false);
    expect(wrapper.get('[aria-label="Usage share"] .ring-total').text()).toBe("10.2K");
    expect(wrapper.get('[aria-label="Usage share"] p').text()).toBe("Total tokens");
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain("98%");
    await choose(wrapper, "#usage-grouping", "Provider");
    expect(wrapper.get(".hero-number strong").text()).toBe("98.3%");
    expect(wrapper.find(`[aria-label="${today} · Codex: 25%"]`).exists()).toBe(true);
    await chooseProvider(wrapper, "claude");
    await flushPromises();
    expect(wrapper.get(".hero-number strong").text()).toBe("99.8%");
    const ticks = wrapper.get('svg[aria-label="Activity over time"]').findAll(".gridline text").map(tick => tick.text());
    expect(parseFloat(ticks[0]!)).toBeGreaterThan(99);
    expect(parseFloat(ticks.at(-1)!)).toBeLessThanOrEqual(100);
    expect(new Set(ticks).size).toBe(ticks.length);
    await choose(wrapper, "#usage-measure", "Cost");
    expect(wrapper.find("#usage-token-measure").exists()).toBe(false);
  } finally { wrapper.unmount(); }
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
          { reason: "missing-cache-usage" as const, count: usd === null ? 2 : 1 },
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

it('shows Codex execution costs without unavailable request metadata or pricing assumption copy', async () => {
  const cost = { usd: 0.25, coverage: 'complete' as const, requests: 0, pricedRequests: 0,
    unpricedRequests: 0, pricedExecutions: 1, unknownRequestExecutions: 0, reasons: [] };
  setElectronTestClient({ getUsage: vi.fn(async () => ({ recordedSince: 1, retainedSince: 1,
    cost, rows: [{ ...costRow('codex', 0.25), cost }], daily: [] })) });
  const wrapper = mount(UsagePanel);
  try {
    await flushPromises();
    await choose(wrapper, '#usage-measure', 'Cost');
    expect(wrapper.get('.hero-number strong').text()).toBe('$0.25');
    expect(wrapper.text()).not.toContain('turn priced');
    expect(wrapper.text()).not.toContain('0 of 0 observed requests');
    expect(wrapper.text()).not.toContain('Runtime request evidence unavailable');
    expect(wrapper.text()).not.toContain('assum');
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).not.toContain('Observed requests');
  } finally { wrapper.unmount(); }
});

it("uses request-attributed USD across model/provider filters, daily charts and shares, then returns to tokens and performance", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
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
    const hero = wrapper.get('.usage-hero');
    expect(hero.text()).not.toContain('API-equivalent');
    expect(hero.text()).not.toContain('Current period');
    expect(hero.text()).not.toContain('Previous period');
    const table = wrapper.get('[aria-label="Usage breakdown"]');
    expect(table.findAll("th").map(cell => cell.text())).toStrictEqual([
      "Model", "Turns", "Tokens", "Cost", "Usage share (tokens)",
    ]);
    const tableRows = () => table.findAll("tbody tr").map(row => row.findAll("td").map(cell => cell.text()));
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
    // Sub-cent values must occupy a meaningful part of the chart, not hug zero.
    expect(Number(marker.attributes("cy"))).toBeLessThan(240);
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
    expect(table.findAll("th").map(cell => cell.text())).toStrictEqual([
      "Provider", "Turns", "Tokens", "Cost", "Usage share (tokens)",
    ]);
    expect(tableRows()).toStrictEqual([
      ["Claude Code", "1", "10", "$0.00", "50%"],
      ["Codex", "1", "10", "$0.00", "50%"],
    ]);
    expect(wrapper.find(".cost-coverage").exists()).toBe(false);
    await wrapper.get("#usage-tab-performance").trigger("click");
    expect(wrapper.find('[aria-label="Output Speed"]').exists()).toBe(true);
    await wrapper.get("#usage-tab-usage").trigger("click");
    expect(wrapper.get(".hero-number strong").text()).toBe("20");
  } finally {
    wrapper.unmount();
  }
});

it.each([
  { name: "zero", usd: 0, partial: false, expected: "$0.00" },
  { name: "tiny", usd: 0.00000000012, partial: false, expected: "$0.00" },
  { name: "rounded total", usd: 424.3997, partial: false, expected: "$424.40", hero: "$424" },
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
  async ({ usd, partial, expected, hero }: { usd?: number | null; partial: boolean; expected: string; hero?: string }) => {
    const today = new Date().toISOString().slice(0, 10);
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
      expect(wrapper.get('.usage-hero').text()).not.toContain('Current period');
      expect(wrapper.get('.usage-hero').text()).not.toContain('Previous period');
      expect(wrapper.get('.usage-hero').find('.cost-coverage').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('unknown request counts');
      expect(wrapper.text()).not.toContain('observed requests priced');
      expect(wrapper.text()).not.toContain('Cache usage');
      expect(wrapper.text()).not.toContain('Runtime request evidence');
      expect(wrapper.text()).not.toContain('Partial');
      if (usd === null || usd === undefined) {
        expect(wrapper.get('[aria-label="Usage share"]').text()).not.toContain(
          "$0",
        );
        expect(
          wrapper.find('svg[aria-label="Activity over time"]').exists(),
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
    const today = new Date().toISOString().slice(0, 10);
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
      expect(wrapper.get('.usage-hero').text()).not.toContain('Previous period');
    } finally {
      wrapper.unmount();
    }
  },
);

it("hides unavailable cost tooltip rows and empty days while retaining measured zeroes and chart gaps", async () => {
  const day = (offset: number) =>
    new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
  const rows = [costRow("claude", 0.04), costRow("codex", 0), costRow("unknown-model", null)];
  const daily = [2, 1, 0].map((offset) => {
    const cost = costFixture(offset === 1 ? null : offset === 0 ? 0 : 0.04);
    return {
      day: day(offset),
      started: 1,
      measuredTurns: 1,
      tokens: null,
      cost,
      groups: [{ ...rows[0]!, cost }, ...(offset === 1 ? [] : [rows[1]!]), rows[2]!],
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
    const chart = wrapper.get('svg[aria-label="Activity over time"]');
    expect(
      chart
        .findAll("path.edge")
        .every((p) => !p.attributes("d")?.includes("C")),
    ).toBe(true);
    await chart
      .get(`[aria-label="${day(0)} · claude: $0.00"]`)
      .trigger("focus");
    expect(wrapper.get(".chart-tooltip").text()).toContain("$0.00");
    expect(wrapper.get(".chart-tooltip").findAll("li")).toHaveLength(2);
    expect(wrapper.get(".chart-tooltip").text()).not.toContain("unknown-model");
    expect(wrapper.get(".chart-tooltip").text()).not.toContain("Unavailable");
    const first = chart.get(`[aria-label="${day(2)} · claude: $0.04"]`);
    const last = chart.get(`[aria-label="${day(0)} · claude: $0.00"]`);
    await first.trigger("focus");
    expect(wrapper.get(".chart-tooltip").findAll("li").map(row => row.text())).toStrictEqual([
      "codex$0.00", "claude$0.04",
    ]);
    expect(wrapper.get(".tooltip-total").text()).toContain("$0.04");
    chart.element.dispatchEvent(
      new MouseEvent("pointermove", {
        clientX:
          (Number(first.attributes("cx")) + Number(last.attributes("cx"))) / 2,
      }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".chart-tooltip").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});
