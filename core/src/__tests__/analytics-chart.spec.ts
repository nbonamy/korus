import { describe, expect, it, vi } from "vitest";
import { LineElement } from "chart.js";
import {
  buildAnalyticsChart,
  type AnalyticsChartSpec,
} from "../analytics-chart";
// Shared adapter failures: missing samples become zero, rates get stacked/fills,
// scales clip values, huge integers round silently, and instances leak hover state.
const theme = {
  text: "#666",
  grid: "#ddd",
  surface: "#fff",
  border: "#ddd",
  fontFamily: "sans-serif",
  tokens: { "--chart-1": "#2274df" },
};
const make = (
  measure: AnalyticsChartSpec["measure"] = "rate",
): AnalyticsChartSpec => ({
  days: ["2026-10-29", "2026-10-30", "2026-10-31"],
  measure,
  series: [
    {
      key: "fast",
      label: "Model · fast",
      color: "var(--chart-1)",
      values: ["61.5", null, "275.6"],
    },
    {
      key: "normal",
      label: "Model",
      color: "#f86",
      values: ["59.9", "0", "120"],
    },
  ],
});
describe("shared Chart.js configuration", () => {
  it("keeps measured zero, missing gaps, clean axes, points and unfilled rates", () => {
    const result = buildAnalyticsChart(make(), theme);
    expect(result.type).toBe("line");
    expect(result.data.datasets.map((row) => row.data)).toStrictEqual([
      [61.5, null, 275.6],
      [59.9, 0, 120],
    ]);
    expect(result.data.datasets[0]).toMatchObject({
      fill: false,
      spanGaps: false,
      cubicInterpolationMode: "monotone",
      pointRadius: 4.5,
      borderColor: "#2274df",
    });
    expect(result.options.scales?.y).toMatchObject({
      min: 0,
      max: 400,
      ticks: { stepSize: 100 },
      stacked: false,
    });
  });
  it("uses stacked quantities and preserves explicitly unknown cost", () => {
    const spec = {
      ...make("usd"),
      stacked: true,
      series: [
        { key: "x", label: "X", color: "#00f", values: ["0", "0.05", null] },
        { key: "y", label: "Y", color: "#f00", values: ["0.1", null, "0.07"] },
      ],
    };
    const result = buildAnalyticsChart(spec, theme);
    expect(result.data.datasets.map((row) => row.data)).toStrictEqual([
      [0, 0.05, null],
      [0.1, null, 0.07],
    ]);
    expect(result.options.scales?.y).toMatchObject({ stacked: true });
    expect(result.data.datasets.map((row) => row.fill)).toStrictEqual([
      false,
      false,
    ]);
  });
  it("supports grouped and stacked bars without changing category identity", () => {
    for (const variant of ["bar", "stacked"] as const) {
      const result = buildAnalyticsChart({ ...make("tokens"), variant }, theme);
      expect(result.type).toBe("bar");
      expect(result.data.labels).toStrictEqual(make().days);
      expect(result.options.scales?.x).toMatchObject({
        stacked: variant === "stacked",
      });
    }
  });
  it("zooms percentages without clipping their valid bounds", () => {
    const result = buildAnalyticsChart(
      {
        ...make("ratio"),
        series: [
          {
            key: "r",
            label: "R",
            color: "blue",
            values: ["0.987", "0.989", null],
          },
        ],
      },
      theme,
    );
    const y = result.options.scales?.y as { min: number; max: number };
    expect(y.min).toBeGreaterThanOrEqual(0);
    expect(y.min).toBeLessThanOrEqual(0.987);
    expect(y.max).toBeGreaterThanOrEqual(0.989);
    expect(y.max).toBeLessThanOrEqual(1);
  });
  it("keeps unsupported numeric values out of canvas while exposing exact values to callers", () => {
    const result = buildAnalyticsChart(
      {
        ...make("count"),
        series: [
          {
            key: "n",
            label: "N",
            color: "blue",
            values: ["9007199254740992", "1", null],
          },
        ],
      },
      theme,
    );
    expect(result.data.datasets[0]!.data).toStrictEqual([null, 1, null]);
    expect(result.unsupported).toBe(true);
  });
  it("keeps legend policy, units and hover state owned by each chart", () => {
    const active = vi.fn(),
      one = buildAnalyticsChart({ ...make(), legend: false }, theme, active),
      two = buildAnalyticsChart(make("milliseconds"), theme);
    expect(one.options.plugins?.legend).toMatchObject({ display: false });
    one.activate(1);
    expect(active).toHaveBeenLastCalledWith(1);
    two.activate(2);
    expect(active).toHaveBeenCalledTimes(1);
    one.activate(null);
    expect(active).toHaveBeenLastCalledWith(null);
  });
});

