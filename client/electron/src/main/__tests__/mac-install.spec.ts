import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const volume = '/Volumes/Korus Installer';
const native = vi.hoisted(() => ({
  userData: '',
  response: 0,
  execFile: vi.fn(),
  trashItem: vi.fn(async () => undefined),
  showMessageBox: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => native.userData, whenReady: async () => undefined },
  dialog: { showMessageBox: native.showMessageBox },
  shell: { trashItem: native.trashItem },
}));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  const overrides = { existsSync: (file: string) => file === volume || original.existsSync(file) };
  return { ...original, ...overrides, default: { ...original, ...overrides } };
});
const dmg = '/Users/test/Downloads/Korus.dmg';
/** hdiutil lists the mounted images as a plist and plutil turns it into JSON; detach just succeeds. */
native.execFile.mockImplementation((command: string, args: string[], callback: (error: Error | null, stdout?: string) => void) => {
  const stdout = command === 'hdiutil' && args[0] === 'info' ? 'PLIST'
    : command === 'plutil' ? JSON.stringify({ images: [{ 'image-path': dmg, 'system-entities': [{ 'mount-point': volume }] }] })
    : '';
  queueMicrotask(() => callback(null, stdout));
  return { stdin: { end: vi.fn() } };
});
vi.mock('node:child_process', () => ({ execFile: native.execFile, default: { execFile: native.execFile } }));
vi.mock('../log', () => ({ logMain: vi.fn(), warnMain: vi.fn() }));

import { offerToTrashInstaller } from '../mac-install';

describe('offering to eject the installer', () => {
  let marker: string;
  const writeMarker = (diskImage: string) => writeFile(marker, JSON.stringify({ diskImage }));

  beforeEach(async () => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'darwin' } }));
    native.userData = await mkdtemp(path.join(os.tmpdir(), 'mac-install-'));
    marker = path.join(native.userData, 'pending-installer-eject.json');
    native.showMessageBox.mockImplementation(async () => ({ response: native.response }));
    native.response = 0;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    await rm(native.userData, { recursive: true, force: true });
  });

  it('ejects the disk image the install came from and trashes its dmg once the user agrees', async () => {
    await writeMarker(volume);

    await offerToTrashInstaller();

    expect(native.showMessageBox).toHaveBeenCalledOnce();
    expect(native.execFile).toHaveBeenCalledWith('hdiutil', ['detach', volume], expect.any(Function));
    expect(native.trashItem).toHaveBeenCalledExactlyOnceWith(dmg);
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the disk image mounted when the user declines, and asks only once', async () => {
    await writeMarker(volume);
    native.response = 1;

    await offerToTrashInstaller();
    await offerToTrashInstaller();

    expect(native.showMessageBox).toHaveBeenCalledOnce();
    expect(native.execFile).not.toHaveBeenCalled();
    expect(native.trashItem).not.toHaveBeenCalled();
  });

  it.each([
    ['nothing was installed from a disk image', undefined],
    ['the recorded path is not a mounted volume', '/Users/someone/Documents'],
    ['the volume is already gone', '/Volumes/no-such-installer-volume'],
  ])('does not ask when %s', async (_name, diskImage) => {
    if (diskImage) await writeMarker(diskImage);

    await offerToTrashInstaller();

    expect(native.showMessageBox).not.toHaveBeenCalled();
    expect(native.execFile).not.toHaveBeenCalled();
  });
});
