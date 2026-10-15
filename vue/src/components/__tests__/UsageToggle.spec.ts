import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import UsageToggle from "../UsageToggle.vue";

it("uses one native radio group and forwards selection with option labels", async () => {
  const wrapper = mount(UsageToggle, {
    props: {
      modelValue: "turns",
      label: "Measure",
      options: [
        { value: "turns", label: "Turns" },
        { value: "total", label: "Tokens", color: "var(--chart-1)" },
      ],
    },
  });
  const radios = wrapper.findAll<HTMLInputElement>('input[type="radio"]');
  expect(radios).toHaveLength(2);
  expect(radios[0]!.attributes("name")).toBeTruthy();
  expect(radios[1]!.attributes("name")).toBe(radios[0]!.attributes("name"));
  expect(radios[0]!.element.checked).toBe(true);
  expect(wrapper.get('[role="radiogroup"]').attributes("aria-label")).toBe(
    "Measure",
  );
  await radios[1]!.setValue();
  expect(wrapper.emitted("update:modelValue")).toStrictEqual([["total"]]);
  expect(wrapper.findAll("label").map((label) => label.text())).toStrictEqual([
    "Turns",
    "Tokens",
  ]);
});