// Canvas adapters must pass resolved colors, correct calendar/units and isolated
// interaction state to Chart.js, including before its first layout exists.
it("formats shared axes, resolves palette tokens and bounds pointer inspection", () => {
  const active = vi.fn(),
    result = buildAnalyticsChart(
      { ...make(), locale: "en-US" },
      { ...theme, text: "var(--chart-1)" },
      active,
    );
  const x = result.options.scales!.x!,
    y = result.options.scales!.y!;
  expect(x.ticks!.callback!.call({} as never, 0, 0, [])).toBe("Oct 29");
  expect(y.ticks!.callback!.call({} as never, 200, 0, [])).toBe("200");
  for (const [measure, value, label] of [
    ["ratio", 0.987, "98.7%"],
    ["usd", 0.05, "$0.05"],
    ["milliseconds", 1500, "1.5"],
  ] as const) {
    const chart = buildAnalyticsChart(
      { ...make(measure), locale: "en-US" },
      theme,
    );
    expect(
      chart.options.scales!.y!.ticks!.callback!.call({} as never, value, 0, []),
    ).toBe(label);
  }
  const draw = vi.fn(),
    moveTo = vi.fn(),
    lineTo = vi.fn(),
    stroke = vi.fn();
  const chart = {
    scales: { x: { getValueForPixel: () => 99, getPixelForValue: () => 100 } },
    draw,
    chartArea: { top: 0, bottom: 300 },
    ctx: {
      save: vi.fn(),
      beginPath: vi.fn(),
      moveTo,
      lineTo,
      stroke,
      restore: vi.fn(),
    },
  };
  result.options.onHover!.call(
    {} as never,
    { x: 100 } as never,
    [],
    chart as never,
  );
  expect(active).toHaveBeenLastCalledWith(2);
  result.plugins[0]!.afterDraw!.call(
    {} as never,
    chart as never,
    {} as never,
    {} as never,
  );
  expect(moveTo).toHaveBeenCalledWith(100, 0);
  expect(lineTo).toHaveBeenCalledWith(100, 300);
  expect(stroke).toHaveBeenCalledOnce();
  result.plugins[0]!.beforeEvent!.call(
    {} as never,
    chart as never,
    { event: { type: "mouseout" } } as never,
    {} as never,
  );
  expect(active).toHaveBeenLastCalledWith(null);
});
it("creates quantity gradients from the rendered layer bounds and keeps bars solid", () => {
  const chart = buildAnalyticsChart(
    { ...make("tokens"), stacked: true },
    theme,
  );
  const addColorStop = vi.fn(),
    gradient = { addColorStop },
    createLinearGradient = vi.fn(() => gradient);
  const context = {
    chart: {
      chartArea: { top: 0, bottom: 300 },
      scales: { y: { getPixelForValue: (value: number) => 300 - value } },
      ctx: { createLinearGradient },
    },
  };
  const background = chart.data.datasets[1]!.backgroundColor as (
    context: unknown,
  ) => unknown;
  expect(background(context)).toBe(gradient);
  expect(addColorStop).toHaveBeenCalledTimes(2);
  expect(createLinearGradient).toHaveBeenCalledWith(0, 300 - 395.6, 0, 300);
  expect(background({ chart: {} })).toBe("#f86");
  const bar = buildAnalyticsChart({ ...make("count"), variant: "bar" }, theme);
  expect(
    (bar.data.datasets[0]!.backgroundColor as (context: unknown) => unknown)(
      context,
    ),
  ).toBe("#2274df");
});
it("hatches only partial bars and relabels the day in progress", () => {
  const tile = { width: 0, height: 0, getContext: vi.fn() },
    pattern = {},
    ctx = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      createPattern: vi.fn(() => pattern),
    };
  tile.getContext.mockReturnValue(ctx);
  const chart = { canvas: { ownerDocument: { createElement: () => tile } } };
  const spec = make("count");
  const result = buildAnalyticsChart(
    {
      ...spec,
      variant: "bar",
      series: [{ ...spec.series[0]!, partial: [false, false, true] }],
      dayLabels: { "2026-10-31": "Oct 31 · today" },
    },
    theme,
  );
  const background = result.data.datasets[0]!.backgroundColor as (
    context: unknown,
  ) => unknown;
  expect(background({ dataIndex: 0, chart })).toBe("#2274df");
  expect(background({ dataIndex: 2, chart })).toBe(pattern);
  expect(background({ dataIndex: 2, chart: {} })).toBe("#2274df");
  const tick = (
    result.options.scales!.x!.ticks as {
      callback: (value: number, index: number) => string;
    }
  ).callback;
  expect(tick(0, 0)).toBe("Oct 29");
  expect(tick(2, 2)).toBe("Oct 31 · today");
});

