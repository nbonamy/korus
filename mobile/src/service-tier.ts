/** The standard speed under the names providers give it; selecting it is the same as no tier. */
const standard = new Set(['normal', 'default']);

/**
 * The composer's speed button, as on the desktop: each press steps from standard through the model's faster tiers
 * in catalog order and back to standard. A tier the model no longer lists steps back to standard.
 */
export function serviceTierCycle(offered: readonly { id: string }[], selected: string | null): { tiers: string[]; active: string | null; next: string | null } {
  const tiers = offered.map(tier => tier.id).filter(id => !standard.has(id));
  const active = selected && !standard.has(selected) ? selected : null;
  if (!tiers.length) return { tiers, active, next: null };
  const index = active ? tiers.indexOf(active) : -1;
  const next = !active ? tiers[0]! : index < 0 || index === tiers.length - 1 ? null : tiers[index + 1]!;
  return { tiers, active, next };
}
