import postcss from 'postcss';
import { copyTweaks, removeTweaks } from './design-tweaks';
import type { DesignTweakEdit } from '@workspace/core/design-tweaks';
import selectorParser from 'postcss-selector-parser';
import { createEntityId } from '@workspace/core/ids';
import { designArtboardPositions, designNodes, type DesignContent, type DesignEdit, type DesignNode } from '@workspace/core/design';

type ArtboardEdit = Exclude<DesignEdit, { nodeId: string } | DesignTweakEdit>;

/** Copies keep the rendered style but never share authored element identity. */
export function duplicateCss(css: string, ids: Map<string, string>, keepOriginal = false): string {
  const selectors = selectorParser(root => {
    root.walkIds(node => { node.value = ids.get(node.value) ?? node.value; });
    root.walkAttributes(node => {
      if (!node.value) return;
      const prefix = node.attribute === 'href' ? '#' : '';
      if (!['id', 'data-design-id', 'href'].includes(node.attribute)) return;
      const replacement = ids.get(prefix ? node.value.slice(1) : node.value);
      if (replacement) node.setValue(prefix + replacement, { quoteMark: node.quoteMark });
    });
  });
  const stylesheet = postcss.parse(css);
  stylesheet.walkRules(rule => {
    const remapped = selectors.processSync(rule.selector);
    rule.selector = keepOriginal && remapped !== rule.selector ? `${rule.selector},${remapped}` : remapped;
  });
  stylesheet.walkAtRules('scope', rule => {
    const remapped = rule.params.replace(/#([a-zA-Z][\w-]*)/g, (match, id: string) => ids.has(id) ? `#${ids.get(id)}` : match);
    if (keepOriginal && remapped !== rule.params) rule.cloneAfter({ params: remapped });
    else rule.params = remapped;
  });
  return stylesheet.toString();
}

export function applyArtboardEdit(content: DesignContent, edit: ArtboardEdit): void {
  const boards = content.artboards;
  if (edit.type === 'artboard-add') {
    const index = edit.index ?? boards.length;
    if (!Number.isInteger(index) || index < 0 || index > boards.length) throw new Error('Invalid artboard position.');
    boards.splice(index, 0, structuredClone(edit.artboard));
    return;
  }
  if (edit.type === 'choose-artboard' && edit.artboardId === null) { delete content.chosenArtboardId; return; }
  const index = boards.findIndex(board => board.id === edit.artboardId);
  if (index === -1) throw new Error('Design artboard not found.');
  const board = boards[index];
  if (edit.type === 'artboard-duplicate') {
    const copy = structuredClone(board);
    copy.id = createEntityId('artboard');
    copy.title = edit.title ?? `${board.title} copy`;
    const position = designArtboardPositions(boards).get(board.id)!;
    copy.position = { x: position.x + board.width + 80, y: position.y };
    const ids = new Map(designNodes({ ...content, artboards: [board] }).map(node => [node.id, createEntityId('node')]));
    const remap = (node: DesignNode) => {
      node.id = ids.get(node.id)!;
      if (node.toggleTargetId) node.toggleTargetId = ids.get(node.toggleTargetId) ?? node.toggleTargetId;
      if (node.interaction?.type === 'navigate' && node.interaction.artboardId === board.id) node.interaction.artboardId = copy.id;
      if (node.interaction && 'nodeId' in node.interaction) node.interaction.nodeId = ids.get(node.interaction.nodeId) ?? node.interaction.nodeId;
      if (node.attributes?.href?.startsWith('#')) node.attributes.href = `#${ids.get(node.attributes.href.slice(1)) ?? node.attributes.href.slice(1)}`;
      node.children?.forEach(remap);
    };
    remap(copy.root);
    copy.css = duplicateCss(board.css ?? content.css, ids);
    copyTweaks(content, ids);
    boards.splice(index + 1, 0, copy);
  } else if (edit.type === 'artboard-update') {
    if (!edit.changes || Object.keys(edit.changes).some(key => !['title', 'width', 'height', 'notes', 'css', 'position'].includes(key))) throw new Error('Invalid artboard changes.');
    Object.assign(board, edit.changes);
  } else if (edit.type === 'artboard-remove') {
    if (boards.length === 1) throw new Error('Cannot remove the last artboard.');
    const removed = new Set(designNodes({ ...content, artboards: [board] }).map(node => node.id));
    content.comments = content.comments.filter(comment => !removed.has(comment.nodeId));
    removeTweaks(content, removed);
    boards.splice(index, 1);
    for (const node of designNodes(content)) if (node.interaction?.type === 'navigate' && node.interaction.artboardId === board.id) delete node.interaction;
    if (content.chosenArtboardId === board.id) delete content.chosenArtboardId;
  } else if (edit.type === 'artboard-move') {
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= boards.length) throw new Error('Invalid artboard position.');
    boards.splice(index, 1);
    boards.splice(edit.index, 0, board);
  } else if (edit.type === 'choose-artboard') content.chosenArtboardId = board.id;
  else throw new Error('Invalid artboard edit.');
}
