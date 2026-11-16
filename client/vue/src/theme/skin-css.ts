import { themeCssValueFetches } from './skin-css-values';

// T3's stable skin hooks mapped at the host boundary; SDK components stay format-neutral.
const hooks: Record<string, string> = {
  'data-chat-canvas': '.agent-ui-conversation-pane',
  'data-chat-column': '.agent-ui-conversation-pane',
  'data-theme-id': '[data-app-theme]',
  'data-workspace-area=conversation': '.agent-ui-conversation-pane__layout',
  'data-workspace-area=panel': '.app-shell__right-workspace',
  'data-workspace-area=settings-nav': '.settings-sidebar',
  'data-chat-header': '.agent-header',
  'data-chat-composer-form': '.chat-composer',
  'data-user-message-bubble': '.chat-message--user .chat-message__stack',
  'data-timeline-root': '.chat-message',
  'data-message-role': '.chat-message',
  'data-message-role=user': '.chat-message--user',
  'data-message-role=assistant': '.chat-message--assistant',
  'data-thread-item': '.agent-sidebar__agent',
  'data-app-sidebar': '.agent-sidebar',
  'data-settings-page-scroll': '.settings-panel-frame',
  'data-thread-terminal-drawer': '.terminal-panel',
  'data-slot=sidebar-wrapper': '.app-shell',
  'data-slot=sidebar': '.agent-sidebar',
  'data-slot=sidebar-inner': ':is(.agent-sidebar, .settings-sidebar)',
  'data-slot=sidebar-container': '.app-shell__nav',
  'data-slot=sidebar-inset': '.app-shell__content',
  'data-slot=composer-host': '.chat-composer',
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
    .replace(/\.messages-timeline-scroll\b/g, '.agent-ui-conversation-pane__messages')
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

function skinSelector(selector: string): string {
  // A host component's Vue scope attribute must not outrank an imported skin.
  // Split only the outer list: commas inside :is(), :has() or attributes stay intact.
  const selectors: string[] = [];
  let start = 0, depth = 0, quote = '';
  for (let index = 0; index <= selector.length; index++) {
    const char = selector[index];
    if (char === '\\') { index++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if ((char === ',' && depth === 0) || char === undefined) {
      const item = selector.slice(start, index).trim();
      selectors.push(item.startsWith(':root') ? `:root${item}`
        // Root branches inside :is()/ :where() must not become descendants of themselves.
        : /^(?:html\b|:(?:is|where)\(\s*html\b)/.test(item) ? item.replace(/\bhtml\b/, 'html:root')
          : /^\.dark\b/.test(item) ? `:root${item}` : `:root ${item}`);
      start = index + 1;
    }
  }
  return selectors.join(',');
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
  const selector = rule.selectorText.replace(/\.chat-composer(?![\w-])/g,
    ':is(.chat-composer-shelf__actions,.chat-composer-drawer,.chat-goal)');
  parent.insertRule(`${selector}{${paint}}`, index + 1);
}

function adaptRules(parent: RuleList, nested = false): void {
  for (let index = parent.cssRules.length - 1; index >= 0; index--) {
    const rule = parent.cssRules[index]!;
    if (rule instanceof CSSStyleRule) {
      const sourceSelector = rule.selectorText;
      const selector = translate(sourceSelector);
      rule.selectorText = nested ? selector : skinSelector(selector);
      filterStyle(rule.style);
      // CSS nesting can contain further selectors, declarations and conditional rules.
      if ('cssRules' in rule) adaptRules(rule as CSSStyleRule & RuleList, true);
      carryComposerPaint(parent, index, sourceSelector, rule);
    } else if (rule instanceof CSSKeyframesRule) {
      for (const frame of rule.cssRules) filterStyle((frame as CSSKeyframeRule).style);
    } else if (rule.constructor.name === 'CSSNestedDeclarations') {
      filterStyle((rule as CSSRule & { style: CSSStyleDeclaration }).style);
    } else if (rule.constructor.name === 'CSSPropertyRule') {
      if (themeCssValueFetches(String((rule as CSSRule & { initialValue: string }).initialValue))) parent.deleteRule(index);
    } else if (['CSSMediaRule', 'CSSSupportsRule', 'CSSContainerRule', 'CSSLayerBlockRule', 'CSSStartingStyleRule'].includes(rule.constructor.name)) {
      adaptRules(rule as CSSRule & RuleList, nested);
    } else {
      // Unknown at-rules, imports and fonts cannot bypass the resource filter.
      parent.deleteRule(index);
    }
  }
}

// Generic host styling supplies the surfaces that a T3 skin expects beneath its CSS.
const bridge = `
@layer host-skin-invariants {
  .agent-sidebar,.settings-sidebar {border-radius:0!important}
  .app-menu:not(.app-menu--embedded),.el-popper,.agent-ui-composer-menu__list {
    background-color:var(--color-menu-background)!important;
  }
}
.agent-ui-conversation-pane__messages,.agent-ui-workbench-layout,.agent-ui-workbench-layout__body,
.agent-ui-workbench-layout__body-content,.agent-ui-workbench-layout__footer {background:transparent}
.agent-ui-conversation-pane__layout {--workbench-layout-footer-background:transparent!important}
.chat-message--user .chat-message__stack {background:var(--skin-message-surface);color:var(--skin-message-foreground)}
.chat-code-block {background:var(--skin-code-background);color:var(--skin-code-foreground)}
.chat-composer {--agent-ui-composer-button-background:var(--skin-message-action);--agent-ui-composer-button-color:var(--skin-message-action-foreground)}
.chat-composer::after {content:"";position:absolute;inset:0;pointer-events:none;border:1px solid var(--color-border);border-radius:inherit}
.agent-sidebar {color:var(--skin-sidebar-muted-foreground)}
.agent-sidebar__agent--active {background:var(--skin-sidebar-row-selected)}
.agent-sidebar__agent--active .agent-sidebar__name {color:var(--skin-sidebar-foreground)}
.agent-sidebar__agent:not(.agent-sidebar__agent--active):hover,.settings-sidebar .el-menu-item:hover {background:var(--skin-sidebar-row-hover)}
`;

let sheet: CSSStyleSheet | null = null;
let applied = '';
export function applySkinCss(css: string | undefined, custom: boolean): void {
  if (typeof CSSStyleSheet === 'undefined' || !CSSStyleSheet.prototype.replaceSync || !('adoptedStyleSheets' in document)) return;
  const next = custom ? `${bridge}\n${css ?? ''}` : '';
  if (next === applied && sheet && document.adoptedStyleSheets.includes(sheet)) return;
  const replacement = new CSSStyleSheet();
  replacement.replaceSync(next);
  adaptRules(replacement);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets.filter(entry => entry !== sheet), ...(next ? [replacement] : [])];
  sheet = next ? replacement : null;
  applied = next;
}
