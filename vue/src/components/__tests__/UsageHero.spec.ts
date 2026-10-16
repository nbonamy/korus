import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import UsageHero from "../UsageHero.vue";

it("compacts large turn totals in the hero", () => {
  const total = 19_223_027;
  const group = {
    label: "claude",
    started: total,
    measuredTurns: 0,
    tokens: null,
  };
  const row = {
    ...group,
    completed: total,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
  };
  const daily = [
    {
      day: "2026-06-30",
      started: total,
      measuredTurns: 0,
      tokens: null,
      groups: [group],
    },
  ];
  const wrapper = mount(UsageHero, {
    props: {
      series: [
        {
          key: "claude",
          label: "Claude",
          color: "blue",
          value: total,
          turns: total,
          tokens: null,
        },
      ],
      daily,
      measure: "turns",
      trendGroup: "provider",
      from: "2026-06-30",
      to: "2026-06-30",
      periodDays: 1,
      current: { recordedSince: 0, retainedSince: 0, rows: [row], daily },
      previous: null,
    },
  });

  expect(wrapper.get(".hero-number strong").text()).toBe("19.2M");
  wrapper.unmount();
});
