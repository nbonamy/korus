import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import UsageActivity from "../UsageActivity.vue";
import { ACTIVITY_WEEKS, activityWindow } from "../usage-chart";

const day = (offset: number) =>
  new Date(Date.parse(activityWindow().to) + offset * 86400000)
    .toISOString()
    .slice(0, 10);
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

it("reports the lifetime total and the peak day beside the grid", () => {
  const wrapper = mount(UsageActivity, {
    props: {
      days: [
        { day: day(-5), tokens: 1500 },
        { day: day(-2), tokens: 4000 },
        { day: day(0), tokens: 500 },
      ],
    },
  });
  const totals = wrapper.get(".activity-totals").text();
  expect(totals).toContain("Lifetime total");
  expect(totals).toContain("6K");
  expect(totals).toContain("Peak day");
  expect(totals).toContain("4K");
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
  expect(wrapper.get(".activity-totals").text()).toContain("8K");
  expect(levels(wrapper).at(-1)).toBe(1);
  notify!(5000);
  await wrapper.vm.$nextTick();
  expect(wrapper.findAll(".activity-cell")).toHaveLength(ACTIVITY_WEEKS * 7);
  wrapper.unmount();
  vi.unstubAllGlobals();
});
