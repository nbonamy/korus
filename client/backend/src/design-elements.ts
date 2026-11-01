import { createEntityId } from '@workspace/core/ids';
import { designNodes, type DesignContent, type DesignEdit, type DesignNode } from '@workspace/core/design';
import { duplicateCss } from './design-artboards';
import { copyTweaks, removeTweaks } from './design-tweaks';

type ElementEdit = Extract<DesignEdit, { nodeId: string }>;
const voidTags = new Set(['img', 'input', 'br', 'hr']);
const subtree = (node: DesignNode): DesignNode[] => [node, ...(node.children ?? []).flatMap(subtree)];
function patch(current: Record<string, string> | undefined, changes: Record<string, string | null>): Record<string, string> {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid element properties.');
  const result = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete result[key];
    else result[key] = value;
  }
  return result;
}
function container(node: DesignNode) {
  if (node.text !== undefined || voidTags.has(node.tag)) throw new Error('Choose a container for child elements.');
  return node.children ??= [];
}

/** Authored structural edits keep identity, comments and references together. */
export function applyElementEdit(content: DesignContent, edit: ElementEdit): void {
  const nodes = designNodes(content);
  const node = nodes.find(item => item.id === edit.nodeId);
  if (!node) throw new Error(`Design node not found: ${edit.nodeId}`);
  const board = content.artboards.find(item => subtree(item.root).some(child => child.id === node.id))!;
  const parent = nodes.find(item => item.children?.includes(node));
  if (edit.type === 'text') {
    if (node.children?.length || voidTags.has(node.tag)) throw new Error('Edit a text leaf to preserve its child nodes.');
    node.text = edit.text;
  } else if (edit.type === 'style') node.styles = patch(node.styles, edit.styles);
  else if (edit.type === 'attributes') node.attributes = patch(node.attributes, edit.attributes);
  else if (edit.type === 'interaction') {
    delete node.toggleTargetId;
    if (edit.interaction === null) delete node.interaction;
    else node.interaction = structuredClone(edit.interaction);
  }
  else if (edit.type === 'insert') {
    const children = container(node);
    const index = edit.index ?? children.length;
    if (!Number.isInteger(index) || index < 0 || index > children.length) throw new Error('Invalid insertion index.');
    children.splice(index, 0, structuredClone(edit.node));
  } else if (edit.type === 'remove') {
    if (!parent) throw new Error('Cannot remove an artboard root.');
    const removed = new Set(subtree(node).map(item => item.id));
    parent.children = parent.children!.filter(child => child !== node);
    content.comments = content.comments.filter(comment => !removed.has(comment.nodeId));
    removeTweaks(content, removed);
    for (const item of nodes) {
      if (item.toggleTargetId && removed.has(item.toggleTargetId)) delete item.toggleTargetId;
      if (item.interaction && 'nodeId' in item.interaction && removed.has(item.interaction.nodeId)) delete item.interaction;
      if (item.attributes?.href && removed.has(item.attributes.href.slice(1))) delete item.attributes.href;
    }
  } else if (edit.type === 'move') {
    if (!parent) throw new Error('Cannot move an artboard root.');
    const target = subtree(board.root).find(item => item.id === edit.parentId);
    if (!target || subtree(node).includes(target)) throw new Error('Choose a parent outside this subtree in the same artboard.');
    const children = container(target);
    const count = children.length - (parent === target ? 1 : 0);
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index > count) throw new Error('Invalid element position.');
    parent.children!.splice(parent.children!.indexOf(node), 1);
    children.splice(edit.index, 0, node);
  } else if (edit.type === 'duplicate') {
    if (!parent) throw new Error('Duplicate the artboard to copy its root.');
    const copy = structuredClone(node);
    const copies = subtree(copy);
    const ids = new Map(copies.map(item => [item.id, createEntityId('node')]));
    for (const item of copies) {
      item.id = ids.get(item.id)!;
      if (item.toggleTargetId) item.toggleTargetId = ids.get(item.toggleTargetId) ?? item.toggleTargetId;
      if (item.interaction && 'nodeId' in item.interaction) item.interaction.nodeId = ids.get(item.interaction.nodeId) ?? item.interaction.nodeId;
      if (item.attributes?.href?.startsWith('#')) item.attributes.href = `#${ids.get(item.attributes.href.slice(1)) ?? item.attributes.href.slice(1)}`;
    }
    board.css = duplicateCss(board.css ?? content.css, ids, true);
    copyTweaks(content, ids);
    parent.children!.splice(parent.children!.indexOf(node) + 1, 0, copy);
  } else throw new Error('Invalid design edit.');
}
