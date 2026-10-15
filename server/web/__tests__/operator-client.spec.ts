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
  Event: new (name: string, options?: { cancelable: boolean }) => unknown;
  eval(script: string): void;
}
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
  row("2026-10-07", "tokens.input", 120),
  row("2026-10-09", "tokens.input", 240),
  row("2026-10-07", "tokens.output", 40),
  row("2026-10-09", "tokens.output", 80),
  row("2026-10-09", "turn.started", 30),
  row("2026-10-09", "turn.completed", 20),
];
const result = (values = rows, behavior: ModelBehavior[] = []) => ({
  behavior,
  rows: values,
  summary: [],
  updatedAt: "2026-10-14",
  coverage: "Released cells only; withheld values are unavailable.",
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

it("shows exact current-day development turns and refreshes them automatically without mixing production", async () => {
  const fetch = vi.fn(async (_url: string, _init?: unknown) =>
    response(result([row("2026-10-14", "turn.started", 1)])),
  );
  const { document, window, poll } = mount(fetch);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const environment =
    document.querySelector<FixtureElement>("[name=environment]")!;
  expect(environment).not.toBeNull();
  environment.value = "development";
  environment.dispatchEvent(new window.Event("change"));
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Started turns: 1"]'),
    ).not.toBeNull(),
  );
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("environment=development");
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("to=2026-10-14");
  expect(document.querySelector("#trend-title")?.textContent).toBe(
    "Turn activity",
  );
  expect(document.querySelectorAll("#trend .chart-point")).toHaveLength(1);
  expect(document.querySelector("#status")?.textContent).toContain(
    "Development",
  );
  expect(document.querySelector("#status")?.textContent).not.toContain(
    "bins of ten",
  );
  const refresh = poll.mock.calls[0]!;
  expect(refresh[1]).toBe(5000);
  const calls = fetch.mock.calls.length;
  refresh[0]();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(calls + 1));
  environment.value = "production";
  environment.dispatchEvent(new window.Event("change"));
  await vi.waitFor(() =>
    expect(fetch.mock.calls.at(-1)?.[0]).toContain("environment=production"),
  );
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("to=2026-10-13");
  const productionCalls = fetch.mock.calls.length;
  refresh[0]();
  expect(fetch).toHaveBeenCalledTimes(productionCalls);
});

it("renders released trends with gaps, accessible exact values and keyboard tooltips without inventing unknown outcomes", async () => {
  const { document } = mount();
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
    "Oct 8 (UTC)",
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
  expect(document.querySelector("#ranking")?.textContent).toContain("360");
  expect(document.querySelector("#outcomes")?.textContent).toContain(
    "Completed",
  );
  expect(document.querySelector("#outcomes")?.textContent).toContain(
    "Unavailable",
  );
  expect(
    document.querySelector('#outcomes [aria-label="Released outcomes: 20"]'),
  ).not.toBeNull();
});

it("changes UTC periods, breakdown and measure through the authenticated API, and renders category names as text", async () => {
  const fetch = vi.fn(async (_url: string, _init?: unknown) =>
    response(
      result([
        row(
          "2026-10-09",
          "feature.succeeded",
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
  expect(fetch.mock.calls[1]?.[0]).toContain("from=2026-09-14&to=2026-10-13");
  expect(fetch.mock.calls[1]?.[1]).toMatchObject({
    credentials: "same-origin",
  });
  const dimension = document.querySelector<FixtureElement>("[name=dimension]")!;
  dimension.value = "feature";
  dimension.dispatchEvent(new window.Event("change"));
  await vi.waitFor(() =>
    expect(document.querySelector("#trend-title")?.textContent).toBe(
      "Feature activity",
    ),
  );
  expect(fetch.mock.calls.at(-1)?.[0]).toContain("dimension=feature");
  await vi.waitFor(() =>
    expect(document.querySelector("#breakdown-title")?.textContent).toBe(
      "Succeeded by feature",
    ),
  );
  expect(document.querySelector("#ranking")?.textContent).toContain(
    "<img src=x onerror=alert(1)>",
  );
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector('[aria-label="Succeeded: 50"]')).not.toBeNull();
  const before = fetch.mock.calls.length;
  const measure = document.querySelector<FixtureElement>("#measure")!;
  measure.value = "turns";
  measure.dispatchEvent(new window.Event("change"));
  expect(document.querySelector("#trend")?.textContent).toContain(
    "No released data",
  );
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
      "No released data",
    ),
  );
  expect(document.querySelector("#trend svg")).toBeNull();
  expect(document.querySelector("#ranking")?.textContent).toContain(
    "No released data",
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
  pending[1]!(response(result([row("2026-10-09", "tokens.input", 900)])));
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