// The browser pixel regression owns seamless geometry. This drawing-boundary
// workflow protects curved painting, visibility and switching back to unfilled rates.
it("paints only visible stacked layers and stops painting when the measure changes to a rate", () => {
  const fill = vi.fn(),
    bezierCurveTo = vi.fn();
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill,
    bezierCurveTo,
  };
  const line = (offset: number) =>
    new LineElement({
      points: [
        { x: 0, y: 100 + offset },
        { x: 100, y: 180 + offset },
        { x: 200, y: 80 + offset },
      ],
      options: {
        cubicInterpolationMode: "monotone",
        capBezierPoints: false,
        spanGaps: false,
        backgroundColor: "#00f",
      },
    });
  let visible = [{ dataset: line(0) }, { dataset: line(-30) }];
  const chart = {
    ctx,
    chartArea: { left: 0, top: 0, right: 200, bottom: 300 },
    scales: { y: { getBasePixel: () => 300 } },
    getSortedVisibleDatasetMetas: () => visible,
  };
  const config = buildAnalyticsChart({ ...make("usd"), stacked: true }, theme);
  const draw = (settings: typeof config.options.plugins) => {
    for (const plugin of config.plugins)
      plugin.beforeDatasetsDraw?.call(
        {} as never,
        chart as never,
        {} as never,
        (settings as Record<string, unknown>)?.[plugin.id] ?? {},
      );
  };
  draw(config.options.plugins);
  expect(fill).toHaveBeenCalledTimes(2);
  expect(bezierCurveTo).toHaveBeenCalled();
  fill.mockClear();
  visible = visible.slice(0, 1);
  draw(config.options.plugins);
  expect(fill).toHaveBeenCalledOnce();
  fill.mockClear();
  const rates = buildAnalyticsChart(make("rate"), theme);
  draw(rates.options.plugins);
  expect(fill).not.toHaveBeenCalled();
});

