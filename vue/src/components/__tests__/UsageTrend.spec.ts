import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import UsageTrend from "../UsageTrend.vue";

const rangeProps = {
  from: "2026-01-01",
  to: "2026-06-30",
  measure: "turns" as const,
  series: [
    {
      key: "claude",
      label: "Claude",
      color: "blue",
      value: 1,
      turns: 1,
      tokens: null,
    },
  ],
  daily: [
    {
      day: "2026-06-30",
      started: 1,
      measuredTurns: 0,
      tokens: null,
      groups: [{ label: "claude", started: 1, measuredTurns: 0, tokens: null }],
    },
  ],
};

it("includes the end of a custom range longer than 90 days", async () => {
  const wrapper = mount(UsageTrend, { props: rangeProps });
  await wrapper.get('[aria-label="2026-06-30 · Claude: 1"]').trigger("focus");
  expect(wrapper.get(".chart-tooltip").text()).toContain("Jun 30");
});

it("follows the current chart width after empty states and measure changes", async () => {
  const targets = new Set<Element>();
  let resize!: (width: number) => void;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width) =>
          callback(
            [...targets].map((target) => ({
              target,
              contentRect: { width },
            })) as ResizeObserverEntry[],
            this as unknown as ResizeObserver,
          );
      }
      observe(target: Element) {
        targets.add(target);
      }
      disconnect() {
        targets.clear();
      }
    },
  );
  const wrapper = mount(UsageTrend, { props: { ...rangeProps, daily: [] } });
  await wrapper.setProps({ daily: rangeProps.daily });
  resize(280);
  await wrapper.vm.$nextTick();
  expect(wrapper.get("svg").attributes("width")).toBe("280");
  await wrapper.setProps({ measure: "total" });
  expect(wrapper.find("svg").exists()).toBe(false);
  await wrapper.setProps({ measure: "turns" });
  resize(420);
  await wrapper.vm.$nextTick();
  expect(wrapper.get("svg").attributes("width")).toBe("420");
  wrapper.unmount();
  expect(targets.size).toBe(0);
});
it("stacks only observed group contributions and leaves unsupported token series unavailable", async () => {
  const token = {
    input: 80,
    output: 20,
    cacheRead: 0,
    cacheWrite: null,
    total: 100,
  };
  const wrapper = mount(UsageTrend, {
    props: {
      from: "2026-10-10",
      to: "2026-10-12",
      measure: "turns",
      series: [
        {
          key: "claude",
          label: "Claude Code",
          color: "blue",
          value: 2,
          turns: 2,
          tokens: 100,
        },
        {
          key: "codex",
          label: "Codex",
          color: "green",
          value: 1,
          turns: 1,
          tokens: null,
        },
      ],
      daily: [
        {
          day: "2026-10-10",
          started: 3,
          measuredTurns: 1,
          tokens: token,
          groups: [
            { label: "claude", started: 2, measuredTurns: 1, tokens: token },
            { label: "codex", started: 1, measuredTurns: 0, tokens: null },
          ],
        },
      ],
    },
  });
  expect(
    wrapper.find('[aria-label="2026-10-10 · Claude Code: 2"]').exists(),
  ).toBe(true);
  expect(wrapper.find('[aria-label="2026-10-10 · Codex: 1"]').exists()).toBe(
    true,
  );
  expect(wrapper.find('[aria-label^="2026-10-11 ·"]').exists()).toBe(false);
  await wrapper.setProps({ measure: "input" });
  expect(
    wrapper.find('[aria-label="2026-10-10 · Claude Code: 80"]').exists(),
  ).toBe(true);
  expect(wrapper.find('[aria-label^="2026-10-10 · Codex:"]').exists()).toBe(
    false,
  );
  await wrapper.setProps({
    daily: [
      {
        day: "2026-10-10",
        started: 1,
        measuredTurns: 0,
        tokens: null,
        groups: [
          { label: "codex", started: 1, measuredTurns: 0, tokens: null },
        ],
      },
    ],
  });
  expect(wrapper.find("svg").exists()).toBe(false);
  expect(wrapper.text()).toContain("Unavailable");
  await wrapper.setProps({
    daily: [
      {
        day: "2026-10-10",
        started: 1,
        measuredTurns: 1,
        tokens: { ...token, input: 0 },
        groups: [
          {
            label: "claude",
            started: 1,
            measuredTurns: 1,
            tokens: { ...token, input: 0 },
          },
        ],
      },
    ],
  });
  expect(wrapper.find("svg").exists()).toBe(true);
  expect(wrapper.findAll("circle")).toHaveLength(0);
  expect(wrapper.findAll("path.layer")).toHaveLength(0);
  wrapper.unmount();
});

it("reads a day's stacked contributions and total from the tooltip on keyboard focus", async () => {
  const token = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: null,
    total: 2,
  };
  const group = (label: string, started: number) => ({
    label,
    started,
    measuredTurns: started,
    tokens: token,
  });
  const wrapper = mount(UsageTrend, {
    props: {
      from: "2026-10-10",
      to: "2026-10-11",
      measure: "turns",
      series: [
        {
          key: "claude",
          label: "Claude Code",
          color: "blue",
          value: 5,
          turns: 5,
          tokens: 2,
        },
        {
          key: "codex",
          label: "Codex",
          color: "green",
          value: 3,
          turns: 3,
          tokens: 2,
        },
      ],
      daily: [
        {
          day: "2026-10-10",
          started: 8,
          measuredTurns: 8,
          tokens: token,
          groups: [group("claude", 5), group("codex", 3)],
        },
      ],
    },
  });
  expect(wrapper.find(".chart-tooltip").exists()).toBe(false);
  await wrapper.get('[aria-label="2026-10-10 · Codex: 3"]').trigger("focus");
  const tooltip = wrapper.get(".chart-tooltip").text();
  expect(tooltip).toContain("Claude Code");
  expect(tooltip).toContain("Codex");
  expect(tooltip).toContain("Total");
  expect(tooltip).toContain("8");
  await wrapper.get('[aria-label="2026-10-10 · Codex: 3"]').trigger("blur");
  expect(wrapper.find(".chart-tooltip").exists()).toBe(false);
  wrapper.unmount();
});
