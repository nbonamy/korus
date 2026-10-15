import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import type { UsageSummary } from "@workspace/core/usage";
import UsageTokenMix from "../UsageTokenMix.vue";

it("stacks inclusive input and output once and labels cache/reasoning shares against their parent", async () => {
  const row: UsageSummary["rows"][number] = {
    label: "codex",
    started: 1,
    completed: 1,
    failed: 0,
    interrupted: 0,
    inProgress: 0,
    measuredTurns: 1,
    tokens: {
      input: 100,
      output: 40,
      cacheRead: 60,
      cacheWrite: null,
      reasoning: 10,
    },
  };
  const wrapper = mount(UsageTokenMix, {
    props: { rows: [row], measured: 1, turns: 1 },
  });
  try {
    expect(
      wrapper
        .findAll(".mix-bar > span")
        .map((part) => (part.element as HTMLElement).style.flexGrow),
    ).toStrictEqual(["100", "40"]);
    expect(
      wrapper.findAll(".mix-legend li").map((part) => part.text()),
    ).toStrictEqual([
      "Input tokens71.4%",
      "Output tokens28.6%",
      "Cache read (% of input)60%",
      "Reasoning (% of output)25%",
    ]);
    await wrapper.setProps({
      rows: [
        { ...row, tokens: { ...row.tokens!, cacheRead: 0, reasoning: null } },
      ],
    });
    expect(
      wrapper.findAll(".mix-legend li").map((part) => part.text()),
    ).toStrictEqual(["Input tokens71.4%", "Output tokens28.6%"]);
  } finally {
    wrapper.unmount();
  }
});
