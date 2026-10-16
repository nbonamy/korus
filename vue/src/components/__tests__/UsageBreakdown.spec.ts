import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import UsageBreakdown from "../UsageBreakdown.vue";

it("compacts large turn and token counts in model rows", () => {
  const total = 19_223_027;
  const wrapper = mount(UsageBreakdown, {
    props: {
      grouping: "model",
      series: [
        {
          key: "gpt-6-luna",
          label: "gpt-6-luna",
          color: "blue",
          value: total,
          turns: total,
          tokens: total,
        },
      ],
    },
  });

  expect(
    wrapper
      .find("tbody tr")
      .findAll("td")
      .map((cell) => cell.text()),
  ).toStrictEqual(["gpt-6-luna", "19.2M", "100%", "19.2M"]);
  wrapper.unmount();
});
