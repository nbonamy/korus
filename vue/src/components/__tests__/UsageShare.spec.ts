import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import UsageShare from "../UsageShare.vue";
it("uses measured values as the donut denominator without drawing unknown measurements as zero", async () => {
  const series = [
    {
      key: "a",
      label: "Model A",
      color: "blue",
      value: 300,
      turns: 1,
      tokens: 300,
    },
    {
      key: "b",
      label: "Model B",
      color: "green",
      value: 100,
      turns: 1,
      tokens: 100,
    },
    {
      key: "c",
      label: "Unknown model",
      color: "gray",
      value: null,
      turns: 5,
      tokens: null,
    },
  ];
  const wrapper = mount(UsageShare, { props: { series, measure: "total" } });
  expect(wrapper.findAll("circle[tabindex]")).toHaveLength(2);
  expect(wrapper.findAll("circle[tabindex]")[0]!.attributes("aria-label")).toBe(
    "Model A: 300 · 75%",
  );
  expect(wrapper.text()).toContain("400");
  expect(wrapper.text()).toContain("Unknown model");
  expect(wrapper.text()).toContain("Unavailable");
  await wrapper.setProps({ series: [series[2]!] });
  expect(wrapper.findAll("circle[tabindex]")).toHaveLength(0);
  expect(wrapper.get(".ring-total").text()).toBe("—");
  await wrapper.setProps({ series: [{ ...series[0]!, value: 0 }] });
  expect(wrapper.get(".ring-total").text()).toBe("0");
  expect(wrapper.findAll("circle[tabindex]")).toHaveLength(0);
  wrapper.unmount();
});

it("replaces the centre figure with the hovered slice's share", async () => {
  const series = [
    {
      key: "a",
      label: "Model A",
      color: "blue",
      value: 300,
      turns: 1,
      tokens: 300,
    },
    {
      key: "b",
      label: "Model B",
      color: "green",
      value: 100,
      turns: 1,
      tokens: 100,
    },
  ];
  const wrapper = mount(UsageShare, { props: { series, measure: "total" } });
  expect(wrapper.get(".ring-total").text()).toBe("400");
  await wrapper.findAll("circle[tabindex]")[1]!.trigger("pointerenter");
  expect(wrapper.get(".ring-total").text()).toBe("25%");
  expect(wrapper.get(".ring-unit").text()).toBe("Model B");
  await wrapper.findAll("circle[tabindex]")[1]!.trigger("pointerleave");
  expect(wrapper.get(".ring-total").text()).toBe("400");
  wrapper.unmount();
});
