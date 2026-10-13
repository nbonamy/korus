import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpReleaseAsset } from '../release';
import { installAcpRuntime } from '../installer';
import { resolveAcpRuntime } from '../runtime';
import { AcpRuntime } from '../acp-runtime';
import registry from './fixtures/registry-agent.json';

const fixture = vi.hoisted(() => ({ asset: null as AcpReleaseAsset | null }));
vi.mock('../release', async original => ({ ...await original<typeof import('../release')>(), resolveAcpReleaseAsset: () => fixture.asset }));
vi.mock('node:fs/promises', async original => {
  const filesystem = await original<typeof import('node:fs/promises')>();
  return { ...filesystem, statfs: vi.fn(filesystem.statfs) };
});
let root: string;
const server = (version = '1.3.0') => Buffer.from(`#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const message=JSON.parse(line);
 if(message.method==='initialize') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:2,agentInfo:{name:'antigravity-acp',version:'${version}'}}})+'\\n');
});
`);

/** Small, stored ZIP fixtures exercise the real archive reader and child runtime. */
function zip(entries: [string, Buffer, number?][]): Buffer {
  const files: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes, mode = 0o100644] of entries) {
    const filename = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(bytes), 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    files.push(local, filename, bytes); directory.push(central, filename); offset += local.length + filename.length + bytes.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, central, end]);
}

function download(entries: [string, Buffer, number?][] = [['agy_acp_server.par', server()], ['localharness_external', Buffer.from('harness')]], executable = 'agy_acp_server.par', harness = 'localharness_external') {
  const bytes = zip(entries);
  fixture.asset = { url: 'https://dl.google.com/fixture.zip', sha256: createHash('sha256').update(bytes).digest('hex'), archiveBytes: bytes.length,
    executable: { name: executable, bytes: entries.find(([name]) => name === executable)?.[1].length ?? server().length },
    harness: { name: harness, bytes: 7 } };
  const fetch = vi.fn().mockResolvedValue(new Response(bytes));
  vi.stubGlobal('fetch', fetch);
  return { bytes, fetch };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'korus-acp-installer-'));
  vi.stubEnv('APP_HOME', root); vi.stubEnv('APP_ANTIGRAVITY_COMMAND', ''); vi.stubEnv('ANTIGRAVITY_HARNESS_PATH', '');
  vi.stubEnv('SHELL', path.join(root, 'no-login-shell'));
  download();
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); });

describe('Antigravity ACP installation', () => {
  it.each([
    ['darwin', 'arm64', 'darwin-aarch64'], ['darwin', 'x64', 'darwin-x86_64'],
    ['linux', 'arm64', 'linux-aarch64'], ['linux', 'x64', 'linux-x86_64'],
    ['win32', 'arm64', 'windows-aarch64'], ['win32', 'x64', 'windows-x86_64'],
  ] as const)('downloads and discovers the published %s/%s runtime with the correct executable and launch arguments', async (platform, arch, distribution) => {
    const actual = await vi.importActual<typeof import('../release')>('../release');
    const asset = actual.resolveAcpReleaseAsset(platform, arch)!;
    const published = registry.distribution.binary[distribution];
    expect(asset.url).toBe(published.archive);
    vi.stubGlobal('process', { ...process, platform, arch });
    const { fetch } = download([[asset.executable.name, server()], [asset.harness.name, Buffer.from('harness')]], asset.executable.name, asset.harness.name);
    fixture.asset!.url = asset.url;
    const close = vi.fn().mockResolvedValue(undefined);
    // Only the native process boundary is fake in these host-platform cases.
    const open = vi.spyOn(AcpRuntime, 'open').mockResolvedValue({ close } as unknown as AcpRuntime);
    await installAcpRuntime();
    expect(fetch).toHaveBeenCalledWith(published.archive, expect.any(Object));
    const runtime = resolveAcpRuntime()!;
    expect(path.basename(runtime.command)).toBe(published.cmd.slice(2));
    expect(path.basename(runtime.harness)).toBe(asset.harness.name);
    expect(open.mock.calls[0]![0].runtime?.args).toStrictEqual('args' in published ? published.args : []);
    expect(close).toHaveBeenCalledOnce();
  });
  it('activates only a checksum-verified pair that initializes as qualified ACP, without signing in', async () => {
    const { fetch } = download();
    await installAcpRuntime();
    const runtime = resolveAcpRuntime()!;
    expect(runtime.command.startsWith(root + path.sep)).toBe(true);
    expect(await readFile(runtime.harness, 'utf8')).toBe('harness');
    expect((await stat(runtime.command)).mode & 0o111).toBe(0o111);
    expect((await stat(runtime.harness)).mode & 0o111).toBe(0o111);
    await installAcpRuntime();
    expect(fetch).toHaveBeenCalledOnce();
    expect((await readdir(path.join(root, 'antigravity'))).some(name => name.startsWith('.install-'))).toBe(false);
  });

  it.each(['checksum', 'truncated', 'oversized', 'http', 'network'] as const)('rejects a %s download without activating a runtime and lets the user retry', async failure => {
    const { bytes, fetch } = download();
    if (failure === 'checksum') fixture.asset!.sha256 = '0'.repeat(64);
    else if (failure === 'truncated') fetch.mockResolvedValueOnce(new Response(bytes.subarray(0, bytes.length - 1)));
    else if (failure === 'oversized') fetch.mockResolvedValueOnce(new Response(Buffer.concat([bytes, Buffer.from('extra')])));
    else if (failure === 'http') fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    else fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(installAcpRuntime()).rejects.toThrow();
    expect(resolveAcpRuntime()).toBeNull();
    expect(await readdir(path.join(root, 'antigravity'))).toStrictEqual([]);
    download();
    await installAcpRuntime();
    expect(resolveAcpRuntime()).not.toBeNull();
  });

  it.each(['missing harness', 'duplicate', 'unexpected file', 'symlink', 'wrong version'] as const)('rejects an archive with %s before publishing it', async failure => {
    const entries: [string, Buffer, number?][] = [['agy_acp_server.par', server(failure === 'wrong version' ? '9.0.0' : '1.3.0')]];
    if (failure !== 'missing harness') entries.push(['localharness_external', Buffer.from('harness'), failure === 'symlink' ? 0o120777 : undefined]);
    if (failure === 'duplicate') entries.push(['localharness_external', Buffer.from('harness')]);
    if (failure === 'unexpected file') entries.push(['../outside', Buffer.from('bad')]);
    download(entries);
    await expect(installAcpRuntime()).rejects.toThrow();
    expect(resolveAcpRuntime()).toBeNull();
    expect(await readdir(path.join(root, 'antigravity'))).toStrictEqual([]);
  });

  it('rejects unsupported platforms without downloading anything', async () => {
    const { fetch } = download();
    fixture.asset = null;
    await expect(installAcpRuntime()).rejects.toThrow('unavailable for this platform');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not start a download when there is insufficient disk space or an unresolved custom runtime', async () => {
    const { fetch } = download();
    vi.mocked(filesystem.statfs).mockResolvedValueOnce({ bavail: 0n, bsize: 4096n } as unknown as Awaited<ReturnType<typeof filesystem.statfs>>);
    await expect(installAcpRuntime()).rejects.toThrow('free disk space');
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('APP_ANTIGRAVITY_COMMAND', path.join(root, 'missing-custom-runtime'));
    await expect(installAcpRuntime()).rejects.toThrow('custom Antigravity runtime paths');
    expect(fetch).not.toHaveBeenCalled();
  });
});
