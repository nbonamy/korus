import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BrowserExtensionPackages, verifyCrx3 } from '../browser-extension-packages';

// Failure modes: forged archive/key, wrong identity, archive traversal, permission
// escalation, lost installation on failed update, cross-profile data removal.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' });
const idBytes = createHash('sha256').update(publicKey).digest().subarray(0, 16);
const id = [...idBytes.toString('hex')].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function field(tag: number, bytes: Buffer): Buffer {
  const varint = (n: number): Buffer => {
    const out: number[] = [];
    do {
      out.push((n & 127) | (n > 127 ? 128 : 0));
      n >>>= 7;
    } while (n);
    return Buffer.from(out);
  };
  return Buffer.concat([varint(tag * 8 + 2), varint(bytes.length), bytes]);
}
function zip(files: Record<string, string>): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name),
      data = Buffer.from(text),
      header = Buffer.alloc(30),
      index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    index.writeUInt32LE(0x02014b50);
    index.writeUInt16LE(20, 4);
    index.writeUInt16LE(20, 6);
    header.copy(index, 8, 6, 26);
    index.writeUInt16LE(filename.length, 28);
    index.writeUInt32LE(offset, 42);
    local.push(header, filename, data);
    central.push(index, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function packageBytes(
  version = '8.12.42.36',
  extra: Record<string, string> = {},
  permissions = ['storage'],
  optionalPermissions: string[] = [],
): Buffer {
  const archive = zip({
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Owned fixture',
      version,
      permissions,
      optional_permissions: optionalPermissions,
      host_permissions: ['https://example.test/*'],
      action: { default_popup: 'popup.html' },
    }),
    'popup.html': '<p>Owned fixture</p>',
    ...extra,
  });
  const signed = field(1, idBytes),
    length = Buffer.alloc(4);
  length.writeUInt32LE(signed.length);
  const signature = sign(
    'sha256',
    Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signed, archive]),
    keys.privateKey,
  );
  const header = Buffer.concat([
    field(2, Buffer.concat([field(1, publicKey), field(2, signature)])),
    field(10000, signed),
  ]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, archive]);
}

