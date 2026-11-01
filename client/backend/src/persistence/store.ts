import { createHash } from 'node:crypto';
import type { DelegatedTask } from '@workspace/core/delegated-task';
import { tasksSchema } from './task-schema';
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSnapshot } from '@workspace/core/contracts';
import { projectClientSnapshot } from '@workspace/core/client-preferences';
import { createEmptySnapshot } from '@workspace/core/snapshot-construction';
import { persistedStateFromSnapshot, snapshotFromPersistedState } from '../state-persistence';
import { backupFile } from './backup';
import { isSupportedRosterAgent, joinPersistedState, preserveUnsupportedAgents, splitPersistedState, type RosterData, type StoreFiles, type VisualizationData } from './layout';
import { migrateData, rosterMigrations, type Migration } from './migrations';
import { parseData, rosterSchema, settingsSchema, visualizationSchema } from './schema';
import { StoreFormatError, parseStoreFile, serializeStoreFile, storeSchemaVersion, rosterSchemaVersion } from './store-format';

const rosterFile = 'roster.json';
const settingsFile = 'settings.json';
const visualizationsDirectory = 'visualizations';
const backupsDirectory = 'backups';
const legacyFile = 'state.json';

/** Left in place of the legacy file: it is not JSON, so builds that predate the store refuse to start. */
const retiredMarker = '# agent-workspace: this file was replaced by roster.json, settings.json and visualizations/.\n# It is not JSON on purpose, so an older build fails to start instead of creating an empty state.\n';

const fileMigrations = {
  roster: rosterMigrations,
  settings: [] as readonly Migration[],
  visualization: [] as readonly Migration[],
};

export type AppStateStoreOptions = {
  log?: (message: string) => void;
};

export class AppStateStore {
  private taskWrites: Promise<void> = Promise.resolve();

  async loadTasks(): Promise<DelegatedTask[]> {
    const content = await readIfExists(this.absolute('tasks.json'));
    if (content === null) return [];
    const envelope = parseStoreFile('tasks.json', content);
    return parseData('tasks.json', tasksSchema, migrateData('tasks.json', envelope.data, envelope.schemaVersion, storeSchemaVersion, [])).tasks;
  }

  saveTasks(tasks: DelegatedTask[]): Promise<void> {
    // Capture and validate now; tasks have a separate lifetime from roster snapshots.
    const content = serializeStoreFile(parseData('tasks.json', tasksSchema, { tasks }));
    const operation = this.taskWrites.then(() => writeFileAtomically(this.absolute('tasks.json'), content));
    this.taskWrites = operation.catch(() => undefined);
    return operation;
  }
  private pending: Map<string, string> | null = null;
  private waiters: Array<{ resolve(): void; reject(error: unknown): void }> = [];
  private writeInFlight = false;
  /** Relative path to the content last known to be on disk. */
  private written = new Map<string, string>();
  private unsupportedRoster: RosterData | null = null;

  constructor(private readonly home: string, private readonly options: AppStateStoreOptions = {}) {}

  async load(): Promise<AppSnapshot> {
    const legacy = await readIfExists(this.absolute(legacyFile));
    if (legacy !== null && !legacy.startsWith('#')) return this.migrateLegacy(legacy);
    const roster = await readIfExists(this.absolute(rosterFile));
    if (roster === null) {
      if (legacy !== null) throw new StoreFormatError(`${legacyFile} was retired but ${rosterFile} is missing. Restore ${rosterFile} or a state backup from the ${backupsDirectory} folder.`);
      if (await readIfExists(this.absolute(settingsFile)) !== null) throw new StoreFormatError(`${settingsFile} exists without ${rosterFile}. Restore ${rosterFile} from the ${backupsDirectory} folder.`);
      return createEmptySnapshot();
    }
    return this.readLayout(roster);
  }

  save(snapshot: AppSnapshot): Promise<void> {
    const desired = this.serialize(snapshot);
    if (!this.writeInFlight && this.pending === null && sameFiles(desired, this.written)) return Promise.resolve();
    this.pending = desired;
    const operation = new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
    void this.flush();
    return operation;
  }

