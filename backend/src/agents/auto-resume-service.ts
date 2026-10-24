import type { Agent, AppSnapshot, AccountRateLimits, MainToRendererEvent } from '@workspace/core/contracts';
import { isRateLimitPause, type RateLimitPause } from '@workspace/core/auto-resume';
import { agentConversationId } from '@workspace/core/plan-review';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';
import { handoffInProgress } from '@workspace/core/agent-handoff';

type Options = {
  snapshot: AppSnapshot;
  isLocal: (agent: Agent) => boolean;
  connected: (agent: Agent) => boolean;
  update: (agentId: string, pause: RateLimitPause | null) => void;
  persist: () => Promise<unknown>;
  resume: (agent: Agent, conversationId: string) => Promise<void>;
  onError: (error: unknown) => void;
};
const RESET_GRACE_MS = 5_000;

/** Owns one-shot continuation policy; provider messages never own timers. */
export class AutoResumeService {
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private readonly pendingSends = new Map<string, symbol>();
  constructor(private readonly options: Options) {}

  observe(event: MainToRendererEvent): void {
    if (this.closed) return;
    const view = providerConversationEventView(event);
    const agent = this.options.snapshot.agents.find(agent => agent.id === view.agentId);
    if (agent && this.options.isLocal(agent)) {
      if (view.type === 'turn.started' || event.type === 'agent.statusChanged' && event.payload.type === 'working') this.cancel(agent.id);
      const payload = record(view.payload), error = record(payload.error);
      const message = event.type === 'agent.statusChanged' && event.payload.type === 'error' ? event.payload.message
        : ['error', 'turn.error', 'turn.completed'].includes(view.type) && payload.willRetry !== true ? payload.message ?? error.message : undefined;
      if (typeof message === 'string' && /(?:usage.?limit|session.?limit|rate.?limit|quota)/i.test(message)) {
        const now = Date.now(), resumeAt = resetTime(message, this.options.snapshot.backendAccountRateLimits?.[agent.backend], now, record(payload.rateLimit));
        const conversationId = agentConversationId(agent);
        if (resumeAt && conversationId && (!view.conversationId || view.conversationId === conversationId)) {
          this.options.update(agent.id, { backend: agent.backend, conversationId, ...(view.turnId ? { turnId: view.turnId } : {}), detectedAt: now, resumeAt,
            enabled: this.options.snapshot.general.autoResumeAfterLimit !== false });
        }
      }
      const status = payload.status ?? record(payload.turn).status;
      if (view.type === 'turn.completed' && ['completed', 'interrupted'].includes(String(status)) && agent.rateLimitPause?.turnId === view.turnId) this.cancel(agent.id);
    }
    this.sync();
  }
  setEnabled(enabled: boolean): void {
    this.options.snapshot.general.autoResumeAfterLimit = enabled;
    for (const agent of this.options.snapshot.agents) if (this.options.isLocal(agent) && agent.rateLimitPause) this.options.update(agent.id, { ...agent.rateLimitPause, enabled });
    this.sync();
  }
  cancel(agentId: string): void {
    this.pendingSends.delete(agentId);
    if (this.options.snapshot.agents.find(agent => agent.id === agentId)?.rateLimitPause) this.options.update(agentId, null);
  }
  sync(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.closed) return;
    let next = Infinity;
    for (const agent of this.options.snapshot.agents) {
      let pause = agent.rateLimitPause;
      if (!pause || !this.options.isLocal(agent)) continue;
      if (!isRateLimitPause(pause) || pause.backend !== agent.backend || pause.conversationId !== agentConversationId(agent)) {
        this.cancel(agent.id); continue;
      }
      const enabled = this.options.snapshot.general.autoResumeAfterLimit !== false;
      if (pause.enabled !== enabled) { pause = { ...pause, enabled }; this.options.update(agent.id, pause); }
      if (pause.enabled && this.available(agent)) next = Math.min(next, pause.resumeAt + RESET_GRACE_MS);
    }
    if (Number.isFinite(next)) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, Math.min(2_147_483_647, Math.max(0, next - Date.now())));
      this.timer.unref?.();
    }
  }
  close(): void { this.closed = true; if (this.timer) clearTimeout(this.timer); this.pendingSends.clear(); }
  private available(agent: Agent): boolean {
    return !handoffInProgress(agent) && !['working', 'awaitingInput'].includes(agent.status.type)
      && !this.options.snapshot.queuedPrompts?.some(prompt => prompt.agentId === agent.id) && this.options.connected(agent);
  }
  private async tick(): Promise<void> {
    for (const agent of this.options.snapshot.agents) {
      const pause = agent.rateLimitPause;
      if (this.closed || !pause?.enabled || !this.options.isLocal(agent) || pause.resumeAt + RESET_GRACE_MS > Date.now() || !this.available(agent)) continue;
      if (pause.backend !== agent.backend || pause.conversationId !== agentConversationId(agent)) { this.cancel(agent.id); continue; }
      const token = Symbol();
      this.options.update(agent.id, null);
      this.pendingSends.set(agent.id, token);
      try {
        // Consume durably before sending; reconnecting clients cannot schedule it twice.
        await this.options.persist();
        if (!this.closed && this.pendingSends.get(agent.id) === token && this.options.snapshot.general.autoResumeAfterLimit !== false
          && this.options.snapshot.agents.includes(agent) && pause.conversationId === agentConversationId(agent) && this.available(agent)) await this.options.resume(agent, pause.conversationId);
      } catch (error) { this.options.onError(error); }
      finally { if (this.pendingSends.get(agent.id) === token) this.pendingSends.delete(agent.id); }
    }
    this.sync();
  }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function resetTime(message: string, limits: AccountRateLimits | undefined, now: number, hint: Record<string, unknown>): number | undefined {
  const resets = [limits?.primary, limits?.secondary]
    .filter(window => window && window.usedPercent >= 100 && window.resetsAt && window.resetsAt * 1000 > now)
    .map(window => window!.resetsAt! * 1000);
  if (typeof hint.resumeAt === 'number' && Number.isFinite(hint.resumeAt)) resets.push(hint.resumeAt);
  if (resets.length) {
    const known = Math.max(...resets);
    return known > now && Number.isFinite(known) && known <= 8.64e15 ? known : undefined;
  }
  // Only a provider's explicit session-limit error may supply a clock-only fallback.
  const match = /you['’]ve hit your session limit[^\n]*?resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i.exec(message);
  if (!match) return undefined;
  const hour = Number(match[1]), minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  const targetHour = hour % 12 + (match[3]!.toLowerCase() === 'pm' ? 12 : 0);
  try {
    const format = new Intl.DateTimeFormat('en-GB', { timeZone: match[4]!, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    for (let time = Math.floor(now / 60_000) * 60_000 + 60_000; time <= now + 24 * 60 * 60 * 1000; time += 60_000) {
      const parts = format.formatToParts(time);
      if (Number(parts.find(part => part.type === 'hour')?.value) === targetHour && Number(parts.find(part => part.type === 'minute')?.value) === minute) return time;
    }
  } catch { /* Unknown timezone: keep continuation manual. */ }
  return undefined;
}