describe('browser-extension package boundary', () => {
  it('authenticates the signed archive and identity before accepting any contents', () => {
    const bytes = packageBytes();
    expect(verifyCrx3(bytes, id).publicKey).toEqual(publicKey);
    expect(() => verifyCrx3(bytes, 'a'.repeat(32))).toThrow(/identity/i);
    bytes[bytes.length - 1] ^= 1;
    expect(() => verifyCrx3(bytes, id)).toThrow(/signature/i);
    expect(() => verifyCrx3(Buffer.alloc(8), id)).toThrow(/CRX/i);
  });

  it('preserves the installed version on failure, accepts fourth-component updates, and isolates profile removal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'browser-extension-test-'));
    roots.push(root);
    let bytes = packageBytes();
    const service = new BrowserExtensionPackages(root, {
      catalog: [{ id, name: 'Owned fixture' }],
      download: async () => bytes,
    });
    const prepare = () => service.manage('desktop', 'agent-one', { action: 'prepare', id, chromeVersion: '150.0.0.0' });
    const initial = await prepare();
    expect(initial.candidate?.permissions).toEqual(['storage', 'https://example.test/*']);
    await expect(
      service.manage('desktop', 'other', { action: 'commit', token: initial.candidate!.token }),
    ).rejects.toThrow(/candidate/i);
    await service.manage('desktop', 'agent-one', { action: 'commit', token: initial.candidate!.token });
    const installed = (await service.manage('desktop', 'agent-one', { action: 'list' })).extensions[0];
    expect(installed).toMatchObject({ id, version: '8.12.42.36', enabled: true });
    bytes = packageBytes('8.12.42.37');
    bytes[bytes.length - 1] ^= 1;
    await expect(prepare()).rejects.toThrow(/signature/i);
    expect((await service.manage('desktop', 'agent-one', { action: 'list' })).extensions[0].version).toBe('8.12.42.36');
    expect(JSON.parse(await readFile(path.join(installed.path!, 'manifest.json'), 'utf8')).version).toBe('8.12.42.36');
    bytes = packageBytes('8.12.42.37', {}, ['storage', 'tabs']);
    const update = await prepare();
    expect(update.candidate?.addedPermissions).toEqual(['tabs']);
    await service.manage('desktop', 'agent-one', { action: 'commit', token: update.candidate!.token });
    const second = await service.manage('desktop', 'agent-two', { action: 'prepare', id, chromeVersion: '150.0.0.0' });
    await service.manage('desktop', 'agent-two', { action: 'commit', token: second.candidate!.token });
    await service.manage('desktop', 'agent-one', { action: 'enabled', id, enabled: false });
    const restarted = new BrowserExtensionPackages(root, {
      catalog: [{ id, name: 'Owned fixture' }],
      download: async () => bytes,
    });
    expect((await restarted.manage('desktop', 'agent-one', { action: 'list' })).extensions[0].enabled).toBe(false);
    await restarted.manage('desktop', 'agent-one', { action: 'remove', id });
    expect((await restarted.manage('desktop', 'agent-one', { action: 'list' })).extensions[0].version).toBeUndefined();
    const retained = (await restarted.manage('desktop', 'agent-two', { action: 'list' })).extensions[0];
    expect(retained.version).toBe('8.12.42.37');
    expect(JSON.parse(await readFile(path.join(retained.path!, 'manifest.json'), 'utf8')).version).toBe(
      retained.version,
    );
    await expect(
      restarted.manage('desktop', 'agent-two', { action: 'prepare', id: 'b'.repeat(32), chromeVersion: '150' }),
    ).rejects.toThrow(/supported/i);
    await writeFile(path.join(retained.path!, 'popup.html'), '<p>tampered</p>');
    const corrupted = (await restarted.manage('desktop', 'agent-two', { action: 'list' })).extensions[0];
    expect(corrupted.error).toMatch(/verification/i);
    expect(corrupted.path).toBeUndefined();
    const repair = await restarted.manage('desktop', 'agent-two', { action: 'prepare', id, chromeVersion: '150' });
    await restarted.manage('desktop', 'agent-two', { action: 'commit', token: repair.candidate!.token });
    expect((await restarted.manage('desktop', 'agent-two', { action: 'list' })).extensions[0].error).toBeUndefined();
  });

  it('rejects signed but unsafe archives without replacing a package', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'browser-extension-test-'));
    roots.push(root);
    const service = new BrowserExtensionPackages(root, {
      catalog: [{ id, name: 'Owned fixture' }],
      download: async () => packageBytes('1', { '../escape': 'bad' }),
    });
    await expect(
      service.manage('desktop', 'agent-one', { action: 'prepare', id, chromeVersion: '150' }),
    ).rejects.toThrow();
    expect((await service.manage('desktop', 'agent-one', { action: 'list' })).extensions[0].version).toBeUndefined();
  });
  it('restores only consented native access and resolves a registered host for its allowed origin', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'browser-native-grants-'));
    roots.push(root);
    const hosts = path.join(root, 'hosts');
    await mkdir(hosts);
    const name = 'com.8bit.bitwarden';
    const filename = path.join(hosts, `${name}.json`);
    const manifest = { name, type: 'stdio', path: process.execPath, allowed_origins: [`chrome-extension://${id}/`] };
    await writeFile(filename, JSON.stringify(manifest));
    const options = {
      catalog: [{ id, name: 'Owned fixture', nativeHosts: [name] }],
      download: async () => packageBytes('1', {}, ['storage'], ['nativeMessaging']),
      nativeHostDirectories: [hosts],
    };
    const service = new BrowserExtensionPackages(root, options);
    const candidate = await service.manage('desktop', 'agent', { action: 'prepare', id, chromeVersion: '150' });
    await service.manage('desktop', 'agent', { action: 'commit', token: candidate.candidate!.token });
    const hostRequest = { action: 'nativeHost', id, host: name } as const;
    await expect(service.manage('desktop', 'agent', hostRequest)).rejects.toThrow(/permission/i);
    await service.manage('desktop', 'agent', { action: 'permissions', id, permissions: ['nativeMessaging'] });
    const restarted = new BrowserExtensionPackages(root, options);
    expect((await restarted.manage('desktop', 'agent', { action: 'list' })).extensions[0].permissions).toContain(
      'nativeMessaging',
    );
    expect((await restarted.manage('desktop', 'agent', hostRequest)).nativeHost).toEqual({
      name,
      path: process.execPath,
    });
    await expect(restarted.manage('desktop', 'other-agent', hostRequest)).rejects.toThrow(/permission/i);
    await expect(restarted.manage('desktop', 'agent', { ...hostRequest, host: '../arbitrary' })).rejects.toThrow(
      /host/i,
    );
    await writeFile(filename, JSON.stringify({ ...manifest, allowed_origins: ['chrome-extension://other/'] }));
    await expect(restarted.manage('desktop', 'agent', hostRequest)).rejects.toThrow(/origin/i);
    await service.manage('desktop', 'agent', {
      action: 'permissions',
      id,
      permissions: ['nativeMessaging'],
      remove: true,
    });
    await expect(service.manage('desktop', 'agent', hostRequest)).rejects.toThrow(/permission/i);
  });
});
