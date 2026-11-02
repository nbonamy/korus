/** App-owned JSON document; editor/provider types never cross the backend boundary. */
export type CanvasElement = { id: string; type: string; x: number; y: number; width: number; height: number; [key: string]: unknown };
export type CanvasDocument = {
  revision: number;
  elements: CanvasElement[];
  files: Record<string, { id: string; mimeType: string; dataURL: string; created: number }>;
  selectedElementIds: string[];
  preview: string;
};
export type SaveCanvasInput = {
  sessionId: string;
  expectedSource: string;
  visualizationId: string;
  expectedRevision: number;
  document: Omit<CanvasDocument, 'revision'>;
};
export type CanvasEdit = { id: string; changes: Record<string, unknown> };
const types = new Set(['rectangle', 'diamond', 'ellipse', 'text', 'arrow', 'line', 'freedraw', 'image', 'frame', 'magicframe']);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function isCanvasDocument(value: unknown): value is CanvasDocument {
  if (!record(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !Array.isArray(value.elements) || value.elements.length > 2000
    || !record(value.files) || !Array.isArray(value.selectedElementIds)
    || typeof value.preview !== 'string' || (value.preview !== '' && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.preview))) return false;
  if (JSON.stringify(value).length > 16 * 1024 * 1024) return false;
  const ids = new Set<string>();
  for (const element of value.elements) {
    if (!record(element) || typeof element.id !== 'string' || !element.id || element.id.length > 200
      || ids.has(element.id) || !types.has(String(element.type))
      || !['x', 'y', 'width', 'height'].every(key => typeof element[key] === 'number' && Number.isFinite(element[key]) && Math.abs(Number(element[key])) <= 1e7)
      || (element.link !== undefined && element.link !== null)
      || !validProperties(element)) return false;
    ids.add(element.id);
  }
  if (!value.selectedElementIds.every(id => typeof id === 'string' && ids.has(id))) return false;
  return Object.entries(value.files).every(([id, file]) => record(file) && file.id === id
    && typeof file.created === 'number' && Number.isFinite(file.created)
    && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(file.mimeType))
    && typeof file.dataURL === 'string' && file.dataURL.startsWith(`data:${file.mimeType};base64,`)
    && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(file.dataURL));
}
function validProperties(element: Record<string, unknown>): boolean {
  const numeric: Record<string, [number, number]> = {
    angle: [-1e7, 1e7], fontSize: [1, 1000], fontFamily: [1, 10],
    strokeWidth: [0, 100], roughness: [0, 10], opacity: [0, 100],
    version: [0, Number.MAX_SAFE_INTEGER], versionNonce: [0, Number.MAX_SAFE_INTEGER],
  };
  for (const [key, [min, max]] of Object.entries(numeric)) {
    if (element[key] !== undefined && (typeof element[key] !== 'number' || !Number.isFinite(element[key]) || Number(element[key]) < min || Number(element[key]) > max)) return false;
  }
  for (const key of ['text', 'originalText', 'strokeColor', 'backgroundColor']) {
    if (element[key] !== undefined && (typeof element[key] !== 'string' || String(element[key]).length > 20_000)) return false;
  }
  for (const key of ['locked', 'isDeleted']) if (element[key] !== undefined && typeof element[key] !== 'boolean') return false;
  const enums: Record<string, string[]> = { fillStyle: ['hachure', 'cross-hatch', 'solid', 'zigzag'], strokeStyle: ['solid', 'dashed', 'dotted'], textAlign: ['left', 'center', 'right'], verticalAlign: ['top', 'middle', 'bottom'] };
  for (const [key, values] of Object.entries(enums)) if (element[key] !== undefined && !values.includes(String(element[key]))) return false;
  if (element.groupIds !== undefined && (!Array.isArray(element.groupIds) || !element.groupIds.every(id => typeof id === 'string'))) return false;
  if (element.points !== undefined && (!Array.isArray(element.points) || element.points.length > 20_000 || !element.points.every(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n))))) return false;
  return Number(element.width) >= 0 && Number(element.height) >= 0;
}
const editable = new Set(['x', 'y', 'width', 'height', 'angle', 'text', 'originalText', 'fontSize', 'fontFamily', 'textAlign', 'verticalAlign', 'strokeColor', 'backgroundColor', 'fillStyle', 'strokeWidth', 'strokeStyle', 'roughness', 'opacity', 'isDeleted', 'locked']);
/** Applies property edits to existing elements and appends new ones; Excalidraw fills any property left out when it restores the scene. */
export function editCanvas(document: CanvasDocument, edits: CanvasEdit[], added: CanvasElement[] = []): CanvasDocument {
  if (!Array.isArray(edits) || !Array.isArray(added) || edits.length > 100 || added.length > 100 || edits.length + added.length < 1) throw new Error('Provide 1 to 100 canvas edits or new elements.');
  const next = structuredClone(document);
  const seen = new Set<string>();
  for (const edit of edits) {
    const element = next.elements.find(candidate => candidate.id === edit.id);
    if (!element || seen.has(edit.id) || !record(edit.changes)) throw new Error('Canvas edit has an unknown or duplicate element ID.');
    seen.add(edit.id);
    for (const [key, value] of Object.entries(edit.changes)) {
      if (!editable.has(key) || !['string', 'number', 'boolean'].includes(typeof value)
        || (typeof value === 'number' && !Number.isFinite(value))
        || (typeof value === 'string' && value.length > 20_000)) throw new Error(`Invalid canvas edit: ${key}`);
      element[key] = value;
    }
    if (typeof edit.changes.text === 'string') element.originalText = edit.changes.text;
    element.version = Number(element.version ?? 0) + 1;
    element.versionNonce = Math.floor(Math.random() * 2 ** 31);
    element.updated = Date.now();
  }
  for (const element of structuredClone(added)) {
    if (!record(element)) throw new Error('New canvas element must be an object.');
    next.elements.push({ isDeleted: false, version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now(), ...element });
  }
  next.revision++;
  next.preview = '';
  if (!isCanvasDocument(next)) throw new Error('Invalid canvas document.');
  return next;
}

/** Include bound labels without expanding a selection into the entire graph. */
export function selectedCanvasElements(document: Pick<CanvasDocument, 'elements' | 'selectedElementIds'>): CanvasElement[] {
  const selected = new Set(document.selectedElementIds);
  return document.elements.filter(element => !element.isDeleted && (selected.has(element.id) || (element.type === 'text' && typeof element.containerId === 'string' && selected.has(element.containerId))));
}
