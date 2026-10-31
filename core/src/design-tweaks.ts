import type { DesignNode } from './design';

type TweakTarget = { id: string; label: string; nodeId: string; property: string };
export type DesignTweak = TweakTarget & (
  | { type: 'range'; min: number; max: number; step: number; unit: string }
  | { type: 'color' }
  | { type: 'select'; options: { label: string; value: string }[] }
  | { type: 'toggle'; on: string; off: string }
);
export type DesignTweakValue = string | number | boolean;
export type DesignTweakEdit =
  | { type: 'tweak-set'; tweak: DesignTweak }
  | { type: 'tweak-remove'; tweakId: string }
  | { type: 'tweak-value'; tweakId: string; value: DesignTweakValue };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const label = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 100;
const cssValue = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200 && !/url\s*\(|@import|expression\s*\(|\\|</i.test(value);

export function isDesignTweaks(value: unknown, nodes: DesignNode[]): value is DesignTweak[] {
  if (!Array.isArray(value) || value.length > 200) return false;
  const ids = new Set<string>();
  const bindings = new Set<string>();
  return value.every(item => {
    if (!object(item) || typeof item.id !== 'string' || !/^[a-zA-Z][\w-]{0,99}$/.test(item.id) || ids.has(item.id)
      || !label(item.label) || !nodes.some(node => node.id === item.nodeId)
      || typeof item.property !== 'string' || !/^(--[\w-]+|[a-z][a-z-]*)$/.test(item.property) || item.property.length > 100) return false;
    const binding = `${item.nodeId}:${item.property}`;
    if (bindings.has(binding)) return false;
    ids.add(item.id); bindings.add(binding);
    if (item.type === 'color') return true;
    if (item.type === 'range') return typeof item.min === 'number' && Number.isFinite(item.min) && typeof item.max === 'number' && Number.isFinite(item.max)
      && item.min < item.max && Math.abs(item.min) <= 1e6 && Math.abs(item.max) <= 1e6
      && typeof item.step === 'number' && Number.isFinite(item.step) && item.step > 0 && item.step <= item.max - item.min
      && ['', 'px', 'rem', 'em', '%', 'vh', 'vw', 'deg', 'ms', 's'].includes(String(item.unit));
    if (item.type === 'toggle') return cssValue(item.on) && cssValue(item.off) && item.on !== item.off;
    return item.type === 'select' && Array.isArray(item.options) && item.options.length >= 1 && item.options.length <= 20
      && item.options.every(option => object(option) && label(option.label) && cssValue(option.value))
      && new Set(item.options.map(option => (option as { value: string }).value)).size === item.options.length;
  });
}

/** Values enter through the daemon; previews use exactly the same conversion. */
export function designTweakCss(tweak: DesignTweak, value: DesignTweakValue): string {
  if (tweak.type === 'range' && typeof value === 'number' && Number.isFinite(value) && value >= tweak.min && value <= tweak.max
    && Math.abs((value - tweak.min) / tweak.step - Math.round((value - tweak.min) / tweak.step)) < 1e-6) return `${value}${tweak.unit}`;
  if (tweak.type === 'color' && typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)) return value;
  if (tweak.type === 'select' && typeof value === 'string' && tweak.options.some(option => option.value === value)) return value;
  if (tweak.type === 'toggle' && typeof value === 'boolean') return value ? tweak.on : tweak.off;
  throw new Error('Invalid tweak value.');
}

/** A manual CSS override may be outside a generated control's choices. */
export function readDesignTweak(tweak: DesignTweak, node: DesignNode): DesignTweakValue | null {
  const css = node.styles?.[tweak.property];
  if (css === undefined) return null;
  if (tweak.type === 'range') {
    if (tweak.unit && !css.endsWith(tweak.unit)) return null;
    const value = Number(tweak.unit ? css.slice(0, -tweak.unit.length) : css);
    try { return designTweakCss(tweak, value) === css ? value : null; } catch { return null; }
  }
  if (tweak.type === 'toggle') return css === tweak.on ? true : css === tweak.off ? false : null;
  try { return designTweakCss(tweak, css); } catch { return null; }
}
