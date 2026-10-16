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
  expect(wrapper.get('#usage-grouping [role="radiogroup"]').attributes("aria-label")).toBe("Group by");
  await choose(wrapper, "#usage-grouping", "Provider");
  for (const label of ["Usage share", "Activity over time", "Usage breakdown"])
    expect(wrapper.get(`[aria-label="${label}"]`).text()).toContain("Claude Code");
  await choose(wrapper, "#usage-grouping", "Model");
  await choose(wrapper, "#usage-measure", "Turns");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("75%");
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
