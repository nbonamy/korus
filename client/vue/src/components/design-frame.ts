import { designInteractionScript, designNodeHtml, type DesignArtboard, type DesignEdit } from '@workspace/core/design';
import { installDesignFrame } from './design-frame-runtime';

export type DesignCanvasChange = { artboardId: string; nodeId: string | null; edit: DesignEdit; expectedRevision: number };

/** No app APIs enter this document. The opaque-origin frame only reports user gestures. */
export function designFrame(board: DesignArtboard, css: string, token: string, revision: number, play: boolean, selected: string | null, labels: { width: string; height: string; size: string }): string {
  const config = JSON.stringify({ token, revision, play, selected, rootId: board.root.id, labels }).replaceAll('<', '\\u003c');
  const playback = play ? designInteractionScript(`node=>parent.postMessage({kind:'prototype',nodeId:node.id,token:${JSON.stringify(token)},revision:${revision}},'*')`) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${token}'; form-action 'none'; base-uri 'none'"><style>body{margin:0}*{box-sizing:border-box}${css}\n${play ? '' : '[data-design-id]{cursor:default;touch-action:none}[contenteditable=true]{cursor:text;touch-action:auto}'}</style></head><body>${designNodeHtml(board.root)}<script nonce="${token}">(${installDesignFrame.toString()})(${config});${playback}</script></body></html>`;
}
