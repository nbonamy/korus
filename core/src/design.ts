import type { ProviderConversationRef, RendererPromptAttachment } from './contracts';
import { isDesignTweaks, type DesignTweak, type DesignTweakEdit } from './design-tweaks';

export type DesignInteraction =
  | { type: 'navigate'; artboardId: string }
  | { type: 'back' }
  | { type: 'toggle' | 'show' | 'hide' | 'scroll'; nodeId: string };

/** Authored HTML, not a runtime DOM snapshot. IDs are immutable document identity. */
export type DesignNode = {
  id: string;
  tag: string;
  text?: string;
  styles?: Record<string, string>;
  attributes?: Record<string, string>;
  children?: DesignNode[];
  toggleTargetId?: string;
  interaction?: DesignInteraction;
};
export type DesignArtboard = { id: string; title: string; width: number; height: number; root: DesignNode; css?: string; notes?: string; position?: { x: number; y: number } };
export type DesignComment = { id: string; nodeId: string; text: string; revision: number };
// chosenArtboardId is retained only for saved-document and client compatibility.
export type DesignContent = { title: string; css: string; artboards: DesignArtboard[]; comments: DesignComment[]; chosenArtboardId?: string; tweaks?: DesignTweak[] };
export type DesignDocument = { id: string; revision: number; content: DesignContent };
export type DesignCheckpoint = { id: string; title: string; revision: number; content: DesignContent };
export type DesignWorkspace = {
  conversationRef: ProviderConversationRef | null;
  isOpen: boolean;
  document: DesignDocument | null;
  selectedArtboardId: string | null;
  selectedNodeId: string | null;
  /** Always empty. Undo and redo history belongs to the client; older clients still require the field. */
  undo: DesignContent[];
  checkpoints: DesignCheckpoint[];
};
export type DesignEdit =
  | DesignTweakEdit
  | { type: 'text'; nodeId: string; text: string }
  | { type: 'style'; nodeId: string; styles: Record<string, string | null> }
  | { type: 'attributes'; nodeId: string; attributes: Record<string, string | null> }
  | { type: 'interaction'; nodeId: string; interaction: DesignInteraction | null }
  | { type: 'insert'; nodeId: string; node: DesignNode; index?: number }
  | { type: 'remove'; nodeId: string }
  | { type: 'duplicate'; nodeId: string }
  | { type: 'move'; nodeId: string; parentId: string; index: number }
  | { type: 'artboard-add'; artboard: DesignArtboard; index?: number }
  | { type: 'artboard-duplicate'; artboardId: string; title?: string }
  | { type: 'artboard-update'; artboardId: string; changes: Partial<Pick<DesignArtboard, 'title' | 'width' | 'height' | 'css' | 'notes' | 'position'>> }
  | { type: 'artboard-remove'; artboardId: string }
  | { type: 'artboard-move'; artboardId: string; index: number }
  | { type: 'choose-artboard'; artboardId: string | null };
export type DesignRequest<Attachment = RendererPromptAttachment> = DesignRequestBody<Attachment> & {
  /** Which of the agent's designs the request is for; optional while the agent has one. */
  designId?: string;
};
type DesignRequestBody<Attachment> =
  | { type: 'read' }
  | { type: 'open'; prompt?: string; attachments?: readonly Attachment[] }
  | { type: 'close' }
  /** Removes the design and everything saved with it, after the person confirmed. Not offered to agents. */
  | { type: 'delete' }
  | { type: 'export'; artboardId?: string }
  | { type: 'capture'; expectedRevision: number; artboardId?: string }
  | { type: 'create'; content: DesignContent }
  | { type: 'select'; artboardId: string; nodeId: string | null }
  | { type: 'edit'; expectedRevision: number; edits: DesignEdit[] }
  | { type: 'implement'; expectedRevision: number; artboardId: string }
  | { type: 'comment'; expectedRevision: number; nodeId: string; text: string }
  | { type: 'checkpoint'; expectedRevision: number; title: string }
  | { type: 'restore'; expectedRevision: number; checkpointId: string }
  /** Replaces the whole content, for a client restoring an earlier version from its own history. Not offered to agents. */
  | { type: 'replace'; expectedRevision: number; content: DesignContent };
