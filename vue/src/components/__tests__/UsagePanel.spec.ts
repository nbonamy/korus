import { flushPromises, mount } from "@vue/test-utils";
import { it, expect, vi } from "vitest";
import { setElectronTestClient } from "../../test/client";
import UsagePanel from "../UsagePanel.vue";
import { ElMessageBox } from "element-plus";
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
  expect(wrapper.get('[role="rowgroup"]').text()).toContain("Unavailable");
  expect(wrapper.get('[role="rowgroup"]').text()).toContain("0 / 3");
  await wrapper.get("#usage-provider select").setValue("claude");
  await flushPromises();
  expect(getUsage).toHaveBeenCalledWith(
    expect.objectContaining({ group: "provider", provider: "claude" }),
  );
  wrapper.unmount();
});
it("reads account history only on request, keeps large counters exact and presents unsupported account data as unavailable", async () => {
  const getAccountUsage = vi
    .fn()
    .mockResolvedValueOnce({
      summary: {
        lifetimeTokens: "90071992547409931234",
        peakDailyTokens: null,
      },
      dailyUsageBuckets: [
        { startDate: "2026-10-10", tokens: "90071992547409931234" },
      ],
    })
    .mockResolvedValueOnce(null);
  setElectronTestClient({ getAccountUsage });
  const wrapper = mount(UsagePanel);
  await flushPromises();
  expect(getAccountUsage).not.toHaveBeenCalled();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "Load account usage")!
    .trigger("click");
  await flushPromises();
  expect(getAccountUsage).toHaveBeenCalledWith("codex");
  expect(wrapper.text()).toContain("90071992547409931234");
  expect(wrapper.text()).toContain("Unavailable");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "Load account usage")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("Account usage is unavailable");
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
    textStream: known
      ? { characters: 500, durationMs: 1000, messages: 1 }
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
  await wrapper.get("#usage-trend-group select").setValue("model");
  expect(wrapper.get('[aria-label="Activity over time"]').text()).toContain(
    "sonnet",
  );
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain(
    "Claude Code",
  );
  await wrapper.get("#usage-share-group select").setValue("model");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("sonnet");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("75%");
  await wrapper.get("#usage-measure select").setValue("total");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain("100%");
  expect(wrapper.get('[aria-label="Usage share"]').text()).toContain(
    "Unavailable",
  );
  expect(
    wrapper
      .get('[aria-label="Activity over time"]')
      .findAll("rect")
      .filter((r) => r.attributes("aria-label")?.includes("sonnet")).length,
  ).toBe(1);
  expect(getUsage).toHaveBeenCalledTimes(2); // Both projections are loaded once; chart controls do not fetch or mix periods.
  await wrapper
    .findAll('[role="tab"]')
    .find((t) => t.text() === "Model performance")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("500");
  expect(wrapper.text()).toContain("characters/s");
  wrapper.unmount();
});

it("ignores stale filter responses and clears previous statistics when a new query fails", async () => {
  const pending: Array<(value: unknown) => void> = [];
  const getUsage = vi
    .fn()
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  setElectronTestClient({ getUsage });
  const wrapper = mount(UsagePanel);
  await wrapper.get("#usage-provider select").setValue("claude");
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
  pending[2]!(summary("claude"));
  pending[3]!(summary("sonnet"));
  await flushPromises();
  pending[0]!(summary("codex"));
  pending[1]!(summary("Unknown"));
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
    expect(wrapper.text()).toContain("No recorded turns");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  } finally {
    confirm.mockRestore();
    wrapper.unmount();
  }
});
