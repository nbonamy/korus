import { z } from 'zod';
import { parseStoreFile, serializeStoreFile } from './persistence/store-format';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SidePanelMarkdownRequest } from '@workspace/core/contracts';
import { emptyDocumentWorkspace, type DocumentReadResult, type DocumentSaveInput, type DocumentWorkspace, type DocumentWorkspaceChange, type DocumentWorkspaces } from '@workspace/core/document-workspace';

type StoredDocument = { agentId: string; content: string };
type Store = { clients: Record<string, DocumentWorkspaces>; documents: Record<string, StoredDocument> };

const identity = z.string().min(1).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const browserSchema = z.strictObject({ id: identity, url: z.string() });
const tabSchema = z.strictObject({ id: identity, title: z.string(), browser: browserSchema.optional(), path: z.string().optional(), documentId: identity.optional(), savedPath: z.string().optional() });
const layoutSchema = z.strictObject({ activeTab: z.string().nullable(), open: z.boolean(), width: z.number().finite(), filesPaneOpen: z.boolean(), filesPaneWidth: z.number().finite() });
const workspaceSchema = layoutSchema.loose().extend({ tabs: z.array(tabSchema.loose().extend({ browser: browserSchema.loose().optional() })) });
const changeSchema = layoutSchema.partial().extend({ upsert: z.array(tabSchema).optional(), close: z.array(identity).optional() });
const storeSchema = z.looseObject({ clients: z.record(identity, z.record(identity, workspaceSchema)), documents: z.record(identity, z.looseObject({ agentId: identity, content: z.string() })) });

/** One atomic store couples open references and backing bytes, including GC. */
export class DocumentWorkspaceService {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly filename: string) {}

  private transaction<T>(action: (store: Store) => Promise<T> | T): Promise<T> {
    const next = this.pending.catch(() => undefined).then(async () => {
      let store: Store;
      let stored = true;
      try {
        store = storeSchema.parse(parseStoreFile(this.filename, await readFile(this.filename, 'utf8')).data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        store = { clients: {}, documents: {} };
        stored = false;
      }
      const before = JSON.stringify(store);
      const result = await action(store);
      const retained = new Set(Object.values(store.clients).flatMap(workspaces => Object.values(workspaces).flatMap(workspace => workspace.tabs.flatMap(tab => tab.documentId ? [tab.documentId] : []))));
      for (const id of Object.keys(store.documents)) if (!retained.has(id)) delete store.documents[id];
      // Reads of an unchanged store must not rewrite every retained document body.
      if (JSON.stringify(store) === before && stored) return structuredClone(result);
      await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, serializeStoreFile(storeSchema.parse(store)), { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.filename);
      } finally { await rm(temporary, { force: true }); }
      return structuredClone(result);
    });
    this.pending = next;
    return next;
  }

  get(clientId: string): Promise<DocumentWorkspaces> {
    assertKey(clientId);
    return this.transaction(store => store.clients[clientId] ??= {});
  }

  display(agentId: string, request: SidePanelMarkdownRequest): Promise<SidePanelMarkdownRequest> {
    assertKey(agentId);
    return this.transaction(store => {
      const documentId = request.path ? undefined : randomUUID();
      const id = request.path ? `file:${encodeURIComponent(request.path)}` : `file:markdown:${documentId}`;
      if (documentId) store.documents[documentId] = { agentId, content: request.content };
      if (!Object.keys(store.clients).length) store.clients.desktop = {};
      for (const client of Object.values(store.clients)) {
        const workspace = client[agentId] ??= emptyDocumentWorkspace();
        const tab = { id, title: typeof request.title === 'string' ? request.title : 'Markdown', ...(documentId ? { documentId } : { path: request.path }) };
        const index = workspace.tabs.findIndex(candidate => candidate.id === id);
        if (index < 0) workspace.tabs.push(tab); else workspace.tabs[index] = tab;
        workspace.activeTab = id;
        workspace.open = true;
      }
      return { ...request, ...(documentId ? { documentId } : {}) };
    });
  }

  apply(clientId: string, agentId: string, change: DocumentWorkspaceChange): Promise<DocumentWorkspace> {
    assertKey(clientId); assertKey(agentId);
    change = changeSchema.parse(change);
    return this.transaction(store => {
      const workspace = (store.clients[clientId] ??= {})[agentId] ??= emptyDocumentWorkspace();
      for (const tab of change.upsert ?? []) {
        if (!tab || typeof tab.id !== 'string' || typeof tab.title !== 'string') throw new Error('Invalid workspace tab.');
        const existing = workspace.tabs.find(candidate => candidate.id === tab.id);
        // Transient/saved references may only originate in backend transactions.
        if (tab.documentId && existing?.documentId !== tab.documentId) throw new Error('Document is not open in this client.');
        if (tab.savedPath && existing?.savedPath !== tab.savedPath) throw new Error('Unrecognized saved document.');
        if (!existing) workspace.tabs.push(tab);
        else if (!existing.documentId && !existing.savedPath) Object.assign(existing, tab);
      }
      workspace.tabs = workspace.tabs.filter(tab => !change.close?.includes(tab.id));
      if (change.activeTab !== undefined) workspace.activeTab = change.activeTab;
      if (!workspace.tabs.some(tab => tab.id === workspace.activeTab)) workspace.activeTab = workspace.tabs.at(-1)?.id ?? null;
      if (typeof change.open === 'boolean') workspace.open = change.open;
      if (typeof change.filesPaneOpen === 'boolean') workspace.filesPaneOpen = change.filesPaneOpen;
      for (const key of ['width', 'filesPaneWidth'] as const) if (typeof change[key] === 'number' && Number.isFinite(change[key])) workspace[key] = Math.min(4000, Math.max(160, change[key]));
      if (!workspace.tabs.length && change.close?.length) workspace.open = false;
      return workspace;
    });
  }

  read(clientId: string, agentId: string, tabId: string, readPath: (filePath: string) => Promise<string>): Promise<DocumentReadResult> {
    assertKey(clientId); assertKey(agentId);
    return this.transaction(async store => {
      const tab = store.clients[clientId]?.[agentId]?.tabs.find(candidate => candidate.id === tabId);
      if (!tab) throw new Error('Document tab is closed.');
      if (tab.documentId) {
        const document = store.documents[tab.documentId];
        if (!document || document.agentId !== agentId) return { content: '', error: 'Document content is missing.' };
        return { content: document.content };
      }
      try { return { content: await readPath(tab.savedPath ?? tab.path ?? '') }; }
      catch (error) { return { content: '', error: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'File is missing. You can close this tab.' : String(error) }; }
    });
  }

  save(clientId: string, agentId: string, input: DocumentSaveInput, write: (filePath: string, content: string, overwrite: boolean) => Promise<string>): Promise<DocumentWorkspace> {
    assertKey(clientId); assertKey(agentId);
    return this.transaction(async store => {
      const workspace = store.clients[clientId]?.[agentId];
      const tab = workspace?.tabs.find(candidate => candidate.id === input.tabId);
      const document = tab?.documentId ? store.documents[tab.documentId] : undefined;
      if (!workspace || !tab || !document || document.agentId !== agentId) throw new Error('Transient document tab is closed.');
      const savedPath = await write(input.path, document.content, input.overwrite === true);
      delete tab.documentId;
      delete tab.path;
      tab.savedPath = savedPath;
      tab.title = path.basename(savedPath);
      return workspace;
    });
  }
}

function assertKey(value: string): void {
  if (!value || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('Invalid workspace identity.');
}
