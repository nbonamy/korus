import { themeCssValueFetches } from './skin-css-values';

// T3's stable skin hooks mapped at the host boundary; SDK components stay format-neutral.
const hooks: Record<string, string> = {
  'data-chat-canvas': '[data-agent-ui-surface="canvas"]',
  'data-theme-id': '[data-app-theme]',
  'data-workspace-area=conversation': '[data-agent-ui-surface="content"]',
  'data-workspace-area=panel': '.app-shell__right-workspace',
  'data-chat-composer-form': '[data-agent-ui-surface="composer"]',
  'data-user-message-bubble': '.chat-message--user .chat-message__stack',
  'data-timeline-root': '.chat-message',
  'data-message-role': '.chat-message',
  'data-message-role=user': '.chat-message--user',
  'data-message-role=assistant': '.chat-message--assistant',
  'data-thread-item': '.agent-sidebar__agent',
  'data-settings-page-scroll': '.settings-panel-frame',
  'data-thread-terminal-drawer': '.terminal-panel',
  'data-slot=composer-host': '[data-agent-ui-surface="composer"]',
  'data-slot=dialog-popup': '.el-dialog',
  'data-slot=popover-popup': '.el-popover',
  'data-slot=menu-popup': ':is(.app-menu:not(.app-menu--embedded), .el-popper)',
  'data-slot=tooltip-popup': '.el-tooltip__popper',
  'data-slot=button': ':is(button, .el-button)',
  'data-slot=input': ':is(input, textarea)',
  'data-slot=switch': '.el-switch',
  'data-slot=select-trigger': '.el-select__wrapper',
};

function translate(selector: string): string {
  return selector
    .replace(/\[(data-[\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g,
      (original, name: string, quoted: string, single: string, bare: string) => {
        const value = quoted ?? single ?? bare;
        return hooks[value === undefined ? name : `${name}=${value}`] ?? original;
      })
    // SDK messages combine T3's timeline wrapper and role element in one node.
    .replace(/\.chat-message:has\((\.chat-message(?:--(?:user|assistant))?)\)/g, '$1')
    .replace(/\.messages-timeline-scroll\b/g, '.agent-ui-message-list__viewport')
    .replace(/\.chat-markdown-codeblock\b/g, '.chat-code-block')
    .replace(/\.chat-markdown\b/g, '.agent-ui-markdown')
    .replace(/\.composer-tiptap\b/g, '.chat-composer__input')
    .replace(/button\[type=["']?submit["']?\]|button\.bg-message-action\b/g, '.agent-ui-composer-send-button');
}

function filterStyle(style: CSSStyleDeclaration): void {
  for (let index = style.length - 1; index >= 0; index--) {
    const property = style.item(index);
    if (themeCssValueFetches(style.getPropertyValue(property))) style.removeProperty(property);
  }
}

type RuleList = { readonly cssRules: CSSRuleList; deleteRule(index: number): void; insertRule(rule: string, index: number): number };

function carryComposerPaint(parent: RuleList, index: number, sourceSelector: string, rule: CSSStyleRule): void {
  if (!/\[(?:data-slot\s*=\s*["']?composer-host["']?|data-chat-composer-form)\]$/.test(sourceSelector)) return;
  // The host attaches shelves to the composer; imported margins cannot break that seam.
  for (let i = rule.style.length - 1; i >= 0; i--) {
    const property = rule.style.item(i);
    if (property === 'margin' || property.startsWith('margin-')) rule.style.removeProperty(property);
  }
  // Shelves share the composer's material, but retain their own layout and animations.
  const paint = ['background', 'background-color', 'background-image', 'background-size',
    'background-position', 'background-repeat', 'backdrop-filter', 'border-color', 'color']
    .flatMap(property => {
      const value = rule.style.getPropertyValue(property);
      return value ? [`${property}:${value}${rule.style.getPropertyPriority(property) ? '!important' : ''}`] : [];
    }).join(';');
  if (!paint) return;
  const selector = rule.selectorText.replaceAll('[data-agent-ui-surface="composer"]',
    ':is(.chat-composer-shelf__actions,.chat-composer-drawer,.chat-goal)');
  parent.insertRule(`${selector}{${paint}}`, index + 1);
}

function adaptRules(parent: RuleList): void {
  for (let index = parent.cssRules.length - 1; index >= 0; index--) {
    const rule = parent.cssRules[index]!;
    if (rule instanceof CSSStyleRule) {
      const sourceSelector = rule.selectorText;
      const selector = translate(sourceSelector);
      rule.selectorText = selector;
      filterStyle(rule.style);
      // CSS nesting can contain further selectors, declarations and conditional rules.
      if ('cssRules' in rule) adaptRules(rule as CSSStyleRule & RuleList);
      carryComposerPaint(parent, index, sourceSelector, rule);
    } else if (rule instanceof CSSKeyframesRule) {
      for (const frame of rule.cssRules) filterStyle((frame as CSSKeyframeRule).style);
    } else if (rule.constructor.name === 'CSSNestedDeclarations') {
      filterStyle((rule as CSSRule & { style: CSSStyleDeclaration }).style);
    } else if (rule.constructor.name === 'CSSPropertyRule') {
      if (themeCssValueFetches(String((rule as CSSRule & { initialValue: string }).initialValue))) parent.deleteRule(index);
    } else if (['CSSMediaRule', 'CSSSupportsRule', 'CSSContainerRule', 'CSSLayerBlockRule', 'CSSStartingStyleRule'].includes(rule.constructor.name)) {
      adaptRules(rule as CSSRule & RuleList);
    } else {
      // Unknown at-rules, imports and fonts cannot bypass the resource filter.
      parent.deleteRule(index);
    }
  }
}

let sheet: CSSStyleSheet | null = null;
let applied = '';
export function applySkinCss(css: string | undefined): void {
  if (typeof CSSStyleSheet === 'undefined' || !CSSStyleSheet.prototype.replaceSync || !('adoptedStyleSheets' in document)) return;
  const next = css ?? '';
  if (next === applied && sheet && document.adoptedStyleSheets.includes(sheet)) return;
  const replacement = new CSSStyleSheet();
  replacement.replaceSync(next);
  adaptRules(replacement);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets.filter(entry => entry !== sheet), ...(next ? [replacement] : [])];
  sheet = next ? replacement : null;
  applied = next;
}
