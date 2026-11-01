import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentWorkspaceService } from '../document-workspace-service';

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'document-workspaces-test-'));
  homes.push(home);
  const filename = path.join(home, 'documents.json');
  return { home, filename, service: new DocumentWorkspaceService(filename) };
}

describe('document workspace lifetime', () => {
  it('opens stored documents with additive fields and keeps them through layout changes', async () => {
    const { service, filename } = await fixture();
    const document = await service.display('a', { kind: 'markdown', content: 'Keep this document' });
    const tabId = `file:markdown:${document.documentId}`;
    await service.apply('desktop', 'a', { upsert: [{ id: 'browser', title: 'Browser', browser: { id: 'primary', url: 'https://example.com' } }] });
    const stored = JSON.parse(await readFile(filename, 'utf8'));
    stored.data.futureStoreField = true;
    stored.data.clients.desktop.a.futureLayoutField = true;
    stored.data.clients.desktop.a.tabs[0].futureTabField = true;
    stored.data.clients.desktop.a.tabs[1].browser.futureBrowserField = true;
    stored.data.documents[document.documentId!].futureDocumentField = true;
    await writeFile(filename, JSON.stringify(stored));

    const restarted = new DocumentWorkspaceService(filename);
    expect((await restarted.get('desktop')).a!.tabs).toHaveLength(2);
    expect(await restarted.read('desktop', 'a', tabId, async () => '')).toStrictEqual({ content: 'Keep this document' });
    await restarted.apply('desktop', 'a', { width: 640 });
    stored.data.clients.desktop.a.width = 640;
    expect(JSON.parse(await readFile(filename, 'utf8')).data).toStrictEqual(stored.data);
    expect(() => restarted.apply('desktop', 'a', { futureCommandField: true } as never)).toThrow();
  });

  it('retains each browser identity and latest URL through a fresh service', async () => {
    const { service, filename } = await fixture();
    const tabs = [
      { id: 'browser', title: 'browser', browser: { id: 'primary', url: 'https://example.com/start' } },
      { id: 'browser:docs', title: 'Docs', browser: { id: 'docs', url: 'https://example.org/docs' } },
    ];
    await service.apply('desktop', 'a', { upsert: tabs, activeTab: 'browser:docs', open: true });
    tabs[0]!.browser.url = 'https://example.com/latest?q=one#section';
    await service.apply('desktop', 'a', { upsert: [tabs[0]!] });
    expect((await new DocumentWorkspaceService(filename).get('desktop')).a).toMatchObject({ tabs, activeTab: 'browser:docs', open: true });
    expect(await new DocumentWorkspaceService(filename).get('other-client')).toEqual({});
  });

  it('restores exact content, identities and per-agent layout through a fresh service and releases only the last reference', async () => {
    const { service, filename } = await fixture();
    await service.get('desktop');
    await service.get('web');
    const first = await service.display('a', { kind: 'markdown', title: 'Proposal', content: '# α\n\nExact bytes\n' });
    const second = await service.display('a', { kind: 'markdown', title: 'Proposal', content: 'Second' });
    await service.display('b', { kind: 'markdown', title: 'Other agent', content: 'Other' });
    const firstTab = `file:markdown:${first.documentId}`;
    await service.apply('desktop', 'a', { activeTab: firstTab, open: false, width: 650 });
    const restarted = new DocumentWorkspaceService(filename);
    expect((await restarted.get('desktop')).a).toMatchObject({ activeTab: firstTab, open: false, width: 650, tabs: [{ title: 'Proposal', documentId: first.documentId }, { documentId: second.documentId }] });
    expect(await restarted.read('desktop', 'a', firstTab, async () => { throw Error('Not a file'); })).toStrictEqual({ content: '# α\n\nExact bytes\n' });
    await restarted.apply('desktop', 'a', { close: [firstTab] });
    expect(await restarted.read('web', 'a', firstTab, async () => '')).toStrictEqual({ content: '# α\n\nExact bytes\n' });
    await restarted.apply('web', 'a', { close: [firstTab] });
    const persisted = JSON.parse(await readFile(filename, 'utf8')).data;
    expect(persisted.documents[first.documentId!]).toBeUndefined();
    expect((await new DocumentWorkspaceService(filename).get('desktop')).a!.tabs.map(tab => tab.id)).not.toContain(firstTab);
    expect((await restarted.get('desktop')).b!.tabs).toHaveLength(1);
  });

  it('serializes save/close, converts the same tab, preserves other clients, and never deletes the saved file', async () => {
    const { service, filename, home } = await fixture();
    await service.get('desktop'); await service.get('web');
    const doc = await service.display('a', { kind: 'markdown', content: 'Original', title: 'Title' });
    const tabId = `file:markdown:${doc.documentId}`;
    const destination = path.join(home, 'saved.md');
    const saved = await service.save('desktop', 'a', { tabId, path: destination }, async (file, content) => { await writeFile(file, content, { flag: 'wx' }); return file; });
    expect(saved.tabs).toStrictEqual([{ id: tabId, title: 'saved.md', savedPath: destination }]);
    const restarted = new DocumentWorkspaceService(filename);
    expect(await restarted.read('desktop', 'a', tabId, file => readFile(file, 'utf8'))).toStrictEqual({ content: 'Original' });
    expect(await restarted.read('web', 'a', tabId, async () => '')).toStrictEqual({ content: 'Original' });
    await restarted.apply('desktop', 'a', { close: [tabId] });
    expect(await readFile(destination, 'utf8')).toBe('Original');
    await expect(restarted.save('desktop', 'a', { tabId, path: destination }, async () => destination)).rejects.toThrow('closed');
  });

  it('keeps transient bytes on write failure and refuses forged references; missing files remain closeable', async () => {
    const { service, filename } = await fixture();
    const doc = await service.display('a', { kind: 'markdown', content: 'Retain me' });
    const tabId = `file:markdown:${doc.documentId}`;
    await expect(service.save('desktop', 'a', { tabId, path: 'exists.md' }, async () => { throw Error('Already exists'); })).rejects.toThrow('Already exists');
    expect(await new DocumentWorkspaceService(filename).read('desktop', 'a', tabId, async () => '')).toStrictEqual({ content: 'Retain me' });
    await expect(service.apply('attacker', 'a', { upsert: [{ id: 'stolen', title: 'Stolen', documentId: doc.documentId }] })).rejects.toThrow('not open');
    await expect(service.apply('desktop', 'a', { upsert: [{ id: 'forged', title: 'Private', savedPath: '/private/file' }] })).rejects.toThrow('Unrecognized');
    await service.apply('desktop', 'a', { upsert: [{ id: 'file:missing', title: 'missing.md', path: 'missing.md' }] });
    expect(await service.read('desktop', 'a', 'file:missing', async () => { throw Object.assign(Error(), { code: 'ENOENT' }); })).toStrictEqual({ content: '', error: 'File is missing. You can close this tab.' });
    expect((await service.get('desktop')).a!.tabs).toHaveLength(2);
  });

  it('does not lose concurrently delivered tabs to a stale layout write or retain genuine orphan bytes', async () => {
    const { service, filename } = await fixture();
    const first = await service.display('a', { kind: 'markdown', content: 'First' });
    const tabId = `file:markdown:${first.documentId}`;
    await Promise.all([service.display('a', { kind: 'markdown', content: 'New' }), service.apply('desktop', 'a', { close: [tabId], open: false })]);
    expect((await service.get('desktop')).a!.tabs).toHaveLength(1);
    const raw = JSON.parse(await readFile(filename, 'utf8')).data;
    raw.documents.orphan = { agentId: 'a', content: 'Orphan' };
    await writeFile(filename, JSON.stringify({ schemaVersion: 1, data: raw }));
    await new DocumentWorkspaceService(filename).get('desktop');
    expect(JSON.parse(await readFile(filename, 'utf8')).data.documents.orphan).toBeUndefined();
  });
  it('refuses corrupt and newer stores without rewriting their bytes', async () => {
    const { service, filename } = await fixture();
    for (const content of ['{broken', JSON.stringify({ schemaVersion: 9, data: { clients: {}, documents: {} } }), JSON.stringify({ schemaVersion: 1, data: { clients: { desktop: { a: { tabs: 'invalid' } } }, documents: {} } })]) {
      await writeFile(filename, content);
      await expect(service.get('desktop')).rejects.toThrow();
      expect(await readFile(filename, 'utf8')).toBe(content);
    }
  });

  it('leaves the store bytes untouched for reads and gets that change nothing', async () => {
    const { service, filename } = await fixture();
    await service.get('desktop');
    const doc = await service.display('a', { kind: 'markdown', content: 'Stable' });
    const tabId = `file:markdown:${doc.documentId}`;
    // Reformatting makes any rewrite observable as different bytes.
    const pretty = JSON.stringify(JSON.parse(await readFile(filename, 'utf8')), null, 2);
    await writeFile(filename, pretty);
    expect((await service.get('desktop')).a!.tabs).toHaveLength(1);
    expect(await service.read('desktop', 'a', tabId, async () => '')).toStrictEqual({ content: 'Stable' });
    expect(await readFile(filename, 'utf8')).toBe(pretty);
    await service.get('new-client');
    expect(JSON.parse(await readFile(filename, 'utf8')).data.clients['new-client']).toEqual({});
  });

  it('serializes a close behind an in-flight save and retains only the saved file', async () => {
    const { service, filename, home } = await fixture();
    const doc = await service.display('a', { kind: 'markdown', content: 'Save before close' });
    const tabId = `file:markdown:${doc.documentId}`;
    let release!: () => void;
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const destination = path.join(home, 'concurrent.md');
    const saving = service.save('desktop', 'a', { tabId, path: destination }, async (file, content) => { started(); await gate; await writeFile(file, content); return file; });
    await begun;
    const closing = service.apply('desktop', 'a', { close: [tabId] });
    release();
    await Promise.all([saving, closing]);
    expect((await new DocumentWorkspaceService(filename).get('desktop')).a!.tabs).toEqual([]);
    expect(await readFile(destination, 'utf8')).toBe('Save before close');
    expect(JSON.parse(await readFile(filename, 'utf8')).data.documents).toEqual({});
  });

});
