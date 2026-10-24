import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveExtensionNativeHost } from './browser-extension-native-host';
import { fromBuffer, type ZipFile, type Entry } from 'yauzl';
import {
  supportedBrowserExtensions,
  type BrowserExtensionDefinition,
  type BrowserExtensionPackage,
  type BrowserExtensionPackageRequest,
  type BrowserExtensionPackageState,
} from '@workspace/core/browser-extensions';

/** Chrome versions use one to four integers; missing components are zero. */
function compareExtensionVersions(left: string, right: string): number {
  const parts = (version: string): number[] => {
    if (!/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(version)) throw new Error('Invalid extension version.');
    const result = version.split('.').map(Number);
    if (result.some((value) => value > 65535) || result.every((value) => value === 0))
      throw new Error('Invalid extension version.');
    return result;
  };
  const a = parts(left),
    b = parts(right);
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

const MAX_PACKAGE = 100 * 1024 * 1024;
const MAX_EXPANDED = 300 * 1024 * 1024;
type Manifest = {
  manifest_version: number;
  version: string;
  key?: string;
  minimum_chrome_version?: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_permissions?: string[];
  optional_host_permissions?: string[];
};
type Stored = { version: string; hash: string; enabled: boolean; permissions: string[] };
type Registry = Record<string, Record<string, Stored>>;
type Candidate = { owner: string; id: string; hash: string; manifest: Manifest; permissions: string[] };
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** Bounded protobuf wire decoder for CRX3's length-delimited proof fields. */
function fields(bytes: Buffer): Map<number, Buffer[]> {
  const result = new Map<number, Buffer[]>();
  let offset = 0;
  const integer = (): number => {
    let value = 0,
      factor = 1;
    for (let index = 0; index < 5 && offset < bytes.length; index++) {
      const next = bytes[offset++];
      value += (next & 127) * factor;
      if (!(next & 128)) return value;
      factor *= 128;
    }
    throw new Error('Invalid CRX header.');
  };
  while (offset < bytes.length) {
    const key = integer(),
      type = key & 7,
      tag = key >>> 3;
    if (!tag) throw new Error('Invalid CRX header.');
    if (type === 0) {
      integer();
      continue;
    }
    const length = type === 2 ? integer() : type === 1 ? 8 : type === 5 ? 4 : -1;
    if (length < 0 || length > bytes.length - offset) throw new Error('Invalid CRX header.');
    if (type === 2) result.set(tag, [...(result.get(tag) ?? []), bytes.subarray(offset, offset + length)]);
    offset += length;
  }
  return result;
}

/** Authenticate signed header AND ZIP contents with the expected extension key. */
export function verifyCrx3(bytes: Buffer, expectedId: string): { archive: Buffer; publicKey: Buffer } {
  if (
    bytes.length < 12 ||
    bytes.length > MAX_PACKAGE ||
    bytes.toString('ascii', 0, 4) !== 'Cr24' ||
    bytes.readUInt32LE(4) !== 3
  )
    throw new Error('Invalid CRX3 package.');
  const size = bytes.readUInt32LE(8);
  if (size > 1024 * 1024 || size > bytes.length - 12) throw new Error('Invalid CRX header.');
  const header = fields(bytes.subarray(12, 12 + size)),
    signed = header.get(10000)?.[0];
  if (!signed) throw new Error('Missing CRX signature.');
  const declared = fields(signed).get(1)?.[0];
  const alphabet = (value: Buffer): string =>
    [...value.toString('hex')].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  if (!declared || declared.length !== 16 || alphabet(declared) !== expectedId)
    throw new Error('Extension identity does not match.');
  const archive = bytes.subarray(12 + size),
    length = Buffer.alloc(4);
  length.writeUInt32LE(signed.length);
  const payload = Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signed, archive]);
  for (const proof of [...(header.get(2) ?? []), ...(header.get(3) ?? [])]) {
    const values = fields(proof),
      publicKey = values.get(1)?.[0],
      signature = values.get(2)?.[0];
    if (
      !publicKey ||
      !signature ||
      alphabet(createHash('sha256').update(publicKey).digest().subarray(0, 16)) !== expectedId
    )
      continue;
    if (verify('sha256', payload, createPublicKey({ key: publicKey, type: 'spki', format: 'der' }), signature))
      return { archive, publicKey };
  }
  throw new Error('Extension signature verification failed.');
}

