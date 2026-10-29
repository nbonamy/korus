import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
import { createInitialSnapshot } from '../snapshot';
import { isAppSnapshot } from '../snapshot-guards';
import { exportDesign, isDesignContent, type DesignContent } from '../design';
import { designTweakCss, readDesignTweak, type DesignTweak } from '../design-tweaks';

// Hydration is distinct from edits: corrupted control metadata must not enter a
// client snapshot, and portable rendering must use the chosen authored values.
it('hydrates generated controls and exports their values while retaining custom manual CSS', () => {
  const tweaks: DesignTweak[] = [
    { id: 'spacing', label: 'Spacing', nodeId: 'root', property: 'padding', type: 'range', min: 8, max: 64, step: 8, unit: 'px' },
    { id: 'accent', label: 'Accent', nodeId: 'root', property: 'color', type: 'color' },
    { id: 'weight', label: 'Weight', nodeId: 'root', property: 'font-weight', type: 'select', options: [{ label: 'Regular', value: '400' }, { label: 'Bold', value: '700' }] },
    { id: 'quiet', label: 'Quiet', nodeId: 'root', property: 'opacity', type: 'toggle', on: '0.5', off: '1' },
  ];
  const content: DesignContent = { title: 'Controls', css: '', comments: [], tweaks, artboards: [{ id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'root', tag: 'main', text: 'My headline', styles: {} } }] };
  const root = content.artboards[0].root;
  const values = [40, '#336699', '700', true];
  tweaks.forEach((tweak, index) => { root.styles![tweak.property] = designTweakCss(tweak, values[index]); });
  const snapshot = createInitialSnapshot();
  snapshot.agents[0].designWorkspace = { conversationRef: null, isOpen: true, document: { id: 'design-tweaks', revision: 1, content }, selectedNodeId: null, selectedArtboardId: 'desktop', undo: [], checkpoints: [] };
  expect(isAppSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
  expect(tweaks.map(tweak => readDesignTweak(tweak, root))).toStrictEqual(values);
  const browser = new JSDOM(exportDesign(content));
  try {
    const style = browser.window.getComputedStyle(browser.window.document.querySelector('main'));
    expect([style.padding, style.color, style.fontWeight, style.opacity]).toStrictEqual(['40px', 'rgb(51, 102, 153)', '700', '0.5']);
  } finally { browser.window.close(); }
  root.styles = { padding: '2rem', color: 'rebeccapurple', 'font-weight': '900', opacity: '0.8' };
  expect(isAppSnapshot(snapshot)).toBe(true);
  expect(tweaks.map(tweak => readDesignTweak(tweak, root))).toStrictEqual([null, null, null, null]);
  root.styles = { padding: '41px', opacity: '1' };
  expect(readDesignTweak(tweaks[0], root)).toBeNull();
  expect(readDesignTweak(tweaks[3], root)).toBe(false);
  expect(readDesignTweak(tweaks[1], root)).toBeNull();
  const invalid = [
    [...tweaks, tweaks[0]],
    [{ ...tweaks[0], nodeId: 'gone' }],
    [{ ...tweaks[0], property: 'padding;display' }],
    [{ ...tweaks[0], label: '' }],
    [{ ...tweaks[0], step: 0 }],
    [{ ...tweaks[0], unit: 'url(bad)' }],
    [{ ...tweaks[2], options: [{ label: 'Remote', value: 'url(https://bad.test)' }] }],
    [{ ...tweaks[2], options: [{ label: 'First', value: '400' }, { label: 'Duplicate', value: '400' }] }],
    [{ ...tweaks[3], on: '1' }],
    [tweaks[0], { ...tweaks[0], id: 'same-binding' }],
  ];
  for (const candidate of invalid) {
    content.tweaks = candidate as DesignTweak[];
    expect(isAppSnapshot(snapshot)).toBe(false);
  }
});

