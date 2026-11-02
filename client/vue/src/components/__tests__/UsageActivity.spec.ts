import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import UsageActivity from "../UsageActivity.vue";
import { ACTIVITY_WEEKS, activityWindow } from "../usage-chart";

const day = (offset: number) =>
  new Date(Date.parse(activityWindow().to) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
const stat = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper
    .findAll(".usage-stat")
    .find((card) => card.text().includes(label))!
    .get(".usage-stat__value")
    .text();
const levels = (wrapper: ReturnType<typeof mount>) =>
  wrapper
    .findAll(".activity-cell:not(.activity-cell--future)")
    .map((cell) => Number(cell.attributes("data-level")));

it("lays out whole weeks ending today and shades each day by its share of the retained activity", () => {
  const wrapper = mount(UsageActivity, {
    props: {
      days: [
        { day: day(-3), tokens: 10 },
        { day: day(-2), tokens: 20 },
        { day: day(-1), tokens: 30 },
        { day: day(0), tokens: 1000 },
      ],
    },
  });
  const all = wrapper.findAll(".activity-cell");
  expect(all).toHaveLength(ACTIVITY_WEEKS * 7);
  // Only days up to today are drawn; the rest of the current week is hidden.
  const drawn = levels(wrapper);
  expect(drawn.slice(-4)).toStrictEqual([1, 2, 3, 4]);
  expect(drawn.slice(0, -4).every((level) => level === 0)).toBe(true);
  expect(wrapper.get('[role="img"]').attributes("aria-label")).toContain(
    "1.1K",
  );
  wrapper.unmount();
});

it("reports measured totals and keeps an empty activity window at zero", async () => {
  const wrapper = mount(UsageActivity, {
    props: {
      days: [
        { day: day(-5), tokens: 1500 },
        { day: day(-2), tokens: 4000 },
        { day: day(0), tokens: 500 },
      ],
    },
  });
  const totals = wrapper.get(".activity-stats").text();
  expect(totals).toContain("Lifetime total");
  expect(totals).toContain("6K");
  expect(totals).toContain("Peak day");
  expect(totals).toContain("4K");
  await wrapper.setProps({ days: [] });
  expect(stat(wrapper, "Lifetime total")).toBe("0");
  expect(stat(wrapper, "Peak day")).toBe("0");
  wrapper.unmount();
});

it("describes a hovered day and hides the tooltip again on leave", async () => {
  const wrapper = mount(UsageActivity, {
    props: { days: [{ day: day(0), tokens: 2500 }] },
  });
  const today = wrapper
    .findAll(".activity-cell:not(.activity-cell--future)")
    .at(-1)!;
  expect(wrapper.find(".activity-tooltip").exists()).toBe(false);
  await today.trigger("pointerenter");
  expect(wrapper.get(".activity-tooltip").text()).toContain("2.5K tokens");
  await today.trigger("pointerleave");
  expect(wrapper.find(".activity-tooltip").exists()).toBe(false);
  wrapper.unmount();
});

it("shows only the most recent weeks that fit a narrow width while totals still cover everything retained", async () => {
  let notify: ((width: number) => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: unknown[]) => void) {
        notify = (width) => callback([{ contentRect: { width } }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  const wrapper = mount(UsageActivity, {
    props: {
      days: [
        { day: day(-300), tokens: 7000 },
        { day: day(0), tokens: 1000 },
      ],
    },
  });
  notify!(280);
  await wrapper.vm.$nextTick();
  // 280px fits 31 weeks at 6px cells and 3px gaps.
  expect(wrapper.findAll(".activity-cell")).toHaveLength(31 * 7);
  expect(wrapper.get(".activity-stats").text()).toContain("8K");
  expect(levels(wrapper).at(-1)).toBe(1);
  notify!(5000);
  await wrapper.vm.$nextTick();
  expect(wrapper.findAll(".activity-cell")).toHaveLength(ACTIVITY_WEEKS * 7);
  wrapper.unmount();
  vi.unstubAllGlobals();
});

it("shows the longest task and the longest streak of consecutive active days", async () => {
  const wrapper = mount(UsageActivity, {
    props: {
      longestTurnMs: 252000,
      days: [
        { day: day(-9), tokens: 5 },
        { day: day(-5), tokens: 5 },
        { day: day(-4), tokens: 5 },
        { day: day(-3), tokens: 5 },
        { day: day(-2), tokens: 0 },
        { day: day(-1), tokens: 5 },
        { day: day(0), tokens: 5 },
      ],
    },
  });
  expect(stat(wrapper, "Longest task")).toBe("4m 12s");
  expect(stat(wrapper, "Longest streak")).toBe("3 days");
  await wrapper.setProps({ longestTurnMs: 45000 });
  expect(stat(wrapper, "Longest task")).toBe("45s");
  await wrapper.setProps({ longestTurnMs: 3900000 });
  expect(stat(wrapper, "Longest task")).toBe("1h 5m");
  await wrapper.setProps({ longestTurnMs: null });
  expect(stat(wrapper, "Longest task")).toBe("N/A");
  await wrapper.setProps({ days: [{ day: day(0), tokens: 1 }] });
  expect(stat(wrapper, "Longest streak")).toBe("1 day");
  wrapper.unmount();
});

it("switches to a weekly view that stacks squares by each week's share of the busiest week", async () => {
  const wrapper = mount(UsageActivity, {
    props: {
      days: [
        { day: day(-14), tokens: 100 },
        { day: day(-13), tokens: 100 },
        { day: day(0), tokens: 1000 },
      ],
    },
  });
  expect(wrapper.find(".activity-week").exists()).toBe(false);
  const tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.map((tab) => tab.text())).toStrictEqual(["Daily", "Weekly"]);
  expect(tabs[0].attributes("aria-selected")).toBe("true");
  await tabs[1].trigger("click");
  expect(tabs[1].attributes("aria-selected")).toBe("true");
  expect(wrapper.find(".activity-cell").exists()).toBe(false);
  const weeks = wrapper.findAll(".activity-week");
  expect(weeks).toHaveLength(ACTIVITY_WEEKS);
  const filled = (week: (typeof weeks)[number]) =>
    week.findAll(".activity-square[data-filled]").length;
  // The busiest week fills the column; a lighter week keeps at least one square.
  expect(filled(weeks.at(-1)!)).toBe(7);
  expect(filled(weeks.at(-3)!)).toBeGreaterThanOrEqual(1);
  expect(filled(weeks.at(-3)!)).toBeLessThan(7);
  expect(filled(weeks.at(-2)!)).toBe(0);
  await weeks.at(-1)!.trigger("pointerenter");
  expect(wrapper.get(".activity-tooltip").text()).toContain("1K tokens");
  expect(wrapper.get(".activity-tooltip").text()).toContain("Week of");
  wrapper.unmount();
});