async function downloadOfficial(id: string, chromeVersion: string): Promise<Buffer> {
  if (!/^\d+(\.\d+){0,3}$/.test(chromeVersion)) throw new Error('Invalid Chromium version.');
  let url = new URL('https://clients2.google.com/service/update2/crx');
  url.search = new URLSearchParams({
    response: 'redirect',
    acceptformat: 'crx3',
    prodversion: chromeVersion,
    x: `id=${id}&uc`,
  }).toString();
  const signal = AbortSignal.timeout(120_000);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['clients2.google.com', 'clients2.googleusercontent.com', 'update.googleapis.com'].includes(url.hostname)
    )
      throw new Error('Unofficial extension download URL.');
    const response = await fetch(url, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location') ?? '', url);
      continue;
    }
    if (!response.ok || !response.body) throw new Error('Could not download the official extension.');
    if (Number(response.headers.get('content-length')) > MAX_PACKAGE)
      throw new Error('Extension package is too large.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_PACKAGE) {
        await response.body.cancel().catch(() => {});
        throw new Error('Extension package is too large.');
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many extension download redirects.');
}

async function unpack(archive: Buffer, target: string, publicKey: Buffer, check = false): Promise<Manifest> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      archive,
      { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true },
      (error, file) => (error ? reject(error) : resolve(file)),
    ),
  );
  let count = 0,
    total = 0;
  const seen = new Set<string>();
  let signedManifest: Manifest | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const name = entry.fileName,
            kind = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (
            ++count > 30_000 ||
            seen.has(name) ||
            entry.isEncrypted() ||
            name.includes('\\') ||
            name.startsWith('/') ||
            name.split('/').some((part) => part === '..' || part === '.') ||
            ![0, 0o100000, 0o040000].includes(kind)
          )
            throw new Error('Unsafe extension archive.');
          seen.add(name);
          total += entry.uncompressedSize;
          if (total > MAX_EXPANDED || entry.uncompressedSize > MAX_PACKAGE)
            throw new Error('Extension archive is too large.');
          // Chromium owns/removes Web Store verification metadata when loading
          // unpacked extensions. Authenticate it in the CRX, not as runtime code.
          if (name === '_metadata/' || name.startsWith('_metadata/')) {
            zip.readEntry();
            return;
          }
          const filename = path.join(target, name);
          if (name.endsWith('/')) {
            if (!check) await mkdir(filename, { recursive: true, mode: 0o700 });
          } else {
            if (!check) await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
            const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) =>
              zip.openReadStream(entry, (error, stream) => (error ? rejectStream(error) : resolveStream(stream))),
            );
            const chunks: Buffer[] = [];
            let bytes = 0;
            for await (const chunk of stream) {
              bytes += chunk.length;
              if (bytes > entry.uncompressedSize) throw new Error('Invalid archive size.');
              chunks.push(Buffer.from(chunk));
            }
            if (bytes !== entry.uncompressedSize) throw new Error('Truncated extension archive.');
            let contents = Buffer.concat(chunks);
            if (name === 'manifest.json') {
              signedManifest = JSON.parse(contents.toString('utf8')) as Manifest;
              signedManifest.key = publicKey.toString('base64');
              contents = Buffer.from(JSON.stringify(signedManifest));
            }
            if (check) {
              if (!(await readFile(filename)).equals(contents))
                throw new Error('Installed extension contents failed verification.');
            } else await writeFile(filename, contents, { flag: 'wx', mode: 0o600 });
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  const manifest = signedManifest;
  if (!manifest) throw new Error('Missing extension manifest.');
  if (manifest.manifest_version !== 3) throw new Error('Only Manifest V3 extensions are supported.');
  compareExtensionVersions(manifest.version, manifest.version);
  for (const key of ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions'] as const)
    if (
      manifest[key] !== undefined &&
      (!Array.isArray(manifest[key]) || manifest[key]!.some((p) => typeof p !== 'string'))
    )
      throw new Error('Invalid extension permissions.');
  manifest.key = publicKey.toString('base64');
  return manifest;
}

/** Owns only package files and grants; never reads Electron/vault profile data. */
export class BrowserExtensionPackages {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly candidates = new Map<string, Candidate>();
  private readonly catalog: readonly BrowserExtensionDefinition[];
  constructor(
    private readonly root: string,
    private readonly options: {
      catalog?: readonly BrowserExtensionDefinition[];
      nativeHostDirectories?: readonly string[];
      download?: (id: string, chrome: string) => Promise<Buffer>;
    } = {},
  ) {
    this.catalog = options.catalog ?? supportedBrowserExtensions;
  }

