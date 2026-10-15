// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  modelBehaviorMeasures,
  type ModelBehavior,
} from "../../api/telemetry/model-behavior";
import { operatorPage, operatorScript } from "../operator-page";

// Keep browser fixture types local: DOM ambient fetch types conflict with this Node workspace.
interface FixtureElement {
  textContent: string | null;
  value: string;
  hidden: boolean;
  getAttribute(name: string): string | null;
  click(): void;
  focus(): void;
  blur(): void;
  dispatchEvent(event: unknown): boolean;
}
interface FixtureDocument {
  body: { append(frame: FixtureFrame): void };
  createElement(tag: "iframe"): FixtureFrame;
  querySelector<T = FixtureElement>(selector: string): T | null;
  querySelectorAll(selector: string): ArrayLike<FixtureElement>;
  open(): void;
  write(html: string): void;
  close(): void;
}
interface FixtureWindow {
  Date: typeof Date;
  getComputedStyle(element: FixtureElement): {
    height: string;
    appearance: string;
  };
  Event: new (name: string, options?: { cancelable: boolean }) => unknown;
  eval(script: string): void;
}

it("gives filter selects and date fields the same explicit height without native select sizing", async () => {
  const { document, window } = mount();
  await vi.waitFor(() =>
    expect(document.querySelector("#trend")?.getAttribute("aria-busy")).toBe(
      "false",
    ),
  );
  const fields = document.querySelectorAll(
    ".filters input, .filters select, #measure",
  );
  for (const field of Array.from(fields))
    expect(window.getComputedStyle(field).height).toBe("40px");
  for (const field of Array.from(document.querySelectorAll("select")))
    expect(window.getComputedStyle(field).appearance).toBe("none");
});
interface FixtureFrame {
  contentWindow: FixtureWindow | null;
  contentDocument: FixtureDocument | null;
  remove(): void;
}
const frames: FixtureFrame[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});
const row = (day: string, metric: string, total: number, value = "claude") => ({
  day,
  metric,
  total,
  value,
  dimension: "provider",
  reports: 10,
});
const rows = [
  row("2026-10-08", "tokens.input", 120),
  row("2026-10-10", "tokens.input", 240),
  row("2026-10-08", "tokens.output", 40),
  row("2026-10-10", "tokens.output", 80),
  row("2026-10-10", "turn.started", 30),
  row("2026-10-10", "turn.completed", 20),
];
const result = (
  values = rows,
  behavior: ModelBehavior[] = [],
  demo = false,
) => ({
  demo,
  demoAvailable: true,
  behavior,
  rows: values,
  summary: [],
  updatedAt: "2026-10-14",
  coverage: "Released cells only; withheld values are unavailable.",
});

it("generates labeled demo data and deletes it to return to real counts through the signed-in controls", async () => {
  let demo = false;
  const fetch = vi.fn(async (url: string, input?: unknown) => {
    if (url === "/v1/telemetry/demo")
      demo = (input as { method: string }).method === "POST";
    return response(
      result([row("2026-10-14", "turn.started", demo ? 500 : 1)], [], demo),
    );
  });
  const { document } = mount(fetch);
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Started turns: 1"]'),
    ).not.toBeNull(),
  );
  document.querySelector("#demo-generate")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<FixtureElement>("#demo-banner")!.hidden).toBe(
      false,
    ),
  );
  expect(fetch).toHaveBeenCalledWith("/v1/telemetry/demo", {
    method: "POST",
    credentials: "same-origin",
  });
  expect(
    document.querySelector('[aria-label="Started turns: 500"]'),
  ).not.toBeNull();
  document.querySelector("#demo-delete")!.click();
  await vi.waitFor(() =>
    expect(document.querySelector<FixtureElement>("#demo-banner")!.hidden).toBe(
      true,
    ),
  );
  expect(fetch).toHaveBeenCalledWith("/v1/telemetry/demo", {
    method: "DELETE",
    credentials: "same-origin",
  });
  expect(
    document.querySelector('[aria-label="Started turns: 1"]'),
  ).not.toBeNull();
});
const response = (data = result(), status = 200) => ({
  ok: status === 200,
  status,
  json: async () => data,
});
function mount(
  fetch = vi.fn(async (_url: string, _init?: unknown) => response()),
) {
  const host = (globalThis as unknown as { document: FixtureDocument })
    .document;
  const frame = host.createElement("iframe");
  host.body.append(frame);
  frames.push(frame);
  const frameWindow = frame.contentWindow!;
  const frameDocument = frame.contentDocument!;
  frameDocument.open();
  frameDocument.write(operatorPage);
  frameDocument.close();
  frameWindow.Date.now = () => Date.UTC(2026, 9, 14, 12);
  const poll = vi.fn((_callback: () => void, _interval: number) => 1);
  Object.assign(frameWindow, { fetch, setInterval: poll });
  frameWindow.eval(operatorScript);
  return { document: frameDocument, window: frameWindow, fetch, poll };
}

