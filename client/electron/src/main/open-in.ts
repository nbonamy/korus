import type { NativeImage } from 'electron';
import { nativeImage, shell } from 'electron';
import { execFile } from 'node:child_process';
import { access, readdir, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OpenInApplication, OpenInApplicationCatalog, OpenInApplicationOption } from '@workspace/core/contracts';

type InstalledOpenInApplication = OpenInApplicationOption & {
  applicationPath: string;
};

export type OpenInProvider = {
  list(): Promise<OpenInApplicationCatalog>;
  open(application: OpenInApplication, targetPath: string): Promise<void>;
};

type OpenInDependencies = {
  applicationDirectories: string[];
  execFile(command: string, args: string[]): Promise<unknown>;
  fileExists(filePath: string): Promise<boolean>;
  fileIcon(filePath: string): Promise<NativeImage>;
  listDirectory(directoryPath: string): Promise<string[]>;
  openPath(filePath: string): Promise<string>;
  showItemInFolder(filePath: string): void;
  stat(filePath: string): Promise<{ isDirectory(): boolean }>;
};

const fixedApplications: Array<{
  id: Exclude<OpenInApplication, 'jetbrains'>;
  label: string;
  relativePaths: string[];
}> = [
  { id: 'vscode', label: 'VS Code', relativePaths: ['Visual Studio Code.app'] },
  { id: 'finder', label: 'Finder', relativePaths: ['/System/Library/CoreServices/Finder.app'] },
  { id: 'terminal', label: 'Terminal', relativePaths: ['/System/Applications/Utilities/Terminal.app'] },
  { id: 'iterm2', label: 'iTerm2', relativePaths: ['iTerm.app'] },
  { id: 'ghostty', label: 'Ghostty', relativePaths: ['Ghostty.app'] },
  { id: 'xcode', label: 'Xcode', relativePaths: ['Xcode.app'] },
  { id: 'android-studio', label: 'Android Studio', relativePaths: ['Android Studio.app'] },
];

const jetBrainsApplicationPattern = /^(?:Aqua|CLion|DataGrip|Fleet|GoLand|IntelliJ IDEA(?: CE)?|PhpStorm|PyCharm(?: CE)?|Rider|RubyMine|RustRover|WebStorm)(?: EAP)?\.app$/iu;
const terminalApplications = new Set<OpenInApplication>(['terminal', 'iterm2', 'ghostty']);

export function createOpenInProvider(dependencies: Partial<OpenInDependencies> = {}): OpenInProvider {
  const resolved = defaultDependencies(dependencies);
  let installedApplicationsPromise: Promise<InstalledOpenInApplication[]> | null = null;

  async function installedApplications(): Promise<InstalledOpenInApplication[]> {
    installedApplicationsPromise ??= discoverInstalledApplications(resolved);
    return installedApplicationsPromise;
  }

  return {
    async list() {
      const applications = await installedApplications();
      return {
        defaultApplication: defaultOpenInApplication(applications.map((application) => application.id)),
        applications: applications.map(({ applicationPath: _applicationPath, ...application }) => application),
      };
    },
    async open(application, targetPath) {
      const installed = (await installedApplications()).find((candidate) => candidate.id === application);
      if (!installed) {
        throw new Error(`${openInApplicationLabel(application)} is not installed.`);
      }

      if (application === 'finder') {
        const target = await resolved.stat(targetPath);
        if (target.isDirectory()) {
          const error = await resolved.openPath(targetPath);
          if (error) throw new Error(error);
        } else {
          resolved.showItemInFolder(targetPath);
        }
        return;
      }

      const target = terminalApplications.has(application) && !(await resolved.stat(targetPath)).isDirectory()
        ? path.dirname(targetPath)
        : targetPath;
      await resolved.execFile('/usr/bin/open', ['-a', installed.applicationPath, target]);
    },
  };
}

export function defaultOpenInApplication(applications: readonly OpenInApplication[]): OpenInApplication {
  if (applications.includes('vscode')) return 'vscode';
  if (applications.includes('jetbrains')) return 'jetbrains';
  return 'finder';
}

