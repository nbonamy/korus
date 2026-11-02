import type {
  ChartData,
  ChartDataset,
  ChartOptions,
  Plugin,
  LineElement,
  ChartType,
  ScriptableContext,
} from "chart.js";
declare module "chart.js" {
  interface PluginOptionsByType<TType extends ChartType> {
    "analytics-stack-fill"?: { enabled: boolean };
  }
}
export type AnalyticsMeasure =
  | "count"
  | "tokens"
  | "usd"
  | "ratio"
  | "rate"
  | "milliseconds";
export type AnalyticsSeries = {
  key?: string;
  label: string;
  color: string;
  order?: number;
  values: readonly (string | number | null)[];
};
export type AnalyticsChartSpec = {
  days: readonly string[];
  series: readonly AnalyticsSeries[];
  measure: AnalyticsMeasure;
  variant?: "line" | "bar" | "stacked";
  stacked?: boolean;
  legend?: boolean;
  locale?: string;
  area?: "gradient" | "solid" | "none";
  bounds?: { min: number; max: number; step: number };
};
export type AnalyticsChartTheme = {
  text: string;
  grid: string;
  surface: string;
  border: string;
  fontFamily: string;
  tokens: Record<string, string>;
};
export function niceChartScale(maximum: number, ticks = 4, fractional = false) {
  const raw = Math.max(maximum, fractional ? Number.MIN_VALUE : 1) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((n) => raw <= n * magnitude) ?? 10;
  const step = fractional ? unit * magnitude : Math.max(1, unit * magnitude);
  return { max: step * ticks, step };
}
export function resolveChartColor(
  value: string,
  tokens: Record<string, string>,
): string {
  let result = value;
  for (let i = 0; i < 8 && result.includes("var("); i++)
    result = result.replace(
      /var\((--[\w-]+)\)/g,
      (_match, key: string) => tokens[key] || "transparent",
    );
  return result;
}
export function analyticsNumber(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER
    ? number
    : null;
}
export function analyticsDay(
  day: string,
  long = false,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...(long ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(day + "T00:00:00Z"));
}
export function analyticsValue(
  value: string | number | null | undefined,
  measure: AnalyticsMeasure,
  locale?: string,
): string {
  if (value == null) return "N/A";
  const number = Number(value);
  if (measure === "usd")
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number);
  if (measure === "ratio")
    return (
      new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
        number * 100,
      ) + "%"
    );
  const label = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    ...(measure === "tokens" ? { notation: "compact" as const } : {}),
  }).format(measure === "milliseconds" ? number / 1000 : number);
  return (
    label +
    (measure === "rate" ? " tokens/s" : measure === "milliseconds" ? " s" : "")
  );
}
function chartScale(
  spec: AnalyticsChartSpec,
  values: (number | null)[][],
  stacked: boolean,
) {
  if (spec.measure === "ratio") {
    const observed = values
      .flat()
      .filter((value): value is number => value !== null)
      .map((value) => value * 100);
    if (!observed.length) return { min: 0, max: 1, step: 0.25 };
    const low = Math.min(...observed),
      high = Math.max(...observed),
      padding = Math.max((high - low) * 0.1, 0.05);
    const lower = Math.max(0, low - padding),
      upper = Math.min(100, high + padding),
      step = niceChartScale(upper - lower, 4, true).step;
    return {
      min: Math.max(0, Math.floor(lower / step) * step) / 100,
      max: Math.min(100, Math.ceil(upper / step) * step) / 100,
      step: step / 100,
    };
  }
  const maximum = stacked
    ? Math.max(
        0,
        ...spec.days.map((_, index) =>
          values.reduce((sum, row) => sum + (row[index] ?? 0), 0),
        ),
      )
    : Math.max(0, ...values.flat().map((value) => value ?? 0));
  const unit = spec.measure === "milliseconds" ? 1000 : 1;
  const scale = niceChartScale(
    (maximum || 1) / unit,
    4,
    spec.measure === "usd" || spec.measure === "milliseconds",
  );
  return { min: 0, max: scale.max * unit, step: scale.step * unit };
}
/** Keep this state for the chart lifetime: vue-chartjs retains plugins across option updates. */
export type AnalyticsChartInteraction = {
  index: number | null;
  border?: string;
  touch?: boolean;
  renderedWidth?: () => number;
};
/** Browser-neutral Chart.js policy shared by desktop and console adapters. */
export function buildAnalyticsChart(
  spec: AnalyticsChartSpec,
  theme: AnalyticsChartTheme,
  onActive?: (index: number | null) => void,
  interaction: AnalyticsChartInteraction = { index: null },
) {
  theme = {
    ...theme,
    text: resolveChartColor(theme.text, theme.tokens),
    grid: resolveChartColor(theme.grid, theme.tokens),
    surface: resolveChartColor(theme.surface, theme.tokens),
    border: resolveChartColor(theme.border, theme.tokens),
  };
  const type: "line" | "bar" =
    spec.variant && spec.variant !== "line" ? "bar" : "line";
  const rate = ["rate", "milliseconds", "ratio"].includes(spec.measure);
  const stacked = spec.variant === "stacked" || Boolean(spec.stacked);
  const curvedStack =
    type === "line" && stacked && !rate && spec.area !== "none";
  const values = spec.series.map((row) =>
    spec.days.map((_, index) => analyticsNumber(row.values[index])),
  );
  const scale = spec.bounds ?? chartScale(spec, values, stacked);
  interaction.border = theme.border;
  const activate = (index: number | null) => {
    interaction.index = index;
    onActive?.(index);
  };
  const data: ChartData<"line", (number | null)[], string> = {
    labels: [...spec.days],
    datasets: spec.series.map(
      (row, index): ChartDataset<"line", (number | null)[]> => {
        const color = resolveChartColor(row.color, theme.tokens);
        return {
          label: row.label,
          order: row.order,
          data: values[index]!,
          borderColor: color,
          borderWidth: 2,
          backgroundColor: (context: ScriptableContext<"line">) => {
            if (rate || type === "bar" || spec.area === "solid") return color;
            const { chart } = context,
              area = chart.chartArea;
            if (!area) return color;
            const lower = spec.days.map((_, day) =>
              stacked
                ? values
                    .slice(0, index)
                    .reduce((sum, row) => sum + (row[day] ?? 0), 0)
                : 0,
            );
            const upper = lower.map(
              (base, day) => base + (values[index]?.[day] ?? 0),
            );
            const y = chart.scales.y!;
            const gradient = chart.ctx.createLinearGradient(
              0,
              y.getPixelForValue(Math.max(...upper)),
              0,
              y.getPixelForValue(Math.min(...lower)),
            );
            gradient.addColorStop(
              0,
              `color-mix(in srgb, ${color} 92%, transparent)`,
            );
            gradient.addColorStop(
              1,
              `color-mix(in srgb, ${color} 28%, transparent)`,
            );
            return gradient;
          },
          fill:
            rate || spec.area === "none" || curvedStack
              ? false
              : stacked && index > 0
                ? "stack"
                : "origin",
          spanGaps: false,
          cubicInterpolationMode: "monotone",
          pointRadius: rate ? 4.5 : 0,
          pointHoverRadius: 4.5,
          pointBackgroundColor: color,
          pointBorderColor: theme.surface,
          pointBorderWidth: 2,
        };
      },
    ),
  };
  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    normalized: true,
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 16, right: 8 } },
    font: { family: theme.fontFamily, size: 11 },
    plugins: {
      legend: {
        display: spec.legend !== false && spec.series.length > 1,
        position: "bottom",
        align: "start",
        labels: {
          color: theme.text,
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          pointStyle: "rectRounded",
          font: { family: theme.fontFamily, size: 12 },
        },
      },
      tooltip: { enabled: false },
      // The shared plugin clips against the real curved boundaries. Chart.js's
      // built-in 'stack' target joins the lower samples with straight segments.
      "analytics-stack-fill": { enabled: curvedStack },
    },
    scales: {
      x: {
        type: "category",
        stacked,
        offset: type === "bar",
        border: { display: false },
        grid: { display: false },
        ticks: {
          color: theme.text,
          font: { family: theme.fontFamily, size: 11 },
          autoSkip: true,
          maxTicksLimit: 7,
          maxRotation: 0,
          callback: (_value, index) =>
            analyticsDay(spec.days[index]!, false, spec.locale),
        },
      },
      y: {
        type: "linear",
        stacked,
        min: scale.min,
        max: scale.max,
        border: { display: false },
        grid: { color: theme.grid, lineWidth: 1 },
        ticks: {
          color: theme.text,
          font: { family: theme.fontFamily, size: 11 },
          stepSize: scale.step,
          callback: (value) => {
            const number = Number(value);
            if (spec.measure === "ratio")
              return (
                new Intl.NumberFormat(spec.locale, {
                  maximumFractionDigits: Math.max(
                    1,
                    Math.ceil(-Math.log10(scale.step * 100)) + 1,
                  ),
                }).format(number * 100) + "%"
              );
            if (spec.measure === "usd")
              return analyticsValue(number, "usd", spec.locale);
            return new Intl.NumberFormat(spec.locale, {
              maximumFractionDigits: 1,
              notation: "compact",
            }).format(spec.measure === "milliseconds" ? number / 1000 : number);
          },
        },
      },
    },
    onHover: (event, _elements, chart) => {
      const native = event.native as
        | { type?: string; sourceCapabilities?: { firesTouchEvents?: boolean } }
        | undefined;
      interaction.touch = Boolean(
        native?.type?.startsWith("touch") ||
        native?.sourceCapabilities?.firesTouchEvents,
      );
      const index =
        event.x == null
          ? null
          : Math.max(
              0,
              Math.min(
                spec.days.length - 1,
                Math.round(
                  Number(
                    chart.scales.x!.getValueForPixel(
                      event.x *
                        (interaction.renderedWidth
                          ? chart.width /
                            (interaction.renderedWidth() || chart.width)
                          : 1),
                    ),
                  ),
                ),
              ),
            );
      activate(Number.isFinite(index) ? index : null);
      chart.draw();
    },
  };
  const plugins: Plugin[] = [
    {
      id: "analytics-crosshair",
      beforeEvent: (chart, args) => {
        if (args.event.type === "mouseout" && !interaction.touch) {
          activate(null);
          args.changed = true;
        } else if (
          args.event.type !== "mouseout" &&
          args.inChartArea === false
        ) {
          // Padding belongs to the nearest date, just like the plot itself.
          chart.options.onHover?.call(chart, args.event, [], chart);
          args.changed = true;
        }
      },
      afterDraw: (chart) => {
        if (interaction.index === null) return;
        const x = chart.scales.x!.getPixelForValue(interaction.index),
          { ctx, chartArea } = chart;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.lineWidth = 1;
        ctx.strokeStyle = interaction.border!;
        ctx.stroke();
        ctx.restore();
      },
    },
    {
      id: "analytics-stack-fill",
      beforeDatasetsDraw: (chart, _args, settings) => {
        if (!settings.enabled) return;
        const { ctx, chartArea: area } = chart,
          layers = chart.getSortedVisibleDatasetMetas(),
          baseline = chart.scales.y!.getBasePixel();
        // Use the same Bézier paths as the strokes, including their null gaps.
        // Excluding every lower layer also handles a missing immediate neighbor.
        const areaPath = (line: LineElement) => {
          for (const segment of line.segments) {
            line.pathSegment(ctx, segment, { move: true });
            ctx.lineTo(line.points[segment.end]!.x!, baseline);
            ctx.lineTo(line.points[segment.start]!.x!, baseline);
            ctx.closePath();
          }
        };
        for (const meta of layers)
          (meta.dataset as LineElement).updateControlPoints(area, "x");
        for (let index = 0; index < layers.length; index++) {
          const line = layers[index]!.dataset as LineElement;
          ctx.save();
          ctx.beginPath();
          ctx.rect(
            area.left,
            area.top,
            area.right - area.left,
            area.bottom - area.top,
          );
          ctx.clip();
          for (const lower of layers.slice(0, index)) {
            ctx.beginPath();
            ctx.rect(
              area.left,
              area.top,
              area.right - area.left,
              area.bottom - area.top,
            );
            areaPath(lower.dataset as LineElement);
            ctx.clip("evenodd");
          }
          ctx.beginPath();
          areaPath(line);
          ctx.fillStyle = line.options.backgroundColor;
          ctx.fill();
          ctx.restore();
        }
      },
    },
  ];
  return {
    type,
    data,
    options,
    plugins,
    activate,
    unsupported: spec.series.some((row) =>
      row.values.some(
        (value) => value !== null && analyticsNumber(value) === null,
      ),
    ),
  };
}
