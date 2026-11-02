import type { AnalyticsChartTheme } from "@workspace/core/analytics-chart";
export function readAnalyticsTheme(): AnalyticsChartTheme {
  const style = getComputedStyle(document.documentElement),
    tokens: Record<string, string> = {};
  for (const name of Array.from(style))
    if (name.startsWith("--"))
      tokens[name] = style.getPropertyValue(name).trim();
  return {
    text:
      tokens["--color-text-muted"] ||
      tokens["--color-on-surface-variant"] ||
      "#666",
    grid:
      tokens["--color-border"] || tokens["--color-outline-variant"] || "#ddd",
    surface: tokens["--color-surface-lowest"] || "#fff",
    border: tokens["--color-outline"] || "#aaa",
    fontFamily: getComputedStyle(document.body).fontFamily || "sans-serif",
    tokens,
  };
}
