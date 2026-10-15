import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import UsageStatTiles from "../UsageStatTiles.vue";

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
  expect(wrapper.findAll(".sparkline .spark-line")).toHaveLength(2);
});
