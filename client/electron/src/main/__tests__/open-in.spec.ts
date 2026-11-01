import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import { createOpenInProvider, cropOpenInApplicationIcon, defaultOpenInApplication, resolveProjectPath } from '../open-in';

let tempDirectory: string | null = null;

afterEach(async () => {
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true });
    tempDirectory = null;
  }
});

describe('Open In', () => {
  it('discovers installed applications in product order with their native icons', async () => {
    const installed = new Set([
      '/Applications/Visual Studio Code.app',
      '/System/Library/CoreServices/Finder.app',
      '/System/Applications/Utilities/Terminal.app',
      '/Applications/Xcode.app',
    ]);
    const provider = createOpenInProvider({
      applicationDirectories: ['/Applications'],
      fileExists: vi.fn(async (filePath) => installed.has(filePath)),
      listDirectory: vi.fn().mockResolvedValue(['WebStorm.app', 'Notes.app']),
      fileIcon: vi.fn(async (filePath) => nativeImage(`data:image/png;base64,${path.basename(filePath)}`)),
    });

    await expect(provider.list()).resolves.toStrictEqual({
      defaultApplication: 'vscode',
      applications: [
        { id: 'vscode', label: 'VS Code', iconDataUrl: 'data:image/png;base64,Visual Studio Code.app' },
        { id: 'finder', label: 'Finder', iconDataUrl: 'data:image/png;base64,Finder.app' },
        { id: 'terminal', label: 'Terminal', iconDataUrl: 'data:image/png;base64,Terminal.app' },
        { id: 'xcode', label: 'Xcode', iconDataUrl: 'data:image/png;base64,Xcode.app' },
        { id: 'jetbrains', label: 'WebStorm', iconDataUrl: 'data:image/png;base64,WebStorm.app' },
      ],
    });
  });

  it('crops seven and a half percent from every edge of native application thumbnails', () => {
    const cropped = nativeImage('data:image/png;base64,cropped');
    const crop = vi.fn(() => cropped);
    const icon = {
      getSize: () => ({ width: 128, height: 128 }),
      crop,
    } as unknown as NativeImage;

    expect(cropOpenInApplicationIcon(icon)).toBe(cropped);
    expect(crop).toHaveBeenCalledWith({ x: 10, y: 10, width: 108, height: 108 });
  });

  it('uses JetBrains and then Finder when VS Code is unavailable', () => {
    expect(defaultOpenInApplication(['finder', 'jetbrains'])).toBe('jetbrains');
    expect(defaultOpenInApplication(['finder', 'xcode'])).toBe('finder');
  });

  it('launches installed apps and handles Finder folders and files natively', async () => {
    const execFile = vi.fn().mockResolvedValue(undefined);
    const openPath = vi.fn().mockResolvedValue('');
    const showItemInFolder = vi.fn();
    const stat = vi.fn()
      .mockResolvedValueOnce({ isDirectory: () => false })
      .mockResolvedValueOnce({ isDirectory: () => true })
      .mockResolvedValueOnce({ isDirectory: () => false });
    const provider = createOpenInProvider({
      applicationDirectories: ['/Applications'],
      execFile,
      fileExists: vi.fn(async (filePath) => (
        filePath === '/Applications/Visual Studio Code.app' ||
        filePath === '/System/Applications/Utilities/Terminal.app' ||
        filePath === '/System/Library/CoreServices/Finder.app'
      )),
      fileIcon: vi.fn(async () => nativeImage()),
      listDirectory: vi.fn().mockResolvedValue([]),
      openPath,
      showItemInFolder,
      stat,
    });

    await provider.open('vscode', '/repo');
    await provider.open('terminal', '/repo/src/main.ts');
    await provider.open('finder', '/repo');
    await provider.open('finder', '/repo/src/main.ts');

    expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-a', '/Applications/Visual Studio Code.app', '/repo']);
    expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-a', '/System/Applications/Utilities/Terminal.app', '/repo/src']);
    expect(openPath).toHaveBeenCalledWith('/repo');
    expect(showItemInFolder).toHaveBeenCalledWith('/repo/src/main.ts');
  });

  it('only resolves files contained by the canonical agent folder', async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'agent-workspace-open-in-'));
    const project = path.join(tempDirectory, 'project');
    const outside = path.join(tempDirectory, 'outside.ts');
    await mkdir(path.join(project, 'src'), { recursive: true });
    await writeFile(path.join(project, 'src', 'main.ts'), 'export {}\n');
    await writeFile(outside, 'export {}\n');
    await symlink(outside, path.join(project, 'src', 'linked.ts'));

    await expect(resolveProjectPath(project, 'src/main.ts')).resolves.toBe(await realpath(path.join(project, 'src', 'main.ts')));
    await expect(resolveProjectPath(project, 'src/linked.ts')).rejects.toThrow('only available for files inside');
    await expect(resolveProjectPath(project, '../outside.ts')).rejects.toThrow('only available for files inside');
  });
});

function nativeImage(dataUrl = ''): NativeImage {
  const image = {
    isEmpty: () => !dataUrl,
    getSize: () => ({ width: 128, height: 128 }),
    crop: () => image,
    toDataURL: () => dataUrl,
  } as unknown as NativeImage;
  return image;
}
