// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import Dashboard from "../Dashboard.vue";

// Rendered owner boundary: stale filter responses, revoked private access, old
// dates rejected locally, unknowns displayed as zero, and exact tiny/large values.
// Real SQL, proxy authentication and chart geometry live in the Compose browser workflow.
const metrics = (turns = "7") => ({
  range: { from: "2020-01-01", to: "2020-01-01", provider: null, model: null },
  availability: {
    firstDay: "2020-01-01",
    lastDay: "2020-01-01",
    lastReceivedAt: "2020-01-02T00:00:00Z",
  },
  overview: {
    participatingInstalls: "6",
    dau: "3",
    wau: "4",
    mau: "5",
    calendarMonthActives: "4",
  },
  activity: [
    { day: "2020-01-01", activeInstalls: "3", firstReportedInstalls: "1" },
  ],
  totals: {
    groups: "1",
    turns,
    inputTokens: "10",
    unknownInputGroups: "0",
    cachedInputTokens: "5",
    unknownCachedInputGroups: "0",
    outputTokens: "2",
    unknownOutputGroups: "0",
    totalTokens: "12",
    excludedTokenGroups: "0",
    cacheInputTokens: "10",
    cacheReadTokens: "5",
    nonCacheReadTokens: "5",
    cacheReadShare: 0.5,
    excludedCacheGroups: "0",
    estimatedCostUsd: "0.000000000123",
    unknownCostGroups: "0",
    costCoverage: "complete",
  },
  daily: [],
  weekly: [],
  models: [],
});
afterEach(() => vi.unstubAllGlobals());
it("uses validated old ranges and keeps exact measurements while rejecting stale loads and revoked access", async () => {
  const pending: ((response: Response) => void)[] = [];
  const fetcher = vi.fn(
    (_url: string, _options: RequestInit) =>
      new Promise<Response>((resolve) => pending.push(resolve)),
  );
  vi.stubGlobal("fetch", fetcher);
  const wrapper = mount(Dashboard);
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain("Loading");
  pending.shift()!(Response.json(metrics()));
  await flushPromises();
  expect(wrapper.get('[aria-label="Turns"]').text()).toContain("7");
  expect(wrapper.get('[aria-label="Known estimated spend"]').text()).toContain(
    "$0.000000000123",
  );
  await wrapper.get('input[aria-label="From UTC day"]').setValue("2020-01-01");
  await wrapper.get('input[aria-label="To UTC day"]').setValue("2020-01-01");
  await wrapper.get('form[aria-label="Reporting range"]').trigger("submit");
  expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
    "from=2020-01-01&to=2020-01-01",
  );
  await wrapper.get('select[aria-label="Provider"]').setValue("codex");
  expect(pending).toHaveLength(2);
  pending.pop()!(Response.json(metrics("45035996273704955")));
  await flushPromises();
  expect(wrapper.get('[aria-label="Turns"]').text()).toContain(
    "45,035,996,273,704,955",
  );
  pending.shift()!(Response.json(metrics("999")));
  await flushPromises();
  expect(wrapper.get('[aria-label="Turns"]').text()).not.toContain("999");
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
  const wrapper = mount(Dashboard);
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("unavailable");
  expect(wrapper.text()).not.toContain("SECRET");
  await wrapper.get('input[aria-label="From UTC day"]').setValue("2000-01-01");
  await wrapper.get('input[aria-label="To UTC day"]').setValue("2026-01-01");
  await wrapper.get('form[aria-label="Reporting range"]').trigger("submit");
  expect(wrapper.get('[role="alert"]').text()).toContain("3,660");
  expect(fetcher).toHaveBeenCalledTimes(1);
  wrapper.unmount();
});
