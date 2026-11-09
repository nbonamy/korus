type UsageGrouping = "provider" | "model" | "repository";
const slot = (n: number) => `var(--chart-${n})`;
const providerSlots: Record<string, number> = {
  codex: 1,
  claude: 2,
  antigravity: 3,
  cursor: 4,
};
// Models take their provider's hue, shaded per model, so a model list reads
// as families; unrecognized models fall on the remaining slots.
const modelFamilies: Array<[RegExp, number]> = [
  [/claude|opus|sonnet|haiku|fable/i, 2],
  [/gpt|codex|^o\d/i, 1],
  [/gemini|antigravity/i, 3],
];
const shades = [
  (c: string) => c,
  (c: string) => `color-mix(in oklab, ${c} 68%, white)`,
  (c: string) => `color-mix(in oklab, ${c} 46%, white)`,
];
const hashOf = (label: string) =>
  [...label].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
export function seriesColor(label: string, group: UsageGrouping): string {
  if (label === "Unknown") return "var(--color-text-muted)";
  if (group === "provider") return slot(Object.hasOwn(providerSlots, label) ? providerSlots[label]! : 4);
  const hash = hashOf(label);
  // Repositories stay off the provider hues (1-3) so a colour never suggests a provider.
  if (group === "repository")
    return shades[(hash >>> 3) % shades.length]!(slot(4 + (hash % 5)));
  const family = modelFamilies.find(([pattern]) => pattern.test(label))?.[1];
  return family
    ? shades[hash % shades.length]!(slot(family))
    : slot(4 + (hash % 5));
}
/** Returns the shared provider hue for a known model family. */
export function providerColorForModel(label: string): string {
  if (label === "Unknown") return "var(--color-text-muted)";
  const family = modelFamilies.find(([pattern]) => pattern.test(label))?.[1];
  return family ? slot(family) : "var(--chart-4)";
}
