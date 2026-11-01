type FrameConfig = {
  token: string; revision: number; play: boolean; selected: string | null; rootId: string;
  labels: { width: string; height: string; size: string };
};

/** Serialized into the opaque-origin artboard. Keep all runtime dependencies local. */
export function installDesignFrame(config: FrameConfig): void {
  if (config.play) return;
  const send = (kind: string, nodeId: string | null, extra: Record<string, unknown> = {}) => parent.postMessage({ ...extra, kind, nodeId, token: config.token, revision: config.revision }, '*');
  const element = (id: string | null) => id ? document.getElementById(id) : null;
  const authored = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-design-id]') : null;
  const px = (value: number) => `${Math.round(value * 100) / 100}px`;
  let selected = element(config.selected);
  let locked = false;
  let zoom = 1;
  let editing: HTMLElement | null = null;
  let suppressClick = false;
  let selectTimer: ReturnType<typeof setTimeout> | undefined;
  const overlay = document.createElement('div');
  overlay.dataset.designEditor = '';
  overlay.style.cssText = 'all:initial;position:fixed;box-sizing:border-box;pointer-events:none;z-index:2147483647;border:1px solid Highlight';
  const marker = document.createElement('div');
  marker.dataset.designEditor = '';
  marker.style.cssText = 'all:initial;position:fixed;pointer-events:none;z-index:2147483647;background:Highlight;display:none';
  const handles = ['e', 's', 'se'].map(direction => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.resize = direction;
    button.setAttribute('aria-label', config.labels[direction === 'e' ? 'width' : direction === 's' ? 'height' : 'size']);
    button.style.cssText = `all:initial;display:block;position:absolute;box-sizing:border-box;pointer-events:auto;background:Canvas;border:1px solid Highlight;cursor:${direction}-resize`;
    overlay.append(button);
    return button;
  });
  if (!config.play) document.body.append(overlay, marker);
  function draw() {
    overlay.style.display = selected && selected.isConnected && !editing && !config.play ? 'block' : 'none';
    if (!selected) return;
    const bounds = selected.getBoundingClientRect();
    Object.assign(overlay.style, { left: px(bounds.left), top: px(bounds.top), width: px(bounds.width), height: px(bounds.height), borderWidth: px(1 / zoom) });
    for (const handle of handles) {
      handle.style.display = locked ? 'none' : 'block';
      const direction = handle.dataset.resize!;
      Object.assign(handle.style, { width: px(9 / zoom), height: px(9 / zoom), right: px(-11 / zoom), bottom: px(-11 / zoom), borderWidth: px(1 / zoom) });
      if (direction === 'e') handle.style.bottom = `calc(50% - ${px(4.5 / zoom)})`;
      if (direction === 's') handle.style.right = `calc(50% - ${px(4.5 / zoom)})`;
    }
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.token !== config.token || event.data.kind !== 'highlight' || config.play) return;
    if (!gesture?.active && !editing) selected = element(event.data.nodeId);
    locked = Boolean(event.data.locked);
    if (typeof event.data.zoom === 'number' && event.data.zoom > 0) zoom = event.data.zoom;
    draw();
  });
  window.addEventListener('resize', draw);
  document.addEventListener('scroll', draw, true);
  document.addEventListener('submit', event => event.preventDefault());
  document.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; return; }
    const node = authored(event.target);
    if (!node) return;
    if (editing) return;
    event.preventDefault(); event.stopPropagation();
    if (!locked) {
      selected = node; draw(); clearTimeout(selectTimer);
      if (event.detail < 2) selectTimer = setTimeout(() => send('select', node.id), 180);
    }
  }, true);
  document.addEventListener('dblclick', event => {
    if (config.play || locked || editing) return;
    const node = authored(event.target);
    if (!node || node.children.length || ['IMG', 'INPUT', 'BR', 'HR'].includes(node.tagName)) return;
    event.preventDefault();
    clearTimeout(selectTimer);
    editing = node; selected = node; draw();
    send('interaction-start', node.id);
    const original = node.textContent ?? '';
    node.contentEditable = 'true'; node.focus();
    const range = document.createRange(); range.selectNodeContents(node);
    getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
    const finish = () => {
      node.contentEditable = 'false'; editing = null; draw();
      if (node.textContent !== original) send('text', node.id, { text: node.textContent ?? '' });
      else send('interaction-end', node.id);
    };
    node.addEventListener('blur', finish, { once: true });
  });

  type Drop = { parentId: string; index: number };
  type Gesture = {
    node: HTMLElement; pointerId: number; x: number; y: number; style: string | null;
    width: number; height: number; left: number; top: number; free: boolean; resize: string;
    active: boolean; styles: Record<string, string>; drop: Drop | null;
  };
  let gesture: Gesture | null = null;
  function restore(gesture: Gesture) {
    if (gesture.style === null) gesture.node.removeAttribute('style');
    else gesture.node.setAttribute('style', gesture.style);
    marker.style.display = 'none';
    draw();
  }
  function dropAt(node: HTMLElement, x: number, y: number): Drop | null {
    const container = node.parentElement;
    if (!container?.dataset.designId) return null;
    const area = container.getBoundingClientRect();
    if (x < area.left || x > area.right || y < area.top || y > area.bottom) return null;
    const all = [...container.children].filter((item): item is HTMLElement => item instanceof HTMLElement && !!item.dataset.designId && item !== node);
    const flow = all.filter(item => !['absolute', 'fixed'].includes(getComputedStyle(item).position) && item.getClientRects().length);
    if (!flow.length) return null;
    const layout = getComputedStyle(container);
    const row = layout.display.includes('flex') && layout.flexDirection.startsWith('row');
    const grid = layout.display.includes('grid');
    const reverse = layout.flexDirection.endsWith('reverse');
    let nearest: { child: HTMLElement; after: boolean; distance: number; horizontal: boolean } | null = null;
    for (const child of flow) {
      const rect = child.getBoundingClientRect();
      const horizontal = row || (grid && y >= rect.top && y <= rect.bottom);
      const coordinate = horizontal ? x : y;
      const start = horizontal ? rect.left : rect.top;
      const end = horizontal ? rect.right : rect.bottom;
      const after = coordinate > (start + end) / 2;
      const distance = Math.abs(coordinate - (after ? end : start)) + (horizontal ? Math.max(rect.top - y, y - rect.bottom, 0) : Math.max(rect.left - x, x - rect.right, 0));
      if (!nearest || distance < nearest.distance) nearest = { child, after, distance, horizontal };
    }
    if (!nearest) return null;
    const rect = nearest.child.getBoundingClientRect();
    const thickness = 2 / zoom;
    Object.assign(marker.style, { display: 'block', left: px(nearest.horizontal ? (nearest.after ? rect.right : rect.left) : rect.left), top: px(nearest.horizontal ? rect.top : (nearest.after ? rect.bottom : rect.top)), width: px(nearest.horizontal ? thickness : rect.width), height: px(nearest.horizontal ? rect.height : thickness) });
    return { parentId: container.id, index: all.indexOf(nearest.child) + (nearest.after !== reverse ? 1 : 0) };
  }
  document.addEventListener('pointerdown', event => {
    if (config.play || locked || editing || event.button !== 0) return;
    const handle = event.target instanceof HTMLElement ? event.target.dataset.resize ?? '' : '';
    const node = handle ? selected : authored(event.target);
    if (!node) return;
    const computed = getComputedStyle(node);
    const free = computed.position === 'absolute' || computed.position === 'fixed';
    if (!handle && !free && node.id === config.rootId) return;
    const rect = node.getBoundingClientRect();
    gesture = { node, pointerId: event.pointerId, x: event.clientX, y: event.clientY, style: node.getAttribute('style'), width: rect.width, height: rect.height,
      left: computed.left === 'auto' ? node.offsetLeft - (parseFloat(computed.marginLeft) || 0) : parseFloat(computed.left),
      top: computed.top === 'auto' ? node.offsetTop - (parseFloat(computed.marginTop) || 0) : parseFloat(computed.top),
      free, resize: handle, active: false, styles: {}, drop: null };
    node.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.active && Math.hypot(dx, dy) * zoom < 4) return;
    if (!current.active) { clearTimeout(selectTimer); current.active = true; selected = current.node; send('interaction-start', current.node.id); getSelection()?.removeAllRanges(); }
    event.preventDefault();
    if (current.resize) {
      current.styles = { 'box-sizing': 'border-box' };
      if (current.resize.includes('e')) current.styles.width = px(Math.min(3840, Math.max(8, current.width + dx)));
      if (current.resize.includes('s')) current.styles.height = px(Math.min(3840, Math.max(8, current.height + dy)));
      for (const [key, value] of Object.entries(current.styles)) current.node.style.setProperty(key, value);
    } else if (current.free) {
      current.styles = { left: px(current.left + dx), top: px(current.top + dy), right: 'auto', bottom: 'auto' };
      Object.assign(current.node.style, current.styles);
    } else {
      current.node.style.translate = `${px(dx)} ${px(dy)}`;
      current.node.style.opacity = '0.6';
      current.drop = dropAt(current.node, event.clientX, event.clientY);
      if (!current.drop) marker.style.display = 'none';
    }
    draw();
  });
  function finish(cancelled: boolean) {
    const current = gesture; gesture = null;
    if (!current) return;
    if (current.node.hasPointerCapture(current.pointerId)) current.node.releasePointerCapture(current.pointerId);
    restore(current);
    if (!current.active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const nodeId = current.node.id;
    if (cancelled) { send('interaction-end', nodeId); return; }
    const edit = current.resize || current.free ? { type: 'style', nodeId, styles: current.styles }
      : current.drop ? { type: 'move', nodeId, ...current.drop } : null;
    if (edit) send('edit', nodeId, { edit });
    else send('interaction-end', nodeId);
  }
  document.addEventListener('pointerup', () => finish(false));
  document.addEventListener('pointercancel', () => finish(true));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(true); } });
  new ResizeObserver(draw).observe(document.body);
  draw();
}
