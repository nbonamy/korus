// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("vue-chartjs", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    Chart: defineComponent({
      props: ["data", "options", "plugins", "type"],
      setup(_props, { attrs }) {
        return () => h("canvas", attrs);
      },
    }),
  };
});
import { ElPopover, ElSwitch } from "element-plus";
import { RouterView, createMemoryHistory } from "vue-router";
import { createConsoleRouter } from "../router";
import { createConsoleSession } from "../console-session";
async function renderDashboard() {
  const session = createConsoleSession();
  session.authenticate();
  const router = createConsoleRouter(session, createMemoryHistory());
  await router.push("/overview");
  await router.isReady();
  const wrapper = mount(RouterView, {
    attachTo: document.body,
    global: { plugins: [router], components: { ElPopover, ElSwitch } },
  });
  return { wrapper, router };
}

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
  const { wrapper, router } = await renderDashboard();
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain("Loading");
  const initial = { ...metrics(), availableModels: ["gpt-6-sol", "unknown"] };
  initial.modelDaily[0]!.performance.outputTokensPerSecond = "47";
  initial.modelDaily.push({
    ...initial.modelDaily[0]!,
    day: "2020-01-02",
    performance: {
      ...initial.modelDaily[0]!.performance,
      outputTokensPerSecond: "0",
    },
  });
  pending.shift()!(
    Response.json({
      ...initial,
      totals: {
        ...initial.totals,
        measuredTurns: "5",
        unmeasuredTurns: "2",
        excludedTokenGroups: "1",
        excludedCacheGroups: "1",
        unknownCostGroups: "1",
        costCoverage: "partial",
      },
    }),
  );
  await flushPromises();
  expect(wrapper.get(".brand").text()).toContain("Console");
  expect(wrapper.get(".brand img").attributes("alt")).toBe("");
  expect(wrapper.text()).not.toMatch(
    /Selected range|Opted-in installations|API-equivalent/,
  );
  expect(document.title).toContain("Console · Overview");
  await wrapper.get('[aria-label="Model"]').trigger("click");
  await flushPromises();
  expect(
    [
      ...document
        .getElementById(
          wrapper.get('[aria-label="Model"]').attributes("aria-controls")!,
        )!
        .querySelectorAll('[role="option"]'),
    ].map((option) => option.textContent?.trim()),
  ).toStrictEqual(["All models", "gpt-6-sol", "Unknown model"]);
  await wrapper
    .get('[aria-label="Model"]')
    .trigger("keydown", { key: "Escape" });
  await flushPromises();

  expect(wrapper.get('[aria-label="Turns"]').text()).toContain("7");
  expect(wrapper.get('[aria-label="Measured total tokens"]').text()).toContain(
    "1.3B",
  );
  expect(wrapper.text()).not.toMatch(/turns missing usage|partial/i);
  expect(wrapper.text()).not.toContain("groups excluded");
  expect(
    wrapper.get('[aria-label="Measured total tokens"] dd').attributes("title"),
  ).toBe("1,250,000,000");
  expect(
    wrapper.find('[aria-label="Daily activity"] canvas[role="img"]').exists(),
  ).toBe(true);
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
    .get('[aria-label="Daily activity"] canvas[role="img"]')
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
  await router.push("/models");
  await flushPromises();
  expect(navigation.get('a[href="/models"]').attributes("aria-current")).toBe(
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
    wrapper.find('canvas[aria-label^="Model usage over time"]').exists(),
  ).toBe(true);

  expect(wrapper.get("tbody").text()).toContain("fast");
  expect(wrapper.get("tbody").text()).toContain("gpt-6-sol");
  expect(wrapper.find('[aria-label="Provider and model"]').exists()).toBe(true);
  expect(wrapper.find('[aria-label="Daily activity"]').exists()).toBe(false);
  await router.push("/performance");
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("Performance");
  expect(wrapper.find('[aria-label="Compare models"]').exists()).toBe(false);
  expect(wrapper.text()).not.toMatch(
    /provider benchmark|Higher is faster|Lower is faster|Missing samples are not zero/,
  );
  const speedChart = wrapper.get('[aria-label="Output speed over time"]');
  expect(speedChart.find('[aria-label="Series"]').exists()).toBe(false);
  expect(speedChart.find('canvas[role="img"]').exists()).toBe(true);
  expect(speedChart.findAll(".chart-observation")).toHaveLength(3);
  await speedChart.get('canvas[role="img"]').trigger("focus");
  expect(speedChart.text()).toContain("47 tokens/s");
  expect(speedChart.text()).toContain("10 tokens/s");
  await speedChart.get('canvas[role="img"]').trigger("keydown", { key: "End" });
  const speedTooltip = speedChart.get('[role="status"]');
  expect(speedTooltip.findAll("li")).toHaveLength(1);
  expect(speedTooltip.text()).toContain("gpt-6-sol · fast");
  expect(speedTooltip.text()).toContain("0 tokens/s");
  expect(speedTooltip.text()).not.toContain("Unavailable");

  expect(wrapper.get('[aria-label="Output speed summary"]').text()).toContain(
    "25 tokens/s",
  );
  expect(
    wrapper.get('[aria-label="Time to first output summary"]').text(),
  ).toContain("0.5 s");
  await router.push("/tokens");
  await flushPromises();
  expect(
    wrapper
      .get('[aria-label="Cache-read share"]')
      .findAll('path[fill^="url("]'),
  ).toHaveLength(0);
  await router.push("/overview");
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
  await router.push("/models");
  await flushPromises();
  expect(wrapper.get("tbody").text()).not.toContain("fast");
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
  const { wrapper } = await renderDashboard();
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
      const { wrapper } = await renderDashboard();
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

it("uses model facets from real data and clears selections absent from a new scope", async () => {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      const selected = new URL(url, "https://console.invalid").searchParams;
      return Response.json({
        ...metrics(),
        availableModels:
          selected.get("provider") === "claude"
            ? ["unknown"]
            : ["gpt-6-sol", "unknown"],
      });
    }),
  );
  const { wrapper } = await renderDashboard();
  await flushPromises();
  await wrapper.get('[aria-label="Model"]').trigger("click");
  await flushPromises();
  (
    Array.from(document.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent?.trim() === "gpt-6-sol",
    ) as HTMLElement
  ).click();
  await flushPromises();
  expect(requested.at(-1)).toContain("model=gpt-6-sol");
  await wrapper.get('[aria-label="Model"]').trigger("click");
  await flushPromises();
  expect(document.body.textContent).toContain("Unknown model");
  await wrapper
    .get('[aria-label="Model"]')
    .trigger("keydown", { key: "Escape" });
  await flushPromises();
  await wrapper.get('[aria-label="Provider"]').trigger("click");
  await flushPromises();
  (
    Array.from(document.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent?.trim() === "Claude",
    ) as HTMLElement
  ).click();
  await flushPromises();
  expect(requested.at(-1)).toContain("provider=claude");
  expect(
    new URL(requested.at(-1)!, "https://console.invalid").searchParams.has(
      "model",
    ),
  ).toBe(false);
  wrapper.unmount();
});
