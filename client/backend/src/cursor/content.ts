import type { RendererMessagePart } from '@workspace/core/contracts';
import { record } from '../acp/acp-connection';

type Media = Extract<RendererMessagePart, {type:'media'}>;
type FileChange = {path:string;kind:'add'|'update'|'delete';oldText:string|null;newText:string};

/** Content stays presentation-only: no resource fetches, filesystem access or permission inference. */
export function cursorContent(block: unknown): {text?:string;media?:Media} {
  if (!record(block)) throw new Error('Invalid Cursor content block.');
  if (block.type === 'text' && typeof block.text === 'string') return {text:block.text};
  if (block.type === 'image') {
    if (typeof block.mimeType !== 'string' || typeof block.data !== 'string' || block.data.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data)) throw new Error('Invalid Cursor image content.');
    if (!['image/png','image/jpeg','image/webp','image/gif'].includes(block.mimeType)) return {text:`Image content (${block.mimeType})`};
    return {media:{type:'media',media:{url:`data:${block.mimeType};base64,${block.data}`,mimeType:block.mimeType,alt:'Image'}}};
  }
  if (block.type === 'resource' && record(block.resource) && typeof block.resource.uri === 'string') {
    if (typeof block.resource.text === 'string') return {text:`${block.resource.uri}\n${block.resource.text}`};
    return {text:block.resource.uri};
  }
  if (block.type === 'resource_link' && typeof block.uri === 'string') return {text:[typeof block.name === 'string' ? block.name : '',block.uri].filter(Boolean).join('\n')};
  if (typeof block.type === 'string') return {};
  throw new Error('Invalid Cursor content block.');
}

export function cursorToolContent(content: unknown[], kind: string): {body:string;changes:FileChange[];media:Media[]} {
  const text:string[] = [], changes:FileChange[] = [], media:Media[] = [];
  for (const item of content) {
    if (!record(item)) throw new Error('Invalid Cursor tool content.');
    if (item.type === 'diff') {
      if (typeof item.path !== 'string' || (item.oldText !== null && typeof item.oldText !== 'string') || typeof item.newText !== 'string') throw new Error('Invalid Cursor file change.');
      changes.push({path:item.path,kind:kind === 'delete' ? 'delete' : item.oldText === null ? 'add' : 'update',oldText:item.oldText,newText:item.newText});
      text.push(`File: ${item.path}\nBefore:\n${item.oldText ?? '(new file)'}\nAfter:\n${item.newText}`);
    } else if (item.type === 'content') {
      const projected = cursorContent(item.content);
      if (projected.text !== undefined) text.push(projected.text);
      if (projected.media) media.push(projected.media);
    }
  }
  return {body:text.join('\n'),changes,media};
}
