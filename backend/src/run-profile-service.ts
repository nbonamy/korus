import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { withDiscoveredRuntimePath } from '@workspace/core/runtime-discovery';
import type { ProfileRun, RunProfileCatalog, RunProfileInput, RunProfileStartInput } from '@workspace/core/run-profiles';
import { AgentGitService } from './git/agent-git-service';
import { parseStoreFile, serializeStoreFile } from './persistence/store-format';
import { discoverRunProfileActions } from './run-profile-actions';

const text = z.string().trim().min(1).max(4096).refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Use a single-line command without control characters.');
const inputSchema = z.strictObject({ id: z.string().uuid().optional(), name: text.max(100), command: text, directory: text.default('.'), previewUrl: text.optional() });
const storeSchema = z.strictObject({ repositories: z.record(z.string(), z.array(inputSchema.extend({ id: z.string().uuid() })).max(100)) });
type Store = z.infer<typeof storeSchema>;
type OwnedRun = { run: ProfileRun; child: ChildProcess; done: Promise<void>; stop?: Promise<void>; stopRequested?: boolean; secrets: string[]; pendingOutput: string; root: string };
const MAX_OUTPUT = 65536;
const exec = promisify(execFile);

/** One host owns admission, volatile output, process groups and shutdown. No provider runtime or scheduler. */
export class RunProfileService {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly runs = new Map<string, OwnedRun>();
  private closed = false;
  private readonly releasedAgents = new Set<string>();
  constructor(private readonly filename: string, private readonly git = new AgentGitService(), private readonly ownerAvailable: (agentId: string, folder: string) => boolean = () => true) {}

  private transaction<T>(action: (store: Store) => Promise<T> | T): Promise<T> {
    const next = this.pending.catch(() => undefined).then(async () => {
      let store: Store;
      try { store = storeSchema.parse(parseStoreFile(this.filename, await readFile(this.filename, 'utf8')).data); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Run profiles could not be read. Restore the private run-profiles.json file or remove its invalid entry.', { cause: error }); store = { repositories: {} }; }
      const before = JSON.stringify(store);
      const result = await action(store);
      if (JSON.stringify(store) !== before) {
        await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
        const temporary = `${this.filename}.${randomUUID()}.tmp`;
        try { await writeFile(temporary, serializeStoreFile(store), { mode: 0o600, flag: 'wx' }); await rename(temporary, this.filename); }
        finally { await rm(temporary, { force: true }); }
      }
      return structuredClone(result);
    });
    this.pending = next;
    return next;
  }

  private async target(folder: string) {
    const identity = await this.git.identity(folder);
    const worktree = await realpath(identity.kind === 'git' ? identity.repositoryRoot : folder);
    const repository = await realpath(identity.kind === 'git' ? identity.primaryWorktreeRoot : folder);
    return { repository, worktree };
  }

  async get(agentId: string, folder: string): Promise<RunProfileCatalog> {
    const target = await this.target(folder);
    return this.transaction(async store => ({ ...target, targets: Object.fromEntries(await Promise.all((store.repositories[target.repository] ?? []).map(async profile => {
      try { return [profile.id, { cwd: await this.directory(target.worktree, profile.directory) }]; }
      catch (error) { return [profile.id, { error: (error as Error).message }]; }
    }))), profiles: store.repositories[target.repository] ?? [], runs: [...this.runs.values()].filter(owned => owned.run.agentId === agentId && owned.root === target.worktree).map(owned => this.snapshot(owned)) }));
  }

  async discover(folder: string, directory: string) {
    if (!text.safeParse(directory).success) throw new Error('Enter a repository-relative working directory.');
    const target = await this.target(folder);
    const result = await discoverRunProfileActions(target.worktree, await this.directory(target.worktree, directory));
    result.actions = result.actions.filter(action => {
      try { this.rejectSecrets(action.name); this.validateCommand(action.command); return true; }
      catch { return false; }
    });
    return result;
  }

  async save(agentId: string, folder: string, input: RunProfileInput): Promise<RunProfileCatalog> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new Error('Enter a name, single-line command, relative directory, and optional loopback preview URL. Environment configuration is not supported.');
    const profile = { ...parsed.data, id: parsed.data.id ?? randomUUID() };
    this.rejectSecrets(profile.name);
    this.rejectSecrets(profile.directory);
    this.validateCommand(profile.command);
    if (profile.previewUrl) {
      let url: URL;
      try { url = new URL(profile.previewUrl); } catch { throw new Error('Preview URL must be an HTTP or HTTPS loopback URL.'); }
      if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('Preview URL must be an HTTP or HTTPS loopback URL without credentials.');
      this.rejectSecrets(profile.previewUrl);
    }
    const target = await this.target(folder);
    await this.directory(target.worktree, profile.directory);
    await this.transaction(store => {
      const profiles = store.repositories[target.repository] ??= [];
      const index = profiles.findIndex(candidate => candidate.id === profile.id);
      if (parsed.data.id && index < 0) throw new Error('Run profile not found. Refresh the list.');
      if (index < 0) { if (profiles.length >= 100) throw new Error('Remove a profile before adding another.'); profiles.push(profile); } else profiles[index] = profile;
    });
    return this.get(agentId, folder);
  }