export type DesignCaptureInput = { html: string; width: number; height: number };
/** `workspace` is the design the request was for; `designs` lists all of the agent's designs. */
export type DesignResult = { workspace: DesignWorkspace; designs?: { id: string; title: string; revision: number }[]; html?: string; handoff?: string; screenshot?: string };

/** An agent's designs sit beside each other as tabs; one that has no document yet is the empty `design` tab. */
export function designTabId(workspace: DesignWorkspace): string {
  return workspace.document ? `design:${workspace.document.id}` : 'design';
}
export function isDesignTab(tab: string): boolean {
  return tab === 'design' || tab.startsWith('design:');
}
export function designIdOfTab(tab: string): string | undefined {
  return tab.startsWith('design:') ? tab.slice('design:'.length) : undefined;
}

export const designTags = 'main section article header footer nav aside div span h1 h2 h3 h4 h5 h6 p a button img ul ol li strong em small label input textarea select option form details summary table thead tbody tr th td br hr pre code blockquote figure figcaption'.split(' ');
/** Vector graphics are authored inline, so icons and logos keep their shape and take their color from CSS. */
export const designSvgTags = 'svg g path circle rect line polyline polygon ellipse defs linearGradient radialGradient stop clipPath mask use title'.split(' ');
export const designAttributes = 'class title alt type placeholder value name role aria-label aria-hidden aria-expanded checked disabled hidden open colspan rowspan href src width height'.split(' ');
const number = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?(%|px|em|rem)?$/i;
const paint = /^(none|currentColor|transparent|#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d\s.,%/-]+\)|[a-z]+|url\(#[\w-]+\))$/i;
const reference = /^url\(#[\w-]+\)$/;
const numbers = /^[\d\s.,+\-eE%]*$/;
const choice = (...values: string[]) => new RegExp(`^(${values.join('|')})$`);
/** SVG attributes and the values each accepts; nothing outside these reaches the document. */
const svgAttributePatterns: Record<string, RegExp> = {
  viewBox: /^-?[\d.]+[\s,]+-?[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+$/, preserveAspectRatio: /^[A-Za-z\s]+$/,
  d: /^[MmLlHhVvCcSsQqTtAaZz\d\s.,+\-eE]*$/, points: numbers, transform: /^[A-Za-z\d\s.,+\-()]*$/, gradientTransform: /^[A-Za-z\d\s.,+\-()]*$/,
  fill: paint, stroke: paint, 'stop-color': paint, 'clip-path': reference, mask: reference,
  'fill-rule': choice('nonzero', 'evenodd'), 'clip-rule': choice('nonzero', 'evenodd'),
  'stroke-linecap': choice('butt', 'round', 'square'), 'stroke-linejoin': choice('miter', 'round', 'bevel', 'arcs'),
  gradientUnits: choice('userSpaceOnUse', 'objectBoundingBox'),
  'shape-rendering': choice('auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision'),
  'text-rendering': choice('auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision'),
  'image-rendering': choice('auto', 'optimizeSpeed', 'optimizeQuality'),
  'stroke-dasharray': numbers, 'stroke-dashoffset': number, 'stroke-width': number, 'stroke-miterlimit': number,
  opacity: number, 'fill-opacity': number, 'stroke-opacity': number, 'stop-opacity': number, offset: number,
  cx: number, cy: number, r: number, rx: number, ry: number, x: number, y: number, x1: number, y1: number, x2: number, y2: number, fx: number, fy: number,
};
export const designSvgAttributes = Object.keys(svgAttributePatterns);
const tags = new Set([...designTags, ...designSvgTags]);
const attributes = new Set([...designAttributes, ...designSvgAttributes]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, max = 20_000): value is string => typeof value === 'string' && value.length <= max;
const identifier = (value: unknown): value is string => string(value, 100) && /^[a-zA-Z][\w-]*$/.test(value);
const imageSource = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const cssRules: [RegExp, string][] = [[/url\s*\(/i, 'url() is not allowed; use an <img> with a raster data:image URI'], [/@import/i, '@import is not allowed'], [/expression\s*\(/i, 'expression() is not allowed'], [/\\/, 'backslash escapes are not allowed'], [/</, '"<" is not allowed']];
/** Why a stylesheet or style value is rejected, or null when it is accepted. */
function cssIssue(value: unknown): string | null {
  if (!string(value, 50_000)) return 'must be a string of at most 50000 characters';
  return cssRules.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export function designNodes(content: DesignContent): DesignNode[] {
  const nodes: DesignNode[] = [];
  const visit = (node: DesignNode) => { nodes.push(node); node.children?.forEach(visit); };
  content.artboards.forEach(artboard => visit(artboard.root));
  return nodes;
}

/** Unpositioned artboards retain their horizontal layout independently of moved peers. */
export function designArtboardPositions(artboards: DesignArtboard[]): Map<string, { x: number; y: number }> {
  let left = 0;
  return new Map(artboards.map(board => {
    const position = board.position ?? { x: left, y: 0 };
    left += board.width + 80;
    return [board.id, position];
  }));
}

export function isDesignContent(value: unknown): value is DesignContent {
  return designContentIssue(value) === null;
}

/** The first reason a design is rejected, with where it is, or null when the design is valid. */
export function designContentIssue(value: unknown): string | null {
  if (!record(value)) return 'content must be an object';
  if (!string(value.title, 200) || !value.title.trim()) return 'title must be a non-empty string of at most 200 characters';
  const rootCss = cssIssue(value.css);
  if (rootCss) return `css: ${rootCss}`;
  if (!Array.isArray(value.artboards) || value.artboards.length < 1 || value.artboards.length > 12) return 'artboards must hold 1 to 12 artboards';
  if (!Array.isArray(value.comments) || value.comments.length > 200) return 'comments must be an array of at most 200 comments';
  const ids = new Set<string>();
  let count = 0;
  const node = (item: unknown, depth: number, path: string): string | null => {
    if (!record(item)) return `${path}: must be an object`;
    const label = `${path}${typeof item.id === 'string' ? ` (${item.id})` : ''}`;
    if (depth > 30) return `${label}: nesting is deeper than 30 levels`;
    if (++count > 2000) return `${label}: the design has more than 2000 nodes`;
    if (!identifier(item.id)) return `${label}: id must start with a letter and use only letters, digits, _ and -`;
    if (ids.has(item.id)) return `${label}: id is used more than once`;
    if (typeof item.tag !== 'string' || !tags.has(item.tag)) return `${label}: tag ${JSON.stringify(item.tag)} is not allowed; allowed tags: ${[...designTags, ...designSvgTags].join(', ')}`;
    ids.add(item.id);
    if (item.text !== undefined && !string(item.text)) return `${label}.text: must be a string of at most 20000 characters`;
    if (item.children !== undefined) {
      if (!Array.isArray(item.children) || item.children.length > 200) return `${label}.children: must be an array of at most 200 nodes`;
      for (const [index, child] of item.children.entries()) {
        const issue = node(child, depth + 1, `${path}.children[${index}]`);
        if (issue) return issue;
      }
    }
    if (item.text !== undefined && Array.isArray(item.children) && item.children.length) return `${label}: a node holds either text or children, not both`;
    if (['img', 'input', 'br', 'hr'].includes(item.tag) && (item.text !== undefined || (Array.isArray(item.children) && item.children.length))) return `${label}: ${item.tag} cannot hold text or children`;
    if (item.styles !== undefined) {
      if (!record(item.styles)) return `${label}.styles: must be an object of CSS properties`;
      for (const [key, val] of Object.entries(item.styles)) {
        if (!/^(--[\w-]+|[a-z][a-z-]*)$/.test(key)) return `${label}.styles.${key}: property names are lowercase kebab-case or --custom`;
        const issue = cssIssue(val);
        if (issue) return `${label}.styles.${key}: ${issue}`;
      }
    }
    if (item.attributes !== undefined) {
      if (!record(item.attributes)) return `${label}.attributes: must be an object`;
      for (const [key, val] of Object.entries(item.attributes)) {
        if (!attributes.has(key)) return `${label}.attributes.${key}: attribute is not allowed; allowed attributes: ${[...designAttributes, ...designSvgAttributes].join(', ')}`;
        if (!string(val, 100_000)) return `${label}.attributes.${key}: must be a string of at most 100000 characters`;
        if (key === 'src' && !imageSource.test(val)) return `${label}.attributes.src: only raster data URIs are allowed (data:image/png|jpeg|webp|gif;base64,...)`;
        if (key === 'href' && !/^#[\w-]*$/.test(val)) return `${label}.attributes.href: only in-document anchors such as "#node-id" are allowed`;
        if ((key === 'width' || key === 'height') && !number.test(val)) return `${label}.attributes.${key}: must be a number, optionally with px or %`;
        const pattern = svgAttributePatterns[key];
        if (pattern && !pattern.test(val)) return `${label}.attributes.${key}: ${JSON.stringify(val.slice(0, 40))} is not an accepted value for this SVG attribute`;
      }
    }
    if (item.toggleTargetId !== undefined && !identifier(item.toggleTargetId)) return `${label}.toggleTargetId: must be a node id`;
    const action = item.interaction;
    if (action === undefined) return null;
    const valid = record(action) && (action.type === 'back'
      || action.type === 'navigate' && identifier(action.artboardId)
      || ['toggle', 'show', 'hide', 'scroll'].includes(String(action.type)) && identifier(action.nodeId));
    return valid ? null : `${label}.interaction: must be back, navigate with an artboardId, or toggle/show/hide/scroll with a nodeId`;
  };
  const boards = new Set<string>();
  for (const [index, board] of value.artboards.entries()) {
    const at = `artboards[${index}]`;
    if (!record(board)) return `${at}: must be an object`;
    if (!identifier(board.id)) return `${at}.id: must start with a letter and use only letters, digits, _ and -`;
    if (boards.has(board.id)) return `${at}.id: id is used more than once`;
    boards.add(board.id);
    if (!string(board.title, 200) || !board.title.trim()) return `${at}.title: must be a non-empty string of at most 200 characters`;
    if (typeof board.width !== 'number' || !Number.isInteger(board.width) || board.width < 240 || board.width > 3840) return `${at}.width: must be an integer from 240 to 3840`;
    if (typeof board.height !== 'number' || !Number.isInteger(board.height) || board.height < 160 || board.height > 3840) return `${at}.height: must be an integer from 160 to 3840`;
    if (board.position !== undefined && !(record(board.position) && [board.position.x, board.position.y].every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 100000))) return `${at}.position: x and y must be numbers within 100000`;
    if (board.css !== undefined) {
      const issue = cssIssue(board.css);
      if (issue) return `${at}.css: ${issue}`;
    }
    if (board.notes !== undefined && !string(board.notes, 4000)) return `${at}.notes: must be a string of at most 4000 characters`;
    const issue = node(board.root, 0, `${at}.root`);
    if (issue) return issue;
  }
  if (value.chosenArtboardId !== undefined && !boards.has(String(value.chosenArtboardId))) return 'chosenArtboardId: must name an artboard';
  for (const [index, comment] of value.comments.entries()) {
    if (!(record(comment) && identifier(comment.id) && ids.has(String(comment.nodeId)) && string(comment.text, 4000)
      && Number.isInteger(comment.revision) && Number(comment.revision) > 0)) return `comments[${index}]: must have an id, an existing nodeId, text and a positive revision`;
  }
  if (JSON.stringify(value).length > 500_000) return 'the design is larger than 500000 characters; reuse shared css and smaller images';
  if (value.tweaks !== undefined && !isDesignTweaks(value.tweaks, designNodes(value as DesignContent))) return 'tweaks: each tweak needs a unique id, a label and an existing nodeId and property';
  for (const board of (value as DesignContent).artboards) {
    const nodes = designNodes({ ...(value as DesignContent), artboards: [board] });
    const localIds = new Set(nodes.map(item => item.id));
    for (const item of nodes) {
      if (item.toggleTargetId && !localIds.has(item.toggleTargetId)) return `node ${item.id}: toggleTargetId must name a node in the same artboard`;
      const action = item.interaction;
      if (!action || action.type === 'back') continue;
      if (action.type === 'navigate' ? !boards.has(action.artboardId) : !localIds.has(action.nodeId)) return `node ${item.id}: interaction targets ${action.type === 'navigate' ? 'an artboard' : 'a node in the same artboard'} that does not exist`;
    }
  }
  return null;
}

export function isDesignWorkspace(value: unknown): value is DesignWorkspace {
  if (!record(value) || typeof value.isOpen !== 'boolean' || !Array.isArray(value.undo) || value.undo.length > 30
    || !Array.isArray(value.checkpoints) || value.checkpoints.length > 10) return false;
  const ref = value.conversationRef;
  if (ref !== null && (!record(ref) || !['codex', 'claude', 'antigravity', 'cursor'].includes(String(ref.provider)))) return false;
  const document = value.document;
  return (document === null || (record(document) && identifier(document.id) && Number.isInteger(document.revision) && Number(document.revision) > 0 && isDesignContent(document.content)))
    && (value.selectedArtboardId === null || identifier(value.selectedArtboardId))
    && (value.selectedNodeId === null || identifier(value.selectedNodeId))
    && value.undo.every(isDesignContent)
    && value.checkpoints.every(item => record(item) && identifier(item.id) && string(item.title, 200) && Number.isInteger(item.revision) && isDesignContent(item.content));
}

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function designNodeHtml(node: DesignNode): string {
  const attrs = Object.entries(node.attributes ?? {}).map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
  const style = Object.entries(node.styles ?? {}).map(([key, value]) => `${key}:${value}`).join(';');
  const action = node.interaction;
  const interaction = action ? ` data-design-action="${action.type}"${action.type === 'navigate' ? ` data-design-target="${action.artboardId}"` : 'nodeId' in action ? ` data-design-target="${action.nodeId}"` : ''}` : '';
  const opening = `<${node.tag} data-design-id="${node.id}" id="${node.id}"${attrs}${style ? ` style="${escape(style)}"` : ''}${node.toggleTargetId ? ` data-toggle-target="${node.toggleTargetId}"` : ''}${interaction}>`;
  return ['img', 'input', 'br', 'hr'].includes(node.tag) ? opening : `${opening}${node.text === undefined ? (node.children ?? []).map(designNodeHtml).join('') : escape(node.text)}</${node.tag}>`;
}

/** Trusted playback code shared by the editor and portable exports. */
export function designInteractionScript(onNavigate: string): string {
  return `
function prepareInteractions(){
  document.querySelectorAll('[data-design-action],[data-toggle-target]').forEach(node=>{
    if(!node.matches('button,input,select,textarea,a[href],summary')){node.tabIndex=0;node.setAttribute('role','button')}
  });
}
prepareInteractions();
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('keydown',event=>{
  const node=event.target.closest('[data-design-action],[data-toggle-target]');
  if(node&&node===event.target&&!node.matches('button,input,select,textarea,a[href],summary')&&['Enter',' '].includes(event.key)){event.preventDefault();node.click()}
});
document.addEventListener('click',event=>{
  const node=event.target.closest('[data-design-action],[data-toggle-target]');
  if(!node||node.disabled)return;
  event.preventDefault();
  const action=node.dataset.designAction||'toggle';
  if(action==='navigate'||action==='back'){(${onNavigate})(node);return}
  const target=document.getElementById(node.dataset.designTarget||node.dataset.toggleTarget);
  if(!target)return;
  if(action==='scroll')target.scrollIntoView({block:'start'});
  else{target.hidden=action==='hide'||action==='toggle'&&!target.hidden;node.setAttribute('aria-expanded',String(!target.hidden))}
});`;
}

const scriptJson = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');
export function exportDesign(content: DesignContent, artboardId?: string): string {
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-design-export'; frame-src about: 'self'; form-action 'none'; base-uri 'none'";
  if (artboardId || content.artboards.length === 1) {
    const board = content.artboards.find(item => item.id === artboardId) ?? content.artboards[0];
    // Include only screens reachable from this entry point, with a separate DOM
    // per visited screen so Back retains native form values and local toggles.
    const reachable = new Set([board.id]);
    for (const id of reachable) {
      const current = content.artboards.find(item => item.id === id);
      if (!current) continue;
      for (const node of designNodes({ ...content, artboards: [current] })) {
        const action = node.interaction;
        if (action?.type === 'navigate' && content.artboards.some(item => item.id === action.artboardId)) reachable.add(action.artboardId);
      }
    }
    const screens = Object.fromEntries(content.artboards.filter(item => reachable.has(item.id)).map(item => [item.id, { html: designNodeHtml(item.root), css: item.css ?? content.css, title: item.title, width: item.width, height: item.height }]));
    const runtime = `const screens=${scriptJson(screens)};let current=${scriptJson(board.id)};const history=[];const cache=new Map([[current,document.body.firstElementChild]]);const positions=new Map();
function navigate(node){
  const next=node.dataset.designAction==='back'?history.pop():node.dataset.designTarget;
  if(!next||!screens[next]||next===current)return;
  if(node.dataset.designAction!=='back')history.push(current);
  positions.set(current,[scrollX,scrollY]);
  current=next;
  if(!cache.has(next)){const holder=document.createElement('div');holder.innerHTML=screens[next].html;cache.set(next,holder.firstElementChild)}
  document.body.replaceChildren(cache.get(next));
  document.getElementById('design-styles').textContent='body{margin:0}*{box-sizing:border-box}'+screens[next].css;
  document.title=screens[next].title;prepareInteractions();
  scrollTo(...(positions.get(next)||[0,0]));
  if(parent!==window)parent.postMessage({kind:'design-export-size',width:screens[next].width,height:screens[next].height},'*');
}
${designInteractionScript('navigate')}`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escape(board.title)}</title><style id="design-styles">body{margin:0}*{box-sizing:border-box}${board.css ?? content.css}</style></head><body>${designNodeHtml(board.root)}<script nonce="design-export">${runtime}</script></body></html>`;
  }
  // Each artboard retains its own viewport and CSS cascade in the portable export.
  const boards = content.artboards.map(board => `<section><h2>${escape(board.title)}</h2>${board.notes ? `<p>${escape(board.notes)}</p>` : ''}<iframe title="${escape(board.title)}" width="${board.width}" height="${board.height}" sandbox="allow-scripts" srcdoc="${escape(exportDesign(content, board.id))}"></iframe></section>`).join('\n');
  const resize = `window.addEventListener('message',event=>{const frame=[...document.querySelectorAll('iframe')].find(item=>item.contentWindow===event.source);const data=event.data;if(frame&&data?.kind==='design-export-size'&&Number.isInteger(data.width)&&data.width>=240&&data.width<=3840&&Number.isInteger(data.height)&&data.height>=160&&data.height<=3840){frame.width=data.width;frame.height=data.height}});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escape(content.title)}</title><style>body{font-family:system-ui;margin:24px}iframe{border:0}section{margin-bottom:32px}</style></head><body>${boards}<script nonce="design-export">${resize}</script></body></html>`;
}