it("shows current-day turns in one live console and refreshes automatically", async () => {
  const fetch = vi.fn(async (_url: string, _init?: unknown) =>
    response(result([row("2026-10-14", "turn.started", 1)])),
  );
  const { document, poll } = mount(fetch);
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Started turns: 1"]'),
    ).not.toBeNull(),
  );
  expect(document.querySelector("[name=environment]")).toBeNull();
  expect(fetch.mock.calls[0]?.[0]).toContain("to=2026-10-14");
  expect(fetch.mock.calls[0]?.[0]).not.toContain("environment=");
  expect(document.querySelectorAll("#trend .chart-point")).toHaveLength(1);
  const refresh = poll.mock.calls[0]!;
  expect(refresh[1]).toBe(5000);
  refresh[0]();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(document.querySelector("#trend")?.getAttribute("aria-busy")).toBe(
      "false",
    ),
  );
});

it("separates model share from feature actions and keeps token volume out of turn share", async () => {
  const features = [
    {
      ...row("2026-10-10", "feature.attempted", 6, "browser.open"),
      dimension: "feature",
    },
    {
      ...row("2026-10-10", "feature.attempted", 2, "computer.use"),
      dimension: "feature",
    },
    {
      ...row("2026-10-10", "feature.succeeded", 100, "browser.open"),
      dimension: "feature",
    },
  ];
  const fetch = vi.fn(async (url: string) =>
    response(
      result(
        new URL(url, "https://console.example").searchParams.get(
          "dimension",
        ) === "feature"
          ? features
          : [
              row("2026-10-10", "turn.started", 10),
              row("2026-10-10", "turn.started", 30, "codex"),
              row("2026-10-10", "tokens.input", 99999),
            ],
      ),
    ),
  );
  const { document, window } = mount(fetch);
  await vi.waitFor(() =>
    expect(document.querySelector("#ranking")?.textContent).toContain(
      "30 turns",
    ),
  );
  expect(document.querySelector('[aria-label^="Feature actions:"]')).toBeNull();
  expect(
    document.querySelector('[aria-label="Top provider: codex"]'),
  ).not.toBeNull();
  expect(document.querySelector('[aria-label^="Completed turns:"]')).toBeNull();
  expect(document.querySelector("#ranking")?.textContent).toContain("75%");
  expect(document.querySelector("#ranking")?.textContent).toContain("25%");
  expect(document.querySelector("#ranking")?.textContent).toContain("30 turns");
  const measure = document.querySelector<FixtureElement>("#measure")!;
  measure.value = "tokens";
  measure.dispatchEvent(new window.Event("change"));
  expect(document.querySelector("#ranking")?.textContent).toContain("75%");
  expect(fetch).toHaveBeenCalledOnce();
  document.querySelector('[data-view="features"]')!.click();
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Feature actions: 8"]'),
    ).not.toBeNull(),
  );
  expect(
    document.querySelector('[aria-label="Features used: 2"]'),
  ).not.toBeNull();
  expect(document.querySelector('[aria-label^="Input tokens:"]')).toBeNull();
  expect(document.querySelector("#ranking")?.textContent).toContain("Browser");
  expect(document.querySelector("#ranking")?.textContent).toContain(
    "6 actions",
  );
  expect(document.querySelector("#ranking")?.textContent).toContain(
    "Computer use",
  );
  expect(document.querySelector("#ranking")?.textContent).not.toContain("100");
  expect(fetch.mock.calls.at(-1)![0]).toContain("dimension=feature");
});

