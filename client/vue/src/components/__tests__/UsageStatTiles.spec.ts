import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import UsageStatTiles from "../UsageStatTiles.vue";
const cost = (usd: number | null) => ({
  usd,
  coverage: usd === null ? ("unavailable" as const) : ("complete" as const),
  requests: 1,
  pricedRequests: usd === null ? 0 : 1,
  unpricedRequests: usd === null ? 1 : 0,
  unknownRequestExecutions: 0,
  reasons: [],
});

it("includes late activity in sparklines for the whole custom range", () => {
  const wrapper = mount(UsageStatTiles, {
    props: {
      from: "2026-01-01",
      to: "2026-06-30",
      periodDays: 181,
      summary: {
        recordedSince: 0,
        retainedSince: 0,
        rows: [],
        daily: [
          {
            day: "2026-06-30",
            started: 1,
            measuredTurns: 1,
            cost: cost(7),
            tokens: {
              input: 8,
              output: 2,
              total: 10,
              cacheRead: 0,
              cacheWrite: 0,
            },
          },
        ],
      },
    },
  });
  expect(wrapper.findAll(".sparkline .spark-line")).toHaveLength(3);
});

it("shows daily turn, token and cost averages across the selected period, preserving free and unavailable costs", async () => {
  const wrapper = mount(UsageStatTiles, {
    props: {
      from: "2026-06-24",
      to: "2026-06-30",
      periodDays: 7,
      summary: {
        recordedSince: 0,
        retainedSince: 0,
        cost: cost(49),
        rows: [
          {
            label: "claude",
            started: 19_223_027 * 7,
            completed: 19_223_027 * 7,
            failed: 0,
            interrupted: 0,
            inProgress: 0,
            measuredTurns: 1,
            tokens: {
              input: 30_000_000,
              output: 7_100_000,
              total: 37_100_000,
              cacheRead: 0,
              cacheWrite: 0,
            },
          },
        ],
        daily: [],
      },
    },
  });

  expect(wrapper.find(".usage-stat__value").text()).toBe("19.2M");
  const tokens = wrapper.findAll(".usage-stat")[1]!;
  expect(tokens.get(".usage-stat__label").text()).toBe("Tokens per day");
  expect(tokens.get(".usage-stat__value").text()).toBe("5.3M");
  const spending = wrapper.findAll(".usage-stat")[2]!;
  expect(spending.get(".usage-stat__label").text()).toBe("Cost per day");
  expect(spending.get(".usage-stat__value").text()).toBe("$7.00");
  await wrapper.setProps({ from: "2026-06-30", periodDays: 1 });
  expect(tokens.get(".usage-stat__value").text()).toBe("37.1M");
  expect(spending.get(".usage-stat__value").text()).toBe("$49.00");
  await wrapper.setProps({
    summary: { ...wrapper.props("summary"), cost: cost(0) },
  });
  expect(spending.get(".usage-stat__value").text()).toBe("$0.00");
  await wrapper.setProps({
    summary: { ...wrapper.props("summary"), cost: cost(null) },
  });
  expect(spending.get(".usage-stat__value").text()).toBe("Unavailable");
  wrapper.unmount();
});