import { seriesColor, providerColorForModel } from "../analytics-palette";
import { analyticsValue, resolveChartColor } from "../analytics-chart";
it("keeps entity hues stable across desktop and console grouping and theme changes", () => {
  for (const model of [
    "claude-sonnet-5-5",
    "gpt-6.1-sol",
    "gemini-3",
    "other",
  ]) {
    expect(seriesColor(model, "model")).toContain(
      model.startsWith("claude")
        ? "--chart-2"
        : model.startsWith("gpt")
          ? "--chart-1"
          : model.startsWith("gemini")
            ? "--chart-3"
            : "--chart-",
    );
    expect(providerColorForModel(model)).toBe(
      model.startsWith("claude")
        ? "var(--chart-2)"
        : model.startsWith("gpt")
          ? "var(--chart-1)"
          : model.startsWith("gemini")
            ? "var(--chart-3)"
            : "var(--chart-4)",
    );
  }
  expect(seriesColor("Unknown", "model")).toBe("var(--color-text-muted)");
  expect(providerColorForModel("Unknown")).toBe("var(--color-text-muted)");
  expect(seriesColor("codex", "provider")).toBe("var(--chart-1)");
  expect(seriesColor("custom", "provider")).toBe("var(--chart-4)");
  expect(seriesColor("/src/project", "repository")).not.toMatch(
    /--chart-[123]\)/,
  );
  expect(
    resolveChartColor("var(--alias)", {
      "--alias": "var(--chart-1)",
      "--chart-1": "#123",
    }),
  ).toBe("#123");
  expect(resolveChartColor("var(--absent)", {})).toBe("transparent");
  expect(analyticsValue(null, "rate", "en-US")).toBe("N/A");
  expect(analyticsValue(61.5, "rate", "en-US")).toBe("61.5 tokens/s");
  expect(analyticsValue(1500, "milliseconds", "en-US")).toBe("1.5 s");
  expect(analyticsValue(0.987, "ratio", "en-US")).toBe("98.7%");
  expect(analyticsValue(19000000, "tokens", "en-US")).toBe("19M");
});

it("retains the crosshair across reactive theme and data rebuilds", () => {
  const interaction = { index: null as number | null };
  const first = buildAnalyticsChart(make(), theme, undefined, interaction);
  const updated = buildAnalyticsChart(
    make(),
    { ...theme, border: "#888" },
    undefined,
    interaction,
  );
  const stroke = vi.fn();
  const chart = {
    scales: { x: { getPixelForValue: () => 100 } },
    chartArea: { top: 0, bottom: 300 },
    ctx: {
      save: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke,
      restore: vi.fn(),
      strokeStyle: "",
    },
  };
  updated.activate(1);
  first.plugins[0]!.afterDraw!.call(
    {} as never,
    chart as never,
    {} as never,
    {} as never,
  );
  expect(stroke).toHaveBeenCalledOnce();
  expect(chart.ctx.strokeStyle).toBe("#888");
});

it("maps constrained canvas input and retains touch inspection through synthetic mouseout", () => {
  const active = vi.fn(),
    state = { index: null as number | null, renderedWidth: () => 250 };
  const config = buildAnalyticsChart(make(), theme, active, state);
  const getValueForPixel = vi.fn(() => 2),
    chart = { width: 1000, scales: { x: { getValueForPixel } }, draw: vi.fn() };
  config.options.onHover!.call(
    {} as never,
    { x: 100, native: { type: "touchstart" } } as never,
    [],
    chart as never,
  );
  expect(getValueForPixel).toHaveBeenCalledWith(400);
  config.plugins[0]!.beforeEvent!.call(
    {} as never,
    chart as never,
    { event: { type: "mouseout" } } as never,
    {} as never,
  );
  expect(active).toHaveBeenLastCalledWith(2);
  config.options.onHover!.call(
    {} as never,
    { x: 100, native: { type: "mousemove" } } as never,
    [],
    chart as never,
  );
  config.plugins[0]!.beforeEvent!.call(
    {} as never,
    chart as never,
    { event: { type: "mouseout" } } as never,
    {} as never,
  );
  expect(active).toHaveBeenLastCalledWith(null);
});
