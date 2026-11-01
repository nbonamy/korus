export function sanitizeSvg(source: string): string {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.tagName.toLowerCase() !== 'svg') {
    throw new Error('The visualization did not produce valid SVG.');
  }
  document.querySelectorAll('script, foreignObject, iframe, object, embed').forEach(element => element.remove());
  document.querySelectorAll('style').forEach(element => {
    element.textContent = sanitizeCssUrlReferences(element.textContent ?? '')
      .replace(/@import\s+[^;]+;?/giu, '');
  });
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith('on')
        || value.includes('javascript:')
        || hasUnsafeCssUrlReference(value)
        || ((name === 'href' || name === 'xlink:href') && !value.startsWith('#'))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

function sanitizeCssUrlReferences(value: string): string {
  return value.replace(/url\(\s*([^)]*)\)/giu, (match, target: string) => (
    isLocalFragmentReference(target) ? match : 'none'
  ));
}

function hasUnsafeCssUrlReference(value: string): boolean {
  let foundReference = false;
  let unsafeReference = false;
  const remainder = value.replace(/url\(\s*([^)]*)\)/giu, (_match, target: string) => {
    foundReference = true;
    if (!isLocalFragmentReference(target)) unsafeReference = true;
    return '';
  });
  return unsafeReference || (value.includes('url(') && (!foundReference || remainder.includes('url(')));
}

function isLocalFragmentReference(value: string): boolean {
  const trimmed = value.trim();
  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1).trim() : trimmed;
  return /^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(unquoted);
}
