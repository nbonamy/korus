// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ElPopover, ElSwitch } from "element-plus";
import Dashboard from "../Dashboard.vue";

// Rendered owner boundary: stale filter responses, revoked private access, old
// dates rejected locally, unknowns displayed as zero, and exact tiny/large values.
// Real SQL, proxy authentication and chart geometry live in the Compose browser workflow.
import { metrics, modelTotals } from "./metrics-fixture";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("uses validated old ranges and keeps exact measurements while rejecting stale loads and revoked access", async () => {
  const pending: ((response: Response) => void)[] = [];
  const fetcher = vi.fn(
    (_url: string, _options: RequestInit) =>
      new Promise<Response>((resolve) => pending.push(resolve)),
  );
  vi.stubGlobal("fetch", fetcher);
  const wrapper = mount(Dashboard, {
    attachTo: document.body,
    global: { components: { ElPopover, ElSwitch } },
  });
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain("Loading");
  const initial = metrics();
  pending.shift()!(Response.json({...initial,totals:{...initial.totals,measuredTurns:'5',unmeasuredTurns:'2',excludedTokenGroups:'1',excludedCacheGroups:'1',unknownCostGroups:'1',costCoverage:'partial'}}));
  await flushPromises();
  expect(wrapper.get(".brand").text()).toContain("Console");
  expect(wrapper.get(".brand img").attributes("alt")).toBe("");
  expect(wrapper.get(".navigation-group").text()).toBe("Reporting");
  expect(document.title).toContain("Console · Overview");
  expect(wrapper.get('[aria-label="Turns"]').text()).toContain("7");
  expect(wrapper.get('[aria-label="Measured total tokens"]').text()).toContain(
    "1.3B",
  );
  expect(wrapper.get('[aria-label="Measured total tokens"]').text()).toContain('2 turns missing usage');
  expect(wrapper.get('[aria-label="Measured cache-read share"]').text()).toContain('2 turns missing usage');
  expect(wrapper.text()).not.toContain('groups excluded');
  expect(wrapper.get('[aria-label="Known estimated spend"]').text()).toContain('partial');
  expect(
    wrapper.get('[aria-label="Measured total tokens"] dd').attributes("title"),
  ).toBe("1,250,000,000");
  expect(
    wrapper.findAll('[aria-label="Daily activity"] path[fill^="url("]'),
  ).toHaveLength(2);
  expect(
    wrapper
      .get('[aria-label="Recent ranges"]')
      .element.compareDocumentPosition(
        wrapper.get('input[aria-label="From day"]').element,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(wrapper.get('[aria-label="Recent ranges"]').text()).toBe("7d30d90d");
  expect(wrapper.text()).not.toContain("About the data");
  expect(wrapper.text()).not.toContain("View data");
  await wrapper
    .get('[aria-label="Daily activity"] svg[role="img"]')
    .trigger("focus");
  expect(
    wrapper.get('[aria-label="Daily activity"] [role="status"]').text(),
  ).toContain("Active installs");
  // A report has its own URL and content; page changes preserve the loaded data.
  const navigation = wrapper.get('nav[aria-label="Analytics sections"]');
  expect(navigation.findAll("a").map((a) => a.text())).toStrictEqual([
    "Overview",
    "Activity",
    "Models",
    "Tokens",
    "Spend",
    "Performance",
  ]);
  window.location.hash = "#/models";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await flushPromises();
  expect(navigation.get('a[href="#/models"]').attributes("aria-current")).toBe(
    "page",
  );
  expect(wrapper.get("h1").text()).toBe("Models");
  const popularity = wrapper.get('[aria-label="Most used models"]');
  expect(popularity.text()).toContain("50.0%");
  expect(popularity.findAll('[role="listitem"]')).toHaveLength(2);
  await wrapper
    .findAll("label")
    .find((label) => label.text() === "Over time")!
    .trigger("click");
  await flushPromises();
  expect(
    wrapper.find('[aria-label="Model usage over time"] rect').exists(),
  ).toBe(true);

  expect(wrapper.get("tbody").text()).toContain("Fast");
  expect(wrapper.get("tbody").text()).toContain("gpt-6-sol");
  expect(wrapper.find('[aria-label="Provider and model"]').exists()).toBe(true);
  expect(wrapper.find('[aria-label="Daily activity"]').exists()).toBe(false);
  window.location.hash = "#/performance";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("Performance");
  const speedChart = wrapper.get('[aria-label="Output speed"]');
  expect(speedChart.get('[aria-label="Series"]').text()).toContain(
    "gpt-6-sol · Fast",
  );
  expect(speedChart.findAll(".chart-line")).toHaveLength(2);
  expect(speedChart.findAll('path[fill^="url("]')).toHaveLength(2);
  await speedChart.get('svg[role="img"]').trigger("focus");
  expect(speedChart.text()).toContain("40.0 tok/s");
  expect(speedChart.text()).toContain("10.0 tok/s");

  expect(wrapper.get('[aria-label="Output speed summary"]').text()).toContain(
    "25.0 tok/s",
  );
  expect(
    wrapper.get('[aria-label="Time to first output summary"]').text(),
  ).toContain("0.5 s");
  window.location.hash = "#/overview";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("Overview");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    (
      wrapper.findAll('[role="radiogroup"] input')[1]!
        .element as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(wrapper.get('[aria-label="Known estimated spend"]').text()).toContain(
    "<$0.01",
  );
  await wrapper.get('input[aria-label="From day"]').setValue("2020-01-01");
  await wrapper.get('input[aria-label="To day"]').setValue("2020-01-01");
  await wrapper.get('input[aria-label="From day"]').trigger("change");
  await wrapper.get('input[aria-label="To day"]').trigger("change");
  await wrapper.get('form[aria-label="Reporting range"]').trigger("submit");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
    "from=2020-01-01&to=2020-01-01",
  );
  await wrapper.get('[aria-label="Provider"]').trigger("click");
  await flushPromises();
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent?.trim() === "Codex",
  ) as HTMLElement;
  option.click();
  await flushPromises();
  expect(pending).toHaveLength(2);
  pending.pop()!(Response.json(metrics("45035996273704955")));
  await flushPromises();
  expect(wrapper.get('[aria-label="Turns"]').text()).toContain(
    "45,035,996,273,704,955",
  );
  pending.shift()!(Response.json(metrics("999")));
  await flushPromises();
  expect(wrapper.get('[aria-label="Turns"]').text()).not.toContain("999");
  const optionsButton = wrapper.get('button[aria-label="Analytics options"]');
  expect(optionsButton.attributes("aria-haspopup")).toBe("menu");
  await optionsButton.trigger("click");
  await flushPromises();
  await vi.waitFor(() =>
    expect(optionsButton.attributes("aria-expanded")).toBe("true"),
  );
  const tierOption = document.querySelector(
    '[role="menuitemcheckbox"]',
  ) as HTMLButtonElement;
  expect(tierOption.textContent).toContain("Group service tiers");
  expect(tierOption.getAttribute("aria-checked")).toBe("false");
  tierOption.click();
  await flushPromises();
  expect(optionsButton.attributes("aria-expanded")).toBe("false");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
    "groupServiceTiers=true",
  );
  pending.shift()!(
    Response.json({
      ...metrics(),
      models: [
        {
          ...modelTotals,
          provider: "codex",
          model: "gpt-6-sol",
          serviceTier: null,
        },
      ],
    }),
  );
  await flushPromises();
  window.location.hash = "#/models";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await flushPromises();
  expect(wrapper.get("tbody").text()).not.toContain("Fast");
  await optionsButton.trigger("click");
  await vi.waitFor(() =>
    expect(optionsButton.attributes("aria-expanded")).toBe("true"),
  );
  await flushPromises();
  expect(
    document
      .querySelector('[role="menuitemcheckbox"]')
      ?.getAttribute("aria-checked"),
  ).toBe("true");
  document
    .querySelector('[role="menuitemcheckbox"]')
    ?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  await flushPromises();
  expect(optionsButton.attributes("aria-expanded")).toBe("false");
  await wrapper.get('button[aria-label="Refresh metrics"]').trigger("click");
  pending.shift()!(new Response("", { status: 401 }));
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("Private access");
  expect(wrapper.find('[aria-label="Participating installs"]').exists()).toBe(
    false,
  );
  wrapper.unmount();
});
it("shows recoverable failures without echoing remote diagnostics and bounds date ranges before fetching", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("SECRET SQL diagnostic", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  const wrapper = mount(Dashboard, {
    attachTo: document.body,
    global: { components: { ElPopover, ElSwitch } },
  });
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("unavailable");
  expect(wrapper.text()).not.toContain("SECRET");
  await wrapper.get('input[aria-label="From day"]').setValue("2000-01-01");
  await wrapper.get('input[aria-label="To day"]').setValue("2026-01-01");
  await wrapper.get('input[aria-label="From day"]').trigger("change");
  await wrapper.get('input[aria-label="To day"]').trigger("change");
  await wrapper.get('form[aria-label="Reporting range"]').trigger("submit");
  expect(wrapper.get('[role="alert"]').text()).toContain("3,660");
  expect(fetcher).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});