export async function resolveProjectPath(agentFolder: string, filePath?: string): Promise<string> {
  const canonicalFolder = await realpath(path.resolve(agentFolder));
  if (!filePath) return canonicalFolder;

  const candidate = path.resolve(canonicalFolder, filePath);
  const canonicalCandidate = await realpath(candidate);
  const relative = path.relative(canonicalFolder, canonicalCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Open In is only available for files inside the agent folder.');
  }
  return canonicalCandidate;
}

async function discoverInstalledApplications(dependencies: OpenInDependencies): Promise<InstalledOpenInApplication[]> {
  const applications: InstalledOpenInApplication[] = [];
  for (const specification of fixedApplications) {
    const applicationPath = await firstExistingApplicationPath(specification.relativePaths, dependencies);
    if (applicationPath) {
      applications.push(await installedApplication(specification.id, specification.label, applicationPath, dependencies));
    }
  }

  const jetBrainsPath = await firstJetBrainsApplicationPath(dependencies);
  if (jetBrainsPath) {
    applications.push(await installedApplication(
      'jetbrains',
      path.basename(jetBrainsPath, '.app'),
      jetBrainsPath,
      dependencies,
    ));
  }

  return applications;
}

async function firstExistingApplicationPath(relativePaths: string[], dependencies: OpenInDependencies): Promise<string | null> {
  for (const relativePath of relativePaths) {
    const candidates = path.isAbsolute(relativePath)
      ? [relativePath]
      : dependencies.applicationDirectories.map((directory) => path.join(directory, relativePath));
    for (const candidate of candidates) {
      if (await dependencies.fileExists(candidate)) return candidate;
    }
  }
  return null;
}

async function firstJetBrainsApplicationPath(dependencies: OpenInDependencies): Promise<string | null> {
  for (const directory of dependencies.applicationDirectories) {
    const entries = await dependencies.listDirectory(directory);
    const application = entries.filter((entry) => jetBrainsApplicationPattern.test(entry)).sort()[0];
    if (application) return path.join(directory, application);
  }
  return null;
}

async function installedApplication(
  id: OpenInApplication,
  label: string,
  applicationPath: string,
  dependencies: OpenInDependencies,
): Promise<InstalledOpenInApplication> {
  const icon = await dependencies.fileIcon(applicationPath).catch(() => null);
  const iconDataUrl = icon && !icon.isEmpty()
    ? cropOpenInApplicationIcon(icon).toDataURL()
    : null;
  return {
    id,
    label,
    ...(iconDataUrl ? { iconDataUrl } : {}),
    applicationPath,
  };
}

export function cropOpenInApplicationIcon(icon: NativeImage): NativeImage {
  const { width, height } = icon.getSize();
  const sourceSize = Math.min(width, height);
  const inset = Math.round(sourceSize * 0.075);
  const cropSize = sourceSize - inset * 2;
  if (cropSize <= 0) return icon;
  return icon.crop({
    x: Math.floor((width - cropSize) / 2),
    y: Math.floor((height - cropSize) / 2),
    width: cropSize,
    height: cropSize,
  });
}

function openInApplicationLabel(application: OpenInApplication): string {
  return fixedApplications.find((candidate) => candidate.id === application)?.label ?? 'JetBrains';
}

function defaultDependencies(overrides: Partial<OpenInDependencies>): OpenInDependencies {
  const execFileAsync = promisify(execFile);
  return {
    applicationDirectories: ['/Applications', path.join(os.homedir(), 'Applications')],
    execFile: (command, args) => execFileAsync(command, args),
    fileExists: async (filePath) => {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    fileIcon: (filePath) => nativeImage.createThumbnailFromPath(filePath, { width: 128, height: 128 }),
    listDirectory: async (directoryPath) => {
      try {
        return await readdir(directoryPath);
      } catch {
        return [];
      }
    },
    openPath: (filePath) => shell.openPath(filePath),
    showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
    stat,
    ...overrides,
  };
}