  /** Verified recovery copies before an explicit destructive provider reset. */
  async backupProviderSetup(snapshot: AppSnapshot): Promise<void> {
    await this.save(snapshot);
    for (const name of [rosterFile, settingsFile]) {
      await backupFile(this.absolute(name), this.absolute(backupsDirectory), `provider-setup-${name.slice(0, -5)}`);
    }
  }

  private async migrateLegacy(text: string): Promise<AppSnapshot> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new StoreFormatError(`${legacyFile} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Restore it from a backup before starting.`);
    }
    const snapshot = snapshotFromPersistedState(parsed);
    // Nothing else is touched unless a verified copy of the original exists.
    const backup = await backupFile(this.absolute(legacyFile), this.absolute(backupsDirectory), 'state-v0');
    await this.archiveExistingLayout();
    this.written = new Map();
    await this.apply(this.serialize(snapshot));
    const migrated = await this.readLayout(await readFile(this.absolute(rosterFile), 'utf8'));
    await writeFileAtomically(this.absolute(legacyFile), retiredMarker);
    this.options.log?.(`Migrated ${legacyFile} to ${rosterFile}, ${settingsFile} and ${visualizationsDirectory}/. Backup: ${backup}`);
    return migrated;
  }

  /** A restored legacy file replaces the layout, so keep whatever was there. */
  private async archiveExistingLayout(): Promise<void> {
    const existing: string[] = [];
    for (const name of [rosterFile, settingsFile, visualizationsDirectory]) {
      if (await stat(this.absolute(name)).then(() => true, ignoreMissing(false))) existing.push(name);
    }
    if (existing.length === 0) return;
    const directory = this.absolute(backupsDirectory, `layout-before-migration-${new Date().toISOString().replace(/:/g, '-')}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of existing) await rename(this.absolute(name), path.join(directory, name));
  }

  private async readLayout(rosterText: string): Promise<AppSnapshot> {
    const rosterEnvelope = parseStoreFile(rosterFile, rosterText, rosterSchemaVersion);
    const settingsText = await readIfExists(this.absolute(settingsFile));
    if (settingsText === null) throw new StoreFormatError(`${settingsFile} is missing. Restore it from the ${backupsDirectory} folder.`);
    const settingsEnvelope = parseStoreFile(settingsFile, settingsText);
    const files: StoreFiles = {
      roster: parseData(rosterFile, rosterSchema, migrateData(rosterFile, rosterEnvelope.data, rosterEnvelope.schemaVersion, rosterSchemaVersion, fileMigrations.roster)),
      settings: parseData(settingsFile, settingsSchema, migrateData(settingsFile, settingsEnvelope.data, settingsEnvelope.schemaVersion, storeSchemaVersion, fileMigrations.settings)),
      visualizations: [],
    };
    const unsupported = files.roster.agents.filter(agent => !isSupportedRosterAgent(agent));
    this.unsupportedRoster = unsupported.length ? files.roster : null;
    for (const agent of unsupported) {
      this.options.log?.(`Skipping agent ${agent.id}: unsupported provider ${agent.engine.kind}; its stored data will be preserved.`);
    }
    // Establish downgrade protection on load, before any ordinary snapshot save.
    // Keep the original bytes in a verified backup before changing the envelope.
    if (rosterEnvelope.schemaVersion < rosterSchemaVersion) {
      await backupFile(this.absolute(rosterFile), this.absolute(backupsDirectory), `roster-v${rosterEnvelope.schemaVersion}`);
      rosterText = serializeStoreFile(files.roster, rosterSchemaVersion);
      await writeFileAtomically(this.absolute(rosterFile), rosterText);
    }
    const written = new Map([[rosterFile, rosterText], [settingsFile, settingsText]]);
    for (const { relative, text } of await this.readVisualizationFiles()) {
      try {
        const envelope = parseStoreFile(relative, text);
        files.visualizations.push(parseData(relative, visualizationSchema, migrateData(relative, envelope.data, envelope.schemaVersion, storeSchemaVersion, fileMigrations.visualization)));
        written.set(relative, text);
      } catch (error) {
        // An unreadable visualization is user content: skip it, never delete it.
        this.options.log?.(`Skipping ${relative}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.written = written;
    return snapshotFromPersistedState(joinPersistedState(files));
  }

  private async readVisualizationFiles(): Promise<Array<{ relative: string; text: string }>> {
    const root = this.absolute(visualizationsDirectory);
    const directories = await readdir(root, { withFileTypes: true }).catch(ignoreMissing([]));
    const found: Array<{ relative: string; text: string }> = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const entries = await readdir(path.join(root, directory.name), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const relative = `${visualizationsDirectory}/${directory.name}/${entry.name}`;
        found.push({ relative, text: await readFile(this.absolute(relative), 'utf8') });
      }
    }
    return found;
  }

  private serialize(snapshot: AppSnapshot): Map<string, string> {
    // One shared view: the desktop profile is the effective selection, order and preferences.
    const { roster, settings, visualizations } = splitPersistedState(persistedStateFromSnapshot(projectClientSnapshot(snapshot, 'desktop')));
    const files = new Map<string, string>();
    for (const visualization of visualizations) files.set(visualizationPath(visualization), serializeStoreFile(visualization));
    files.set(settingsFile, serializeStoreFile(settings));
    files.set(rosterFile, serializeStoreFile(this.unsupportedRoster ? preserveUnsupportedAgents(roster, this.unsupportedRoster) : roster, rosterSchemaVersion));
    return files;
  }

  private async flush(): Promise<void> {
    if (this.writeInFlight) return;
    this.writeInFlight = true;
    try {
      while (this.pending !== null) {
        const desired = this.pending;
        this.pending = null;
        const waiters = this.waiters.splice(0);
        try {
          await this.apply(desired);
          for (const waiter of waiters) waiter.resolve();
        } catch (error) {
          for (const waiter of waiters) waiter.reject(error);
        }
      }
    } finally {
      this.writeInFlight = false;
      if (this.pending !== null) void this.flush();
    }
  }

  /** Writes what changed, then removes visualization files that no longer exist. */
  private async apply(desired: Map<string, string>): Promise<void> {
    for (const [relative, content] of desired) {
      if (this.written.get(relative) === content) continue;
      await writeFileAtomically(this.absolute(...relative.split('/')), content);
      this.written.set(relative, content);
    }
    for (const relative of [...this.written.keys()]) {
      if (desired.has(relative) || !relative.startsWith(`${visualizationsDirectory}/`)) continue;
      await unlink(this.absolute(...relative.split('/'))).catch(ignoreMissing(undefined));
      this.written.delete(relative);
      await rmdir(path.dirname(this.absolute(...relative.split('/')))).catch(() => undefined);
    }
  }

  private absolute(...segments: string[]): string {
    return path.join(this.home, ...segments);
  }
}

function visualizationPath(data: VisualizationData): string {
  const repository = data.repository;
  const slug = (repository.split('/').filter(Boolean).pop() ?? 'repository').replace(/[^a-zA-Z0-9._-]/g, '-');
  const hash = createHash('sha1').update(repository).digest('hex').slice(0, 8);
  const id = data.visualization.id;
  const safeId = /^[a-zA-Z0-9._-]+$/.test(id) ? id : `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}-${createHash('sha1').update(id).digest('hex').slice(0, 8)}`;
  return `${visualizationsDirectory}/${slug}-${hash}/${safeId}.json`;
}

function sameFiles(left: Map<string, string>, right: Map<string, string>): boolean {
  return left.size === right.size && [...left].every(([key, value]) => right.get(key) === value);
}

async function writeFileAtomically(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(ignoreMissing(undefined));
  }
}

async function readIfExists(file: string): Promise<string | null> {
  return readFile(file, 'utf8').catch(ignoreMissing(null));
}

function ignoreMissing<T>(fallback: T): (error: unknown) => T {
  return (error) => {
    if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  };
}
