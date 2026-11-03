// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, it, expect, vi } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import MetricChart from "../MetricChart.vue";
import OverviewReport from "../OverviewReport.vue";
import { reportFixture } from "./report-fixture";
vi.mock("vue-chartjs", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    Chart: defineComponent({
      props: ["data", "options", "plugins", "type"],
      setup(_, { attrs }) {
        return () => h("canvas", attrs);
      },
    }),
  };
});
// Overview failure: a finished day drawn as "today", or today drawn as a drop.
afterEach(() => vi.useRealTimers());
const render = (to: string) => {
  const stub = { render: () => null };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ["activity", "tokens", "spend"].map((name) => ({
      name,
      path: `/${name}`,
      component: stub,
    })),
  });
  return mount(OverviewReport, {
    props: { data: reportFixture("2026-10-19", to), previous: null },
    global: { plugins: [router] },
  }).getComponent(MetricChart);
};
it("hatches and labels the newest bar only when it is the viewer's today", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T15:00:00Z"));
  const live = render("2026-11-01");
  expect(live.props("dayLabels")).toEqual({ "2026-11-01": "Nov 1 · today" });
  expect(live.props("series")[0].partial).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
    true,
  ]);
  const settled = render("2026-10-31");
  expect(settled.props("dayLabels")).toBeUndefined();
  expect(settled.props("series")[0]?.partial?.some(Boolean)).toBe(false);
});