it("preserves the shared date range and independent tab filters without sending model filters to features", async () => {
  const { document, window, fetch } = mount();
  await vi.waitFor(() =>
    expect(document.querySelector("#trend")?.getAttribute("aria-busy")).toBe(
      "false",
    ),
  );
  expect(
    Array.from(document.querySelectorAll("[data-view]")).map(
      (tab) => tab.textContent,
    ),
  ).toStrictEqual(["Model usage", "Model behavior", "Feature usage"]);
  document.querySelector('[data-days="30"]')!.click();
  const dimension = document.querySelector<FixtureElement>("[name=dimension]")!;
  dimension.value = "model";
  dimension.dispatchEvent(new window.Event("change"));
  const category = document.querySelector<FixtureElement>("[name=value]")!;
  category.value = "gpt-5.4";
  document
    .querySelector("#query")!
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  document.querySelector('[data-view="behavior"]')!.click();
  expect(fetch.mock.calls.at(-1)![0]).toContain("dimension=model");
  expect(fetch.mock.calls.at(-1)![0]).not.toContain("value=");
  expect(document.querySelector("#usage-view")!.hidden).toBe(true);
  expect(document.querySelector("#behavior-view")!.hidden).toBe(false);
  document.querySelector('[data-view="features"]')!.click();
  expect(fetch.mock.calls.at(-1)![0]).toContain(
    "from=2026-09-15&to=2026-10-14",
  );
  expect(fetch.mock.calls.at(-1)![0]).toContain("dimension=feature");
  expect(fetch.mock.calls.at(-1)![0]).not.toContain("value=");
  expect(document.querySelector("#dimension-filter")!.hidden).toBe(true);
  expect(document.querySelector("#measure-filter")!.hidden).toBe(true);
  category.value = "browser.open";
  document
    .querySelector("#query")!
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  document.querySelector('[data-view="usage"]')!.click();
  expect(category.value).toBe("gpt-5.4");
  expect(dimension.value).toBe("model");
  expect(document.querySelector("#dimension-filter")!.hidden).toBe(false);
  expect(fetch.mock.calls.at(-1)![0]).toContain("value=gpt-5.4");
  expect(fetch.mock.calls.at(-1)![0]).toContain("dimension=model");
  document.querySelector('[data-view="features"]')!.click();
  expect(category.value).toBe("browser.open");
  expect(fetch.mock.calls.at(-1)![0]).toContain("value=browser.open");
  await vi.waitFor(() =>
    expect(document.querySelector("#trend")?.getAttribute("aria-busy")).toBe(
      "false",
    ),
  );
});

it("renders released trends with gaps, accessible exact values and keyboard tooltips", async () => {
  const { document, window } = mount();
  const measure = document.querySelector<FixtureElement>("#measure")!;
  measure.value = "tokens";
  measure.dispatchEvent(new window.Event("change"));
  await vi.waitFor(() =>
    expect(document.querySelector("#trend svg")).not.toBeNull(),
  );
  expect(
    document.querySelector('[aria-label="Input tokens: 360"]'),
  ).not.toBeNull();
  expect(document.querySelectorAll("#trend .chart-point")).toHaveLength(4);
  expect(
    document.querySelectorAll(
      '#trend path[aria-label="Input tokens released segment"]',
    ),
  ).toHaveLength(2);
  expect(document.querySelector("#trend")?.textContent).not.toContain(
    "Oct 9 (UTC)",
  );
  const point = document.querySelector<FixtureElement>("#trend .chart-point")!;
  point.focus();
  expect(document.querySelector("#chart-tooltip")?.textContent).toContain(
    "Input tokens: 120",
  );
  expect(document.querySelector<FixtureElement>("#chart-tooltip")?.hidden).toBe(
    false,
  );
  point.blur();
  expect(document.querySelector<FixtureElement>("#chart-tooltip")?.hidden).toBe(
    true,
  );
  expect(document.querySelector("#ranking")?.textContent).toContain("100%");
});