  async delete(agentId: string, folder: string, profileId: string): Promise<RunProfileCatalog> {
    const { repository } = await this.target(folder);
    await this.transaction(store => { store.repositories[repository] = (store.repositories[repository] ?? []).filter(profile => profile.id !== profileId); });
    return this.get(agentId, folder);
  }

  async start(agentId: string, folder: string, input: RunProfileStartInput): Promise<ProfileRun> {
    // Serialize admission with catalog mutations and other starts, including path revalidation.
    const target = await this.target(folder);
    return this.transaction(async store => {
      if (this.closed) throw new Error('Run profile service is closed. Reconnect to the owning host.');
      if (this.releasedAgents.has(agentId) || !this.ownerAvailable(agentId, folder)) throw new Error('This agent has been removed. Select an open agent.');
      const profile = store.repositories[target.repository]?.find(profile => profile.id === input.profileId);
      if (!profile) throw new Error('Run profile not found. Refresh the list.');
      this.validateCommand(profile.command);
      const cwd = await this.directory(target.worktree, profile.directory);
      if (profile.command !== input.command || cwd !== input.cwd) throw new Error('Command or target changed. Review the updated command and directory before running.');
      if ([...this.runs.values()].some(owned => owned.root === target.worktree && owned.run.profileId === profile.id && owned.run.state === 'running')) throw new Error('This profile is already running in this worktree. Open its owner’s output or stop it first.');
      const env = withDiscoveredRuntimePath(undefined);
      const secrets = secretValues(env);
      const child = spawn(profile.command, { cwd, env, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      const run: ProfileRun = { id: randomUUID(), agentId, profileId: profile.id, command: profile.command, cwd, state: 'running', startedAt: new Date().toISOString(), output: '', outputTruncated: false };
      let finish!: () => void;
      const owned: OwnedRun = { run, child, secrets, pendingOutput: '', root: target.worktree, done: new Promise(resolve => { finish = resolve; }) };
      this.runs.set(run.id, owned);
      // Retain a bounded history; never evict a live process owner.
      const finished = [...this.runs.values()].filter(item => item.run.state !== 'running');
      for (const item of finished.slice(0, Math.max(0, this.runs.size - 100))) this.runs.delete(item.run.id);
      const output = (chunk: string) => { owned.pendingOutput += chunk; this.flushOutput(owned, false); };
      child.stdout?.setEncoding('utf8').on('data', output);
      child.stderr?.setEncoding('utf8').on('data', output);
      child.once('error', () => { run.error = 'Could not start the command. Check the working directory and shell installation on this host.'; });
      child.once('close', (code) => {
        this.flushOutput(owned, true);
        if (run.state === 'running') run.state = owned.stopRequested ? 'stopped' : !run.error && code === 0 ? 'completed' : 'failed';
        if (code !== null) run.exitCode = code;
        if (run.state === 'failed' && !run.error) run.error = `Command exited${code === null ? ' after a signal' : ` with code ${code}`}. Check output and the command on this host.`;
        run.finishedAt = new Date().toISOString();
        // A shell can finish with background descendants; the group remains ours.
        if (process.platform !== 'win32') this.signal(owned, 'SIGKILL');
        finish();
      });
      await new Promise<void>(resolve => { child.once('spawn', resolve); child.once('error', () => resolve()); });
      return this.snapshot(owned);
    });
  }

  async stop(agentId: string, runId: string): Promise<ProfileRun> {
    const owned = this.runs.get(runId);
    if (!owned || owned.run.agentId !== agentId) throw new Error('Profile run not found for this agent.');
    if (owned.run.state === 'running') {
      owned.stop ??= this.stopOwned(owned);
      try { await owned.stop; }
      catch (error) { owned.stop = undefined; owned.stopRequested = false; throw error; }
    }
    return this.snapshot(owned);
  }

  async stopAgent(agentId: string): Promise<void> {
    // Await an in-flight admission before releasing this owner.
    await this.pending.catch(() => undefined);
    await Promise.all([...this.runs.values()].filter(owned => owned.run.agentId === agentId).map(owned => this.stop(agentId, owned.run.id)));
  }

  get hasRuns(): boolean { return this.runs.size > 0; }

  async retainAgents(agentIds: Set<string>): Promise<void> {
    await this.pending.catch(() => undefined);
    await Promise.all([...new Set([...this.runs.values()].map(owned => owned.run.agentId))].filter(id => !agentIds.has(id)).map(id => this.releaseAgent(id)));
  }

  async releaseAgent(agentId: string): Promise<void> {
    this.releasedAgents.add(agentId);
    await this.stopAgent(agentId);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pending.catch(() => undefined);
    await Promise.all([...this.runs.values()].map(owned => this.stop(owned.run.agentId, owned.run.id)));
  }

  private async stopOwned(owned: OwnedRun): Promise<void> {
    // Keep admission closed until the process and its inherited streams have closed.
    owned.stopRequested = true;
    if (process.platform === 'win32') {
      if (owned.child.pid) await exec('taskkill', ['/pid', String(owned.child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(() => { if (owned.run.state === 'running') throw new Error('Could not stop the owned process tree. Retry Stop on its owning host.'); });
      await owned.done;
      return;
    }
    this.signal(owned, 'SIGTERM');
    const kill = setTimeout(() => this.signal(owned, 'SIGKILL'), 1500);
    try { await owned.done; } finally { clearTimeout(kill); this.signal(owned, 'SIGKILL'); }
  }

  private signal(owned: OwnedRun, signal: NodeJS.Signals) {
    if (!owned.child.pid) return;
    try { process.kill(-owned.child.pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }

  private flushOutput(owned: OwnedRun, final: boolean) {
    const raw = owned.pendingOutput;
    let end = raw.length;
    if (!final) for (const value of owned.secrets) {
      for (let length = Math.min(value.length - 1, raw.length); length > 0; length--) {
        if (raw.endsWith(value.slice(0, length))) { end = Math.min(end, raw.length - length); break; }
      }
    }
    for (const value of owned.secrets) {
      let index = raw.indexOf(value);
      while (index >= 0 && index < end) {
        if (index + value.length > end) end = index;
        index = raw.indexOf(value, index + value.length);
      }
    }
    let safe = raw.slice(0, end);
    for (const value of owned.secrets) safe = safe.split(value).join('[redacted]');
    owned.pendingOutput = raw.slice(end);
    owned.run.output += safe;
    if (owned.run.output.length > MAX_OUTPUT) { owned.run.output = owned.run.output.slice(-MAX_OUTPUT); owned.run.outputTruncated = true; }
  }

  private snapshot(owned: OwnedRun): ProfileRun {
    return { ...owned.run };
  }

  private validateCommand(command: string) {
    if (!text.safeParse(command).success) throw new Error('Use a nonempty single-line command without control characters.');
    if (/(?:^|[\s;|&])(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(command)) throw new Error('Keep environment values out of profiles. Configure them privately on the owning host.');
    this.rejectSecrets(command);
  }

  private rejectSecrets(value: string) {
    if (secretValues(process.env).some(secret => value.includes(secret))) throw new Error('Keep secret environment values out of profiles.');
  }

  private async directory(root: string, directory: string): Promise<string> {
    if (path.isAbsolute(directory) || /^[A-Za-z]:|\\/.test(directory)) throw new Error('Working directory must be repository-relative.');
    const candidate = path.resolve(root, directory);
    if (!inside(root, candidate)) throw new Error('Working directory must stay inside the selected worktree.');
    let resolved: string;
    try { resolved = await realpath(candidate); if (!(await stat(resolved)).isDirectory()) throw new Error(); }
    catch { throw new Error('Working directory does not exist. Create it in the selected worktree or edit the profile.'); }
    if (!inside(root, resolved)) throw new Error('Working directory must stay inside the selected worktree, including symlinks.');
    return resolved;
  }
}

function inside(root: string, candidate: string) { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function secretValues(env: NodeJS.ProcessEnv) { return Object.entries(env).flatMap(([name, value]) => /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY/i.test(name) && value && value.length >= 4 ? [value] : []).sort((a, b) => b.length - a.length); }
