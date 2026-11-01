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
  const wrapper = mount(UsageShare, { props: { series: [...series].reverse(), measure: "total" } });
  expect(wrapper.findAll('li strong').map(row => row.text())).toStrictEqual(['Model A', 'Model B', 'Unknown model']);
  expect(wrapper.findAll("circle[tabindex]")).toHaveLength(2);
  expect(wrapper.findAll("circle[tabindex]")[0]!.attributes("aria-label")).toBe(
    "Model A: 300 · 75%",
  );
  expect(wrapper.text()).toContain("400");
  expect(wrapper.text()).toContain("Unknown model");
  expect(wrapper.text()).toContain("N/A");
  await wrapper.setProps({ series: [series[2]!] });
  expect(wrapper.findAll("circle[tabindex]")).toHaveLength(0);
  expect(wrapper.get(".ring-total").text()).toBe("—");
  await wrapper.setProps({ series: [{ ...series[0]!, value: 0 }] });
  expect(wrapper.get(".ring-total").text()).toBe("0");
  expect(wrapper.findAll("circle[tabindex]")).toHaveLength(0);
  wrapper.unmount();
});

it("compacts large token values and labels unknown values N/A", () => {
  const series = [
    {
      key: "large",
      label: "Large model",
      color: "blue",
      value: 19_223_027,
      turns: 1,
      tokens: 19_223_027,
    },
    {
      key: "small",
      label: "Small model",
      color: "orange",
      value: 236_216,
      turns: 1,
      tokens: 236_216,
    },
    {
      key: "unknown",
      label: "Unknown model",
      color: "gray",
      value: null,
      turns: 1,
      tokens: null,
    },
  ];
  const wrapper = mount(UsageShare, { props: { series, measure: "total" } });
  const values = wrapper.findAll(".share-value").map((value) => value.text());
  expect(values).toStrictEqual(["19.2M", "236.2K", "N/A"]);
  expect(wrapper.findAll(".share-percent").map((value) => value.text())).toStrictEqual([
    "98.8%",
    "1.2%",
    "N/A",
  ]);
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