it("requests and labels browser-local days including today at midnight and across DST", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const fetcher = vi.fn(async (_url: string) => Response.json(metrics()));
  vi.stubGlobal("fetch", fetcher);
  try {
    for (const [zone, now, to, from] of [
      ["America/Chicago", "2026-11-01T03:00:00Z", "2026-10-31", "2026-10-02"],
      [
        "Pacific/Kiritimati",
        "2026-11-01T12:00:00Z",
        "2026-11-02",
        "2026-10-04",
      ],
      ["America/Chicago", "2026-03-09T04:30:00Z", "2026-03-08", "2026-02-07"],
    ]) {
      vi.stubEnv("TZ", zone!);
      vi.setSystemTime(new Date(now!));
      const wrapper = mount(Dashboard, {
        global: { components: { ElPopover, ElSwitch } },
      });
      await flushPromises();
      const params = new URL(
        fetcher.mock.calls.at(-1)![0]!,
        "https://console.invalid",
      ).searchParams;
      expect(params.get("timeZone")).toBe(zone);
      expect(params.get("to")).toBe(to);
      expect(params.get("from")).toBe(from);
      expect(wrapper.get(".freshness").text()).toContain(zone!);
      await wrapper
        .get('[aria-label="Recent ranges"]')
        .findAll("input")[0]!
        .trigger("click");
      await flushPromises();
      expect(
        new URL(
          fetcher.mock.calls.at(-1)![0]!,
          "https://console.invalid",
        ).searchParams.get("to"),
      ).toBe(to);
      wrapper.unmount();
    }
  } finally {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  }
});
