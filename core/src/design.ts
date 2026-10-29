import type { BackendConversationRef } from './contracts';
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
export type DesignContent = { title: string; css: string; artboards: DesignArtboard[]; comments: DesignComment[]; chosenArtboardId?: string; tweaks?: DesignTweak[] };
export type DesignDocument = { id: string; revision: number; content: DesignContent };
export type DesignCheckpoint = { id: string; title: string; revision: number; content: DesignContent };
export type DesignWorkspace = {
  conversationRef: BackendConversationRef | null;
  isOpen: boolean;
  document: DesignDocument | null;
  selectedArtboardId: string | null;
  selectedNodeId: string | null;
  undo: DesignContent[];
  redo?: DesignContent[];
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
export type DesignRequest =
  | { type: 'read' }
  | { type: 'open'; prompt?: string }
  | { type: 'close' }
  | { type: 'export'; artboardId?: string }
  | { type: 'capture'; expectedRevision: number; artboardId?: string }
  | { type: 'create'; content: DesignContent }
  | { type: 'select'; artboardId: string; nodeId: string | null }
  | { type: 'edit'; expectedRevision: number; edits: DesignEdit[] }
  | { type: 'implement'; expectedRevision: number; artboardId: string }
  | { type: 'comment'; expectedRevision: number; nodeId: string; text: string }
  | { type: 'checkpoint'; expectedRevision: number; title: string }
  | { type: 'restore'; expectedRevision: number; checkpointId: string }
  | { type: 'undo'; expectedRevision: number }
  | { type: 'redo'; expectedRevision: number };
export type DesignCaptureInput = { html: string; width: number; height: number };
export type DesignResult = { workspace: DesignWorkspace; html?: string; handoff?: string; screenshot?: string };

const tags = new Set('main section article header footer nav aside div span h1 h2 h3 h4 h5 h6 p a button img ul ol li strong em small label input textarea select option form details summary table thead tbody tr th td br hr pre code blockquote figure figcaption'.split(' '));
const attributes = new Set('class title alt type placeholder value name role aria-label aria-hidden aria-expanded checked disabled hidden open colspan rowspan href src'.split(' '));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, max = 20_000): value is string => typeof value === 'string' && value.length <= max;
const identifier = (value: unknown): value is string => string(value, 100) && /^[a-zA-Z][\w-]*$/.test(value);
const safeCss = (value: unknown): value is string => string(value, 50_000) && !/url\s*\(|@import|expression\s*\(|\\|</i.test(value);

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
  if (!record(value) || !string(value.title, 200) || !value.title.trim() || !safeCss(value.css)
    || !Array.isArray(value.artboards) || value.artboards.length < 1 || value.artboards.length > 12
    || !Array.isArray(value.comments) || value.comments.length > 200) return false;
  const ids = new Set<string>();
  let count = 0;
  const node = (item: unknown, depth: number): boolean => {
    if (!record(item) || depth > 30 || ++count > 2000 || !identifier(item.id) || ids.has(item.id)
      || typeof item.tag !== 'string' || !tags.has(item.tag)) return false;
    ids.add(item.id);
    if (item.text !== undefined && !string(item.text)) return false;
    if (item.children !== undefined && (!Array.isArray(item.children) || item.children.length > 200 || !item.children.every(child => node(child, depth + 1)))) return false;
    if (item.text !== undefined && Array.isArray(item.children) && item.children.length) return false;
    if (['img', 'input', 'br', 'hr'].includes(item.tag) && (item.text !== undefined || (Array.isArray(item.children) && item.children.length))) return false;
    if (item.styles !== undefined && (!record(item.styles) || !Object.entries(item.styles).every(([key, val]) => /^(--[\w-]+|[a-z][a-z-]*)$/.test(key) && safeCss(val)))) return false;
    if (item.attributes !== undefined && (!record(item.attributes) || !Object.entries(item.attributes).every(([key, val]) => attributes.has(key) && string(val, 100_000)
      && (key !== 'src' || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(val))
      && (key !== 'href' || /^#[\w-]*$/.test(val))))) return false;
    if (item.toggleTargetId !== undefined && !identifier(item.toggleTargetId)) return false;
    const action = item.interaction;
    return action === undefined || record(action) && (action.type === 'back'
      || action.type === 'navigate' && identifier(action.artboardId)
      || ['toggle', 'show', 'hide', 'scroll'].includes(String(action.type)) && identifier(action.nodeId));
  };
  const boards = new Set<string>();
  if (!value.artboards.every(board => record(board) && identifier(board.id) && !boards.has(board.id) && !!boards.add(board.id)
    && string(board.title, 200) && !!board.title.trim() && typeof board.width === 'number' && Number.isInteger(board.width) && board.width >= 240 && board.width <= 3840
    && typeof board.height === 'number' && Number.isInteger(board.height) && board.height >= 160 && board.height <= 3840
    && (board.position === undefined || record(board.position) && [board.position.x, board.position.y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000))
    && (board.css === undefined || safeCss(board.css)) && (board.notes === undefined || string(board.notes, 4000)) && node(board.root, 0))) return false;
  if (value.chosenArtboardId !== undefined && !boards.has(String(value.chosenArtboardId))) return false;
  if (!value.comments.every(comment => record(comment) && identifier(comment.id) && ids.has(String(comment.nodeId)) && string(comment.text, 4000)
    && Number.isInteger(comment.revision) && Number(comment.revision) > 0)) return false;
  if (JSON.stringify(value).length > 500_000) return false;
  if (value.tweaks !== undefined && !isDesignTweaks(value.tweaks, designNodes(value as DesignContent))) return false;
  return (value as DesignContent).artboards.every(board => {
    const nodes = designNodes({ ...(value as DesignContent), artboards: [board] });
    const localIds = new Set(nodes.map(item => item.id));
    return nodes.every(item => (!item.toggleTargetId || localIds.has(item.toggleTargetId)) && (!item.interaction
      || item.interaction.type === 'back'
      || (item.interaction.type === 'navigate' ? boards.has(item.interaction.artboardId) : localIds.has(item.interaction.nodeId))));
  });
}

export function isDesignWorkspace(value: unknown): value is DesignWorkspace {
  if (!record(value) || typeof value.isOpen !== 'boolean' || !Array.isArray(value.undo) || value.undo.length > 30
    || (value.redo !== undefined && (!Array.isArray(value.redo) || value.redo.length > 30 || !value.redo.every(isDesignContent)))
    || !Array.isArray(value.checkpoints) || value.checkpoints.length > 10) return false;
  const ref = value.conversationRef;
  if (ref !== null && (!record(ref) || !['codex', 'claude', 'antigravity'].includes(String(ref.backend)))) return false;
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
  const boards = content.artboards.map(board => `<section><h2>${escape(board.title)}${content.chosenArtboardId === board.id ? ' · Chosen direction' : ''}</h2>${board.notes ? `<p>${escape(board.notes)}</p>` : ''}<iframe title="${escape(board.title)}" width="${board.width}" height="${board.height}" sandbox="allow-scripts" srcdoc="${escape(exportDesign(content, board.id))}"></iframe></section>`).join('\n');
  const resize = `window.addEventListener('message',event=>{const frame=[...document.querySelectorAll('iframe')].find(item=>item.contentWindow===event.source);const data=event.data;if(frame&&data?.kind==='design-export-size'&&Number.isInteger(data.width)&&data.width>=240&&data.width<=3840&&Number.isInteger(data.height)&&data.height>=160&&data.height<=3840){frame.width=data.width;frame.height=data.height}});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escape(content.title)}</title><style>body{font-family:system-ui;margin:24px}iframe{border:0}section{margin-bottom:32px}</style></head><body>${boards}<script nonce="design-export">${resize}</script></body></html>`;
}
