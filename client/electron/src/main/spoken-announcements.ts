import type {
  SpokenAnnouncementQueueResult,
  SpokenAnnouncementRequest,
} from '@workspace/core/contracts';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { warnMain } from './log';

export type SpokenAnnouncementPlayback = {
  cancel: () => void;
};

export type SpokenAnnouncementEngine = {
  readonly available: boolean;
  speak: (
    request: SpokenAnnouncementRequest,
    settled: () => void,
  ) => SpokenAnnouncementPlayback;
};

type QueueOptions = {
  now?: () => number;
  rateLimitMs?: number;
};

export type SpokenAnnouncementPolicyState = {
  activeAgentId: string | null;
  enabled: boolean;
  focused: boolean;
  muted: boolean;
  onlyWhenFocused: boolean;
  scope: 'selected' | 'all';
};

type SpokenAnnouncementQueuePort = Pick<SpokenAnnouncementQueue, 'dispose' | 'queue'>;

type QueueItem = SpokenAnnouncementRequest & {
  id: number;
  complete?: () => void;
};

export class SpokenAnnouncementQueue {
  private active: (QueueItem & { playback: SpokenAnnouncementPlayback | null }) | null = null;
  private pending: QueueItem | null = null;
  private readonly recent = new Map<string, number>();
  private nextId = 1;
  private readonly now: () => number;
  private readonly rateLimitMs: number;

  constructor(
    private readonly engine: SpokenAnnouncementEngine,
    options: QueueOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.rateLimitMs = options.rateLimitMs ?? 2_000;
  }

  queue(request: SpokenAnnouncementRequest): SpokenAnnouncementQueueResult {
    return this.enqueue(request);
  }

  queueWithCompletion(request: SpokenAnnouncementRequest): {
    completion: Promise<void>;
    result: SpokenAnnouncementQueueResult;
  } {
    let complete: () => void = () => {};
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const result = this.enqueue(request, complete);
    if (!result.queued) complete();
    return { completion, result };
  }

  private enqueue(
    request: SpokenAnnouncementRequest,
    complete?: () => void,
  ): SpokenAnnouncementQueueResult {
    if (!this.engine.available) return { queued: false, reason: 'unsupported' };

    const key = `${request.agentId}:${request.phase}`;
    const now = this.now();
    const lastQueuedAt = this.recent.get(key);
    if (lastQueuedAt !== undefined && now - lastQueuedAt < this.rateLimitMs) {
      return { queued: false, reason: 'rateLimited' };
    }

    const item = { ...request, complete, id: this.nextId++ };
    if (!this.active) {
      this.markRecent(key, now);
      this.start(item);
      return { queued: true };
    }

    if (this.pending?.phase === 'finish' && item.phase === 'start') {
      return { queued: false, reason: 'superseded' };
    }

    this.complete(this.pending);
    this.pending = item;
    this.markRecent(key, now);
    if (this.active.agentId === item.agentId
      && this.active.phase === 'start'
      && item.phase === 'finish') {
      this.active.playback?.cancel();
    }
    return { queued: true };
  }

  dispose(): void {
    const active = this.active;
    const pending = this.pending;
    this.pending = null;
    this.active = null;
    active?.playback?.cancel();
    this.complete(active);
    this.complete(pending);
  }

  private start(item: QueueItem): void {
    this.active = { ...item, playback: null };
    try {
      const playback = this.engine.speak(item, () => this.settle(item.id));
      if (this.active?.id === item.id) this.active.playback = playback;
    } catch {
      this.settle(item.id);
    }
  }

  private settle(id: number): void {
    if (this.active?.id !== id) return;
    const completed = this.active;
    this.active = null;
    this.complete(completed);
    const next = this.pending;
    this.pending = null;
    if (next) this.start(next);
  }

  private complete(item: QueueItem | null): void {
    const callback = item?.complete;
    if (item) item.complete = undefined;
    callback?.();
  }

  private markRecent(key: string, now: number): void {
    this.recent.set(key, now);
    for (const [candidate, timestamp] of this.recent) {
      if (now - timestamp >= this.rateLimitMs) this.recent.delete(candidate);
    }
    while (this.recent.size > 64) {
      const oldest = this.recent.keys().next().value as string | undefined;
      this.recent.delete(oldest as string);
    }
  }
}

export class PolicyAwareSpokenAnnouncementQueue {
  private previousState: SpokenAnnouncementPolicyState;