// Contract-to-browser boundary: valid authored CSS must survive hydration and
// export, while text/attributes cannot turn into executable markup or external IO.
it('hydrates an authored design and exports an isolated, interactive HTML document', () => {
  const content: DesignContent = { title: 'A <page>', css: 'main > h1 { color: rebeccapurple; }', comments: [], artboards: [{
    id: 'desktop', title: 'Desktop', width: 800, height: 600, root: { id: 'root', tag: 'main', children: [
      { id: 'heading', tag: 'h1', text: '<script>window.injected=true</script>' },
      { id: 'toggle', tag: 'button', text: 'Details', toggleTargetId: 'details' },
      { id: 'details', tag: 'p', text: 'A detail', attributes: { hidden: '', title: '\"><img src=x onerror=alert(1)>' } },
      { id: 'image', tag: 'img', attributes: { src: 'data:image/png;base64,YQ==', alt: 'Example' } },
    ] },
  }] };
  const snapshot = createInitialSnapshot();
  snapshot.agents[0].designWorkspace = { conversationRef: null, isOpen: true, document: { id: 'design-a', revision: 1, content }, selectedNodeId: 'heading', selectedArtboardId: 'desktop', undo: [content], checkpoints: [{ id: 'checkpoint-a', title: 'Safe', revision: 1, content }] };
  expect(isAppSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);
  const browser = new JSDOM(exportDesign(content), { runScripts: 'dangerously' });
  try {
    const { document } = browser.window;
    expect(document.querySelector('h1')!.textContent).toBe('<script>window.injected=true</script>');
    expect(browser.window).not.toHaveProperty('injected');
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(document.querySelector('#details')!.hasAttribute('hidden')).toBe(true);
    (document.querySelector('#toggle') as { click(): void }).click();
    expect(document.querySelector('#details')!.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('meta[http-equiv]')!.getAttribute('content')).toContain("default-src 'none'");
    expect(document.querySelectorAll('img')).toHaveLength(1);
    expect(document.querySelector('#heading')!.getAttribute('data-design-id')).toBe('heading');
  } finally { browser.window.close(); }

  const invalid = [
    { ...content, css: '@import "https://example.test/style.css";' },
    { ...content, css: 'body{background:url(https://example.test/track)}' },
    { ...content, css: '</style><script>alert(1)</script>' },
    { ...content, artboards: [{ ...content.artboards[0], css: 'body{background:url(https://example.test/track)}' }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'bad', tag: 'iframe' } }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'bad', tag: 'div', attributes: { onclick: 'alert(1)' } } }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'bad', tag: 'img', attributes: { src: 'file:///etc/passwd' } } }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'bad', tag: 'a', attributes: { href: 'javascript:alert(1)' } } }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'root', tag: 'div', children: [{ id: 'root', tag: 'p', text: 'Duplicate' }] } }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'bad', tag: 'button', toggleTargetId: 'missing' } }] },
    { ...content, artboards: [{ ...content.artboards[0], root: { id: 'bad', tag: 'input', children: [{ id: 'lost', tag: 'span', text: 'Invisible child' }] } }] },
    { ...content, artboards: [{ ...content.artboards[0], title: ' ' }] },
    { ...content, artboards: [...content.artboards, { id: 'other', title: 'Other', width: 800, height: 600, root: { id: 'cross-board', tag: 'button', toggleTargetId: 'details' } }] },
    { ...content, comments: [{ id: 'comment-a', nodeId: 'missing', text: 'Wrong target', revision: 1 }] },
  ];
  for (const candidate of invalid) {
    expect(isDesignContent(candidate)).toBe(false);
    snapshot.agents[0].designWorkspace.document!.content = candidate;
    expect(isAppSnapshot(snapshot)).toBe(false);
  }
});

it('exports alternatives with independent document styling and keeps the chosen direction', () => {
  const content: DesignContent = { title: 'Alternatives', css: 'h1{color:red}', comments: [], chosenArtboardId: 'second', artboards: [
    { id: 'first', title: 'Editorial', width: 900, height: 600, root: { id: 'first-heading', tag: 'h1', text: 'First' } },
    { id: 'second', title: 'Compact', width: 500, height: 700, css: 'h1{color:blue}', root: { id: 'second-heading', tag: 'h1', text: 'Second' } },
  ] };
  expect(isDesignContent(content)).toBe(true);
  const page = new JSDOM(exportDesign(content));
  try {
    const frames = [...page.window.document.querySelectorAll('iframe')] as { title: string; srcdoc: string }[];
    expect(frames.map(frame => frame.title)).toStrictEqual(['Editorial', 'Compact']);
    for (const [index, frame] of frames.entries()) {
      const board = new JSDOM(frame.srcdoc);
      expect(board.window.getComputedStyle(board.window.document.querySelector('h1')!).color).toBe(index ? 'rgb(0, 0, 255)' : 'rgb(255, 0, 0)');
      board.window.close();
    }
  } finally { page.window.close(); }
  expect(isDesignContent({ ...content, chosenArtboardId: 'missing' })).toBe(false);
});