  manage(
    clientId: string,
    profileId: string,
    input: BrowserExtensionPackageRequest,
  ): Promise<BrowserExtensionPackageState> {
    const next = this.pending.catch(() => {}).then(() => this.apply(clientId, profileId, input));
    this.pending = next;
    return next;
  }
  private packagePath(id: string, hash: string): string {
    return path.join(this.root, 'packages', id, hash);
  }
  private async installedManifest(id: string, record: Stored): Promise<Manifest> {
    if (!/^[a-f0-9]{64}$/.test(record.hash)) throw new Error('Invalid installed extension record.');
    const target = this.packagePath(id, record.hash);
    const bytes = await readFile(path.join(target, 'verified.crx'));
    if (digest(bytes) !== record.hash) throw new Error('Installed extension package failed verification.');
    const verified = verifyCrx3(bytes, id);
    const manifest = await unpack(verified.archive, target, verified.publicKey, true);
    if (manifest.version !== record.version) throw new Error('Installed extension version does not match.');
    return manifest;
  }
  private async apply(
    clientId: string,
    profileId: string,
    input: BrowserExtensionPackageRequest,
  ): Promise<BrowserExtensionPackageState> {
    if (
      !clientId ||
      !profileId ||
      clientId.length > 200 ||
      profileId.length > 200 ||
      !input ||
      typeof input !== 'object'
    )
      throw new Error('Invalid browser profile.');
    const owner = digest(`${clientId}\0${profileId}`),
      file = path.join(this.root, 'registry.json');
    let registry: Registry = {};
    try {
      registry = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const records = (registry[owner] ??= {});
    let candidate: BrowserExtensionPackageState['candidate'];
    let cleanupPath: string | undefined;
    let nativeHost: BrowserExtensionPackageState['nativeHost'];
    if ('id' in input && !this.catalog.some((manager) => manager.id === input.id))
      throw new Error('Unsupported browser extension.');
    const entry = 'id' in input ? records[input.id] : undefined;
    if (input.action === 'prepare') {
      const bytes = await (this.options.download ?? downloadOfficial)(input.id, input.chromeVersion);
      const verified = verifyCrx3(bytes, input.id),
        hash = digest(bytes);
      await mkdir(path.join(this.root, 'staging'), { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(path.join(this.root, 'staging', 'package-'));
      try {
        const manifest = await unpack(verified.archive, staging, verified.publicKey);
        if (
          manifest.minimum_chrome_version &&
          compareExtensionVersions(input.chromeVersion, manifest.minimum_chrome_version) < 0
        )
          throw new Error('This extension requires a newer Chromium runtime.');
        if (entry && compareExtensionVersions(manifest.version, entry.version) < 0)
          throw new Error('The official source returned an older extension version.');
        await writeFile(path.join(staging, 'verified.crx'), bytes, { mode: 0o600, flag: 'wx' });
        const target = this.packagePath(input.id, hash);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        try {
          await rename(staging, target);
        } catch (error) {
          if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          try {
            await unpack(verified.archive, target, verified.publicKey, true);
          } catch {
            await rm(target, { recursive: true, force: true });
            await rename(staging, target);
          }
        }
        const permissions = [...new Set([...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])])];
        const token = randomUUID();
        this.candidates.set(token, { owner, id: input.id, hash, manifest, permissions });
        candidate = {
          token,
          id: input.id,
          version: manifest.version,
          permissions,
          addedPermissions: permissions.filter((permission) => !entry?.permissions.includes(permission)),
        };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    } else if (input.action === 'commit' || input.action === 'cancel') {
      const value = this.candidates.get(input.token);
      if (!value || value.owner !== owner) throw new Error('Invalid package candidate.');
      if (input.action === 'commit') {
        const optional = [
          ...(value.manifest.optional_permissions ?? []),
          ...(value.manifest.optional_host_permissions ?? []),
        ];
        records[value.id] = {
          version: value.manifest.version,
          hash: value.hash,
          enabled: true,
          permissions: [
            ...new Set([
              ...value.permissions,
              ...(records[value.id]?.permissions ?? []).filter((permission) => optional.includes(permission)),
            ]),
          ],
        };
      }
      this.candidates.delete(input.token);
    } else if (input.action === 'enabled') {
      if (!entry || typeof input.enabled !== 'boolean') throw new Error('Manager is not installed.');
      entry.enabled = input.enabled;
    } else if (input.action === 'remove') delete records[input.id];
    else if (input.action === 'cleanup') {
      if (!entry || !/^[a-f0-9]{64}$/.test(entry.hash)) throw new Error('Extension is not installed.');
      const original = await readFile(path.join(this.packagePath(input.id, entry.hash), 'verified.crx'));
      const verified = verifyCrx3(original, input.id);
      cleanupPath = path.join(this.root, 'cleanup', input.id);
      await mkdir(cleanupPath, { recursive: true, mode: 0o700 });
      // App-owned blank extension, same verified identity, no vendor code,
      // background worker or content scripts. Used only for explicit removal.
      await writeFile(
        path.join(cleanupPath, 'manifest.json'),
        JSON.stringify({
          manifest_version: 3,
          name: 'Extension data cleanup',
          version: '0.0.0.1',
          key: verified.publicKey.toString('base64'),
          permissions: ['storage'],
        }),
        { mode: 0o600 },
      );
      await writeFile(path.join(cleanupPath, 'cleanup.html'), '<!doctype html><title>Extension data cleanup</title>', {
        mode: 0o600,
      });
    } else if (input.action === 'nativeHost') {
      if (!this.catalog.find((extension) => extension.id === input.id)?.nativeHosts?.includes(input.host))
        throw new Error('Unsupported native host.');
      if (!entry?.enabled || !entry.permissions.includes('nativeMessaging'))
        throw new Error('Native messaging permission is required.');
      const manifest = await this.installedManifest(input.id, entry);
      if (![...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])].includes('nativeMessaging'))
        throw new Error('Native messaging permission is not declared.');
      nativeHost = await resolveExtensionNativeHost(input.id, input.host, this.options.nativeHostDirectories);
    } else if (input.action === 'permissions') {
      if (!entry || !Array.isArray(input.permissions)) throw new Error('Manager is not installed.');
      const manifest = await this.installedManifest(input.id, entry);
      const optional = [...(manifest.optional_permissions ?? []), ...(manifest.optional_host_permissions ?? [])];
      if (
        input.permissions.some(
          (permission) =>
            (permission === 'nativeMessaging' &&
              !this.catalog.find((extension) => extension.id === input.id)?.nativeHosts?.length) ||
            !optional.includes(permission),
        )
      )
        throw new Error('Permission is not available.');
      entry.permissions = input.remove
        ? entry.permissions.filter((permission) => !input.permissions.includes(permission))
        : [...new Set([...entry.permissions, ...input.permissions])];
    } else if (input.action !== 'list') throw new Error('Invalid browser-extension operation.');
    if (input.action !== 'list' && input.action !== 'prepare' && input.action !== 'nativeHost') {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(registry), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
      if (
        input.action === 'remove' &&
        !Object.values(registry).some((profile) => profile[input.id]) &&
        ![...this.candidates.values()].some((candidate) => candidate.id === input.id)
      )
        await rm(path.join(this.root, 'packages', input.id), { recursive: true, force: true });
    }
    const extensions: BrowserExtensionPackage[] = [];
    for (const manager of this.catalog) {
      const record = records[manager.id];
      if (!record) {
        extensions.push({ ...manager, enabled: false, permissions: [] });
        continue;
      }
      try {
        if (!/^[a-f0-9]{64}$/.test(record.hash) || !Array.isArray(record.permissions))
          throw new Error('Invalid installed extension record.');
        const packagePath = this.packagePath(manager.id, record.hash);
        const manifest = await this.installedManifest(manager.id, record);
        extensions.push({
          ...manager,
          version: record.version,
          enabled: record.enabled,
          permissions: record.permissions.filter((permission) =>
            [
              ...(manifest.permissions ?? []),
              ...(manifest.host_permissions ?? []),
              ...(manifest.optional_permissions ?? []),
              ...(manifest.optional_host_permissions ?? []),
            ].includes(permission),
          ),
          optionalPermissions: [
            ...(manifest.optional_permissions ?? []),
            ...(manifest.optional_host_permissions ?? []),
          ],
          path: packagePath,
        });
      } catch {
        extensions.push({
          ...manager,
          version: record.version,
          enabled: record.enabled,
          permissions: [],
          error: 'Installed extension failed verification. Update or reinstall it.',
        });
      }
    }
    return {
      extensions,
      ...(nativeHost ? { nativeHost } : {}),
      ...(candidate ? { candidate } : {}),
      ...(cleanupPath ? { cleanupPath } : {}),
    };
  }
}
