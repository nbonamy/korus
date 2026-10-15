import { renderMarkdown } from '@codex-app-sdk/vue';

export type PlanChoiceGroup = {
  id: string;
  quote: string;
  kind: 'checkbox' | 'radio';
  options: { label: string; proposed: boolean }[];
};
export type PlanMarkdownSection = {
  id: string;
  title: string;
  heading: string;
  blocks: ({ html: string } | { choice: PlanChoiceGroup })[];
};

/** Decorate SDK-rendered Markdown. Never reparse source or enable authored HTML. */
export function planMarkdownSections(markdown: string, interactive = true): PlanMarkdownSection[] {
  const document = new DOMParser().parseFromString(renderMarkdown(markdown), 'text/html');
  const sections: PlanMarkdownSection[] = [];
  let section: PlanMarkdownSection | undefined;
  let groups = 0;
  for (const element of document.body.children) {
    const heading = /^H[1-6]$/u.test(element.tagName);
    if (!section || heading) {
      section = {
        id: `s${sections.length}`,
        title: heading ? element.textContent?.trim() || 'Plan' : 'Plan',
        heading: heading ? element.outerHTML : '',
        blocks: [],
      };
      sections.push(section);
    }
    if (heading) continue;
    const choice = interactive && choiceGroup(element, `${section.id}-g${groups}`, section.title);
    if (choice) {
      section.blocks.push({ choice });
      groups++;
    } else section.blocks.push({ html: element.outerHTML });
  }
  return sections;
}
function choiceGroup(list: Element, id: string, question: string): PlanChoiceGroup | undefined {
  if (list.tagName !== 'UL' || list.children.length > 100) return;
  let kind: 'checkbox' | 'radio' | undefined;
  const options: PlanChoiceGroup['options'] = [];
  for (const item of list.children) {
    // Mixed lists, nested tasks and quoted/code examples keep normal Markdown semantics.
    if (item.tagName !== 'LI' || item.querySelector('ul,ol,pre,blockquote')) return;
    const clone = item.cloneNode(true) as Element;
    const input = clone.querySelector('input[type="checkbox"]');
    let proposed = false;
    let label = '';
    const itemKind = input ? 'checkbox' : 'radio';
    if (kind && kind !== itemKind) return;
    kind = itemKind;
    if (input) {
      proposed = input.hasAttribute('checked');
      input.remove();
      label = clone.textContent?.trim() ?? '';
    } else {
      const match = /^\(([ xX])\)\s+([\s\S]+)$/u.exec(clone.textContent?.trim() ?? '');
      if (!match) return;
      proposed = match[1]!.toLowerCase() === 'x';
      label = match[2]!.trim();
    }
    if (!label || label.length > 2000 || options.some((option) => option.label === label)) return;
    options.push({ label, proposed });
  }
  if (
    !kind ||
    !options.length ||
    (kind === 'radio' && (options.length < 2 || options.filter((o) => o.proposed).length > 1))
  )
    return;
  const quote = `${question}\n${options.map((o) => o.label).join('\n')}`;
  return quote.length <= 4000 ? { id, quote, kind, options } : undefined;
}
