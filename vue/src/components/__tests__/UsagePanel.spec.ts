import { flushPromises, mount } from "@vue/test-utils";
import { it, expect, vi } from "vitest";
import { setElectronTestClient } from "../../test/client";
import UsagePanel from "../UsagePanel.vue";
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
  await wrapper.findAll("select")[1]!.setValue("claude");
  await flushPromises();
  expect(getUsage).toHaveBeenLastCalledWith({
    group: "provider",
    provider: "claude",
  });
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