it("changes UTC periods, breakdown and measure through the authenticated API, and renders category names as text", async () => {
  const fetch = vi.fn(async (_url: string, _init?: unknown) =>
    response(
      result([
        row(
          "2026-10-09",
          "feature.attempted",
          50,
          "<img src=x onerror=alert(1)>",
        ),
      ]),
    ),
  );
  const { document, window } = mount(fetch);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  document.querySelector<FixtureElement>('[data-days="30"]')!.click();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1]?.[0]).toContain("from=2026-09-15&to=2026-10-14");
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    credentials: "same-origin",
  });
  document.querySelector('[data-view="features"]')!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#trend-title")?.textContent).toBe(
      "Feature activity",
    ),
  );
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("dimension=feature");
  await vi.waitFor(() =>
    expect(document.querySelector("#ranking")?.textContent).toContain(
      "<img src=x onerror=alert(1)>",
    ),
  );
  expect(document.querySelector("#breakdown-title")?.textContent).toBe(
    "Share of actions by feature",
  );
  expect(document.querySelector("#ranking img")).toBeNull();
  expect(
    document.querySelector('[aria-label="Feature actions: 50"]'),
  ).not.toBeNull();
  const before = fetch.mock.calls.length;
  const measure = document.querySelector<FixtureElement>("#measure")!;
  expect(document.querySelector("#measure-filter")!.hidden).toBe(true);
  expect(fetch.mock.calls).toHaveLength(before);
});

it("clears stale graphs for authentication errors and empty selections rather than showing old totals or zero consumption", async () => {
  const fetch = vi.fn(async (_url: string, _init?: unknown) => response());
  const { document, window } = mount(fetch);
  await vi.waitFor(() =>
    expect(document.querySelector("#trend svg")).not.toBeNull(),
  );
  fetch.mockResolvedValueOnce(response(result(), 401));
  document
    .querySelector("form")!
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector("#status")?.textContent).toBe(
      "Operator authentication required.",
    ),
  );
  expect(document.querySelector("#trend svg")).toBeNull();
  expect(
    document.querySelector('[aria-label="Input tokens: Unavailable"]'),
  ).not.toBeNull();
  fetch.mockResolvedValueOnce(response(result([])));
  document
    .querySelector("form")!
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector("#status")?.textContent).toContain(
      "No reports",
    ),
  );
  expect(document.querySelector("#trend svg")).toBeNull();
  expect(document.querySelector("#ranking")?.textContent).toContain(
    "No activity recorded",
  );
});

it("ignores older responses after the operator changes the selected period", async () => {
  const pending: Array<(value: ReturnType<typeof response>) => void> = [];
  const fetch = vi.fn(
    (_url: string, _init?: unknown) =>
      new Promise<ReturnType<typeof response>>((resolve) =>
        pending.push(resolve),
      ),
  );
  const { document } = mount(fetch);
  document.querySelector<FixtureElement>('[data-days="30"]')!.click();
  pending[1]!(response(result([row("2026-10-10", "tokens.input", 900)])));
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Input tokens: 900"]'),
    ).not.toBeNull(),
  );
  pending[0]!(response());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    document.querySelector('[aria-label="Input tokens: 900"]'),
  ).not.toBeNull();
  expect(document.querySelector('[aria-label="Input tokens: 360"]')).toBeNull();
});

it("switches to model comparisons with explicit sample coverage and excludes unknown attribution", async () => {
  const metrics = (speed: number | null) =>
    Object.fromEntries(
      modelBehaviorMeasures.map((id) => [
        id,
        {
          value: id === "streamRate" ? speed : null,
          samples: id === "streamRate" && speed !== null ? 20 : null,
          days: id === "streamRate" && speed !== null ? 2 : 0,
        },
      ]),
    ) as ModelBehavior["metrics"];
  const fetch = vi.fn(async (_url: string, _init?: unknown) =>
    response(
      result(rows, [
        { model: "claude-sonnet-4-6", metrics: metrics(75) },
        { model: "claude-opus-4-6", metrics: metrics(null) },
        { model: "unknown", metrics: metrics(999) },
      ]),
    ),
  );
  const { document } = mount(fetch);
  document.querySelector('[data-view="behavior"]')!.click();
  await vi.waitFor(() =>
    expect(
      document.querySelector("#behavior-streamRate")?.textContent,
    ).toContain("75"),
  );
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("dimension=model");
  const speed = document.querySelector("#behavior-streamRate")!.textContent!;
  expect(speed).toContain("20 responses");
  expect(speed).toContain("claude-opus-4-6");
  expect(speed).not.toContain("999");
  expect(
    document.querySelector("#behavior-reasoningShare")?.textContent,
  ).toContain("Unavailable");
  expect(document.querySelector("#behavior-reasoningShare h3")).not.toBeNull();
  expect(document.querySelector("#behavior-coverage")?.textContent).toContain(
    "2 attributed model categories",
  );
  document.querySelector('[data-view="usage"]')!.click();
  expect(document.querySelector('[data-view="usage"]')).not.toBeNull();
});