  constructor(
    private readonly queuePort: SpokenAnnouncementQueuePort,
    private readonly getState: () => SpokenAnnouncementPolicyState,
  ) {
    this.previousState = { ...getState() };
  }

  queue(request: SpokenAnnouncementRequest): SpokenAnnouncementQueueResult {
    const state = { ...this.getState() };
    this.previousState = { ...state };
    if (!canPlaySpokenAnnouncement(request, state)) {
      return { queued: false, reason: 'suppressed' };
    }
    return this.queuePort.queue(request);
  }

  refresh(): void {
    const nextState = { ...this.getState() };
    if (shouldCancelSpokenAnnouncements(this.previousState, nextState)) {
      this.queuePort.dispose();
    }
    this.previousState = { ...nextState };
  }
}

export type NativeSpokenAnnouncementOptions = {
  appPath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
};

type SpawnHelper = (path: string) => ChildProcessWithoutNullStreams;
type NativeEngineDeps = {
  existsSync?: (path: string) => boolean;
  spawnHelper?: SpawnHelper;
};

const drainHelperOutput = () => undefined;

export class NativeSpokenAnnouncementEngine implements SpokenAnnouncementEngine {
  readonly available: boolean;
  private readonly helperPath: string;

  constructor(
    options: NativeSpokenAnnouncementOptions,
    deps: NativeEngineDeps = {},
  ) {
    this.helperPath = resolveSpokenAnnouncementHelperPath(options);
    this.spawnHelper = deps.spawnHelper ?? ((helperPath) => spawn(helperPath, [], { stdio: 'pipe' }));
    this.available = options.platform === 'darwin' && (deps.existsSync ?? fs.existsSync)(this.helperPath);
  }

  private readonly spawnHelper: SpawnHelper;

  speak(request: SpokenAnnouncementRequest, settled: () => void): SpokenAnnouncementPlayback {
    if (!this.available) throw new Error('The native TTS helper is unavailable.');
    const child = this.spawnHelper(this.helperPath);
    let didSettle = false;
    const finish = () => {
      if (didSettle) return;
      didSettle = true;
      settled();
    };
    child.once('error', (error) => {
      warnMain('tts', 'native helper failed', { detail: error.message });
      finish();
    });
    child.once('close', finish);
    child.stdout.on('data', drainHelperOutput);
    child.stderr.on('data', drainHelperOutput);
    child.stdin.end(JSON.stringify({
      version: 1,
      id: `${request.agentId}:${request.phase}`,
      text: spokenAnnouncementTextForSynthesis(request.text),
      voice: request.voice,
    }));
    return {
      cancel: () => {
        if (!child.killed) child.kill('SIGTERM');
      },
    };
  }
}

export function resolveSpokenAnnouncementHelperPath(options: NativeSpokenAnnouncementOptions): string {
  if (options.isPackaged) {
    return path.join(options.resourcesPath, 'app-tts-helper');
  }
  return path.join(options.appPath, '.tts', 'app-tts-helper');
}

export function createRuntimeSpokenAnnouncementQueue(options: NativeSpokenAnnouncementOptions): SpokenAnnouncementQueue {
  return new SpokenAnnouncementQueue(new NativeSpokenAnnouncementEngine(options));
}

export function spokenAnnouncementTextForSynthesis(text: string): string {
  return text.replace(/\bI(['’])ll\b/g, 'I will').replace(/\bi(['’])ll\b/g, 'i will');
}

function canPlaySpokenAnnouncement(
  request: SpokenAnnouncementRequest,
  state: SpokenAnnouncementPolicyState,
): boolean {
  return state.enabled
    && !state.muted
    && (!state.onlyWhenFocused || state.focused)
    && (state.scope === 'all' || state.activeAgentId === request.agentId);
}

function shouldCancelSpokenAnnouncements(
  previous: SpokenAnnouncementPolicyState,
  next: SpokenAnnouncementPolicyState,
): boolean {
  if (previous.enabled && !next.enabled) return true;
  if (!previous.muted && next.muted) return true;
  if (next.onlyWhenFocused && !next.focused && (previous.focused || !previous.onlyWhenFocused)) return true;
  if (previous.scope === 'all' && next.scope === 'selected') return true;
  return next.scope === 'selected' && previous.activeAgentId !== next.activeAgentId;
}
