import { product } from '@workspace/core/product';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { AppSnapshot } from '@workspace/core/contracts';
import type { DelegatedTask } from '@workspace/core/delegated-task';
import { AppStateStore } from './persistence/store';
import { logMain } from './log';

const APP_HOME_ENV = 'APP_HOME';
let store: AppStateStore | null = null;
let storeHome: string | null = null;

export function backendHomeDir(): string {
  const configured = process.env[APP_HOME_ENV]?.trim();
  return configured || path.join(homedir(), product.homeDirectory);
}

/** The file the app used before roster.json and settings.json; migrated and retired on first start. */
export function backendLegacyStateFilePath(): string {
  return path.join(backendHomeDir(), 'state.json');
}

export function backendSettingsFilePath(): string {
  return path.join(backendHomeDir(), 'settings.json');
}

export function backendProviderTokensFilePath(): string {
  return path.join(backendHomeDir(), 'provider-tokens.json');
}

function backendMissionHomeDir(missionId: string): string {
  if (!/^mission-[a-zA-Z0-9-]+$/.test(missionId)) throw new Error('Invalid mission ID.');
  return path.join(backendHomeDir(), 'missions', missionId);
}

export async function ensureBackendMissionHome(missionId: string): Promise<string> {
  const home = backendMissionHomeDir(missionId);
  await mkdir(path.join(home, 'artifacts'), { recursive: true, mode: 0o700 });
  return home;
}

export async function deleteBackendMissionHome(missionId: string): Promise<void> {
  await rm(backendMissionHomeDir(missionId), { recursive: true, force: true });
}

/** App-owned default Codex home; provider setup may select an existing home instead. */
export function backendCodexHomeDir(): string {
  return path.join(backendHomeDir(), 'codex-home');
}

export async function ensureBackendCodexHome(): Promise<string> {
  const home = backendCodexHomeDir();
  await mkdir(home, { recursive: true, mode: 0o700 });
  return home;
}

export function backendSocketPath(): string {
  return path.join(backendHomeDir(), 'daemon.sock');
}

export async function loadBackendSnapshot(): Promise<AppSnapshot> {
  await mkdir(backendHomeDir(), { recursive: true, mode: 0o700 });
  return backendStateStore().load();
}

export async function saveBackendSnapshot(snapshot: AppSnapshot): Promise<void> {
  await mkdir(backendHomeDir(), { recursive: true, mode: 0o700 });
  await backendStateStore().save(snapshot);
}

export async function backupProviderSetup(snapshot: AppSnapshot): Promise<void> {
  await backendStateStore().backupProviderSetup(snapshot);
}

function backendStateStore(): AppStateStore {
  const home = backendHomeDir();
  if (!store || storeHome !== home) {
    store = new AppStateStore(home, { log: (message) => logMain('state', message) });
    storeHome = home;
  }
  return store;
}

export const loadBackendTasks = (): Promise<DelegatedTask[]> => backendStateStore().loadTasks();
export const saveBackendTasks = (tasks: DelegatedTask[]): Promise<void> => backendStateStore().saveTasks(tasks);
