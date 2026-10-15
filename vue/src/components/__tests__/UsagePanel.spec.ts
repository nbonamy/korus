import { flushPromises, mount } from "@vue/test-utils";
import { it, expect, vi } from "vitest";
import { setElectronTestClient } from "../../test/client";
import UsagePanel from "../UsagePanel.vue";
import { ElMessageBox } from "element-plus";
const choose = async (
  wrapper: ReturnType<typeof mount>,
  group: string,
  label: string,
) =>
  wrapper
    .get(group)
    .findAll('[role="radio"]')
    .find((option) => option.text() === label)!
    .trigger("click");
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
    "Unavailable",
  );
  expect(wrapper.text()).toContain("0 of 3 turns measured");
  await choose(wrapper, "#usage-provider", "Claude Code");
  await flushPromises();
  expect(getUsage).toHaveBeenCalledWith(
    expect.objectContaining({ group: "provider", provider: "claude" }),
  );
  wrapper.unmount();
});
it("changes each chart breakdown independently and shares the selected token measure", async () => {
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
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain(
    "Claude Code",
  );
  expect(wrapper.get('[aria-label="Activity over time"]').text()).toContain(
    "Claude Code",
  );
  await choose(wrapper, "#usage-trend-group", "Model");
  expect(wrapper.get('[aria-label="Activity over time"]').text()).toContain(
    "sonnet",
  );
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain(
    "Claude Code",
  );
  await choose(wrapper, "#usage-share-group", "Model");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("sonnet");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("75%");
  await choose(wrapper, "#usage-measure", "Total");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("100%");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain(
    "Unavailable",
  );
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
  expect(wrapper.text()).toContain("tokens/s");
  expect(wrapper.text()).toContain("1.5 s to first token");
  expect(wrapper.text()).toContain("excluding time spent waiting");
  expect(wrapper.text()).not.toContain("Account usage");
  wrapper.unmount();
});

it("ignores stale filter responses and clears previous statistics when a new query fails", async () => {
  const pending: Array<(value: unknown) => void> = [];
  const getUsage = vi
    .fn()
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await choose(wrapper, "#usage-provider", "Claude Code");
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
    "Claude",
  );
  expect(wrapper.get('[aria-label="Usage breakdown"]').text()).not.toContain(
    "Codex",
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
    expect(wrapper.text()).not.toContain("Local only");
    expect(wrapper.find("footer").exists()).toBe(false);
    const clear = () =>
      wrapper
        .findAll("button")
        .find((button) => button.text() === "Clear statistics")!;
    await clear().trigger("click");
    await flushPromises();
    expect(clearUsage).not.toHaveBeenCalled();
    await clear().trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("Could not clear");
    expect(wrapper.get('[aria-label="Usage breakdown"]').text()).toContain(
      "Codex",
    );
    await clear().trigger("click");
    await flushPromises();
    expect(clearUsage).toHaveBeenCalledTimes(2);
    expect(
      wrapper.find('[aria-label="Usage breakdown"] tbody tr').exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain("No recorded turns");
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
