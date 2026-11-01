export type MarkdownHeading = {
  id: string;
  text: string;
  level: number;
  depth: number;
  element: HTMLElement;
};

/** Read only SDK-rendered document headings; never parse untrusted Markdown again. */
export function collectMarkdownHeadings(root: HTMLElement, documentId: string): MarkdownHeading[] {
  const parents: number[] = [];
  const headings: MarkdownHeading[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')) {
    if (element.closest('pre,code')) continue;
    const label = element.cloneNode(true) as HTMLElement;
    label.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    label.querySelectorAll('img').forEach(image => image.replaceWith(image.alt));
    const text = label.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!text) continue;
    const level = Number(element.tagName.slice(1));
    while (parents.length && parents[parents.length - 1] >= level) parents.pop();
    const id = `${documentId}-heading-${headings.length + 1}`;
    element.id = id;
    headings.push({ id, text, level, depth: parents.length, element });
    parents.push(level);
  }
  return headings;
}
