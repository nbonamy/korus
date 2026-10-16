import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import UsagePerformance from "../UsagePerformance.vue";

it("compacts large performance values", () => {
  const wrapper = mount(UsagePerformance, {
    props: {
      summary: {
        recordedSince: 0,
        retainedSince: 0,
        rows: [
          {
            label: "gpt-6-luna",
            started: 1,
            completed: 1,
            failed: 0,
            interrupted: 0,
            inProgress: 0,
            measuredTurns: 0,
            tokens: null,
            speed: {
              turns: 1,
              outputTokens: 1_234_567,
              generationMs: 1_000,
              ttftMs: 1_234_500,
              ttftTurns: 1,
            },
          },
        ],
      },
    },
  });

  expect(
    wrapper.findAll(".usage-stat__value").map((value) => value.text()),
  ).toStrictEqual(["1.2K", "1.2M"]);
  expect(
    wrapper
      .get('[aria-label="Time to First Token (TTFT)"] tbody tr')
      .findAll("td")
      .map((cell) => cell.text()),
  ).toStrictEqual(["gpt-6-luna", "1.2K"]);
  expect(
    wrapper
      .get('[aria-label="Output Speed"] tbody tr')
      .findAll("td")
      .map((cell) => cell.text()),
  ).toStrictEqual(["gpt-6-luna", "1.2M"]);
  wrapper.unmount();
});
