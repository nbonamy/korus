import type { MobileAction, MobileAttachment, MobileRequest, MobileResult, MobileViewRequest, MobileViewResult } from '@workspace/core/mobile-simulator';
import { randomUUID } from 'node:crypto';
import { AVD_PREFIX, type DeviceScreen, type MobileAdapter } from './adapter';
import { MobileLiveView } from './live-view';

const LIVENESS_INTERVAL_MS = 2_000;

/** One desktop owner per device, shared by the pane and authenticated MCP caller. */
export class MobileSimulatorService {
  private readonly attachments = new Map<string, MobileAttachment>();
  private readonly views = new Map<string, MobileLiveView>();
  private readonly viewStarts = new Map<string, symbol>();
  private readonly checkedAt = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private pending = 0;
  private inputInFlight = false;
  private retainedAgentIds: Set<string> | null = null;

  constructor(
    private readonly adapter: MobileAdapter,
  ) {}

  /** `userInitiated` is the desktop user acting in the pane; some device controls (rotation) are not offered to agents. */
  execute(agentId: string, input: MobileRequest, userInitiated = false): Promise<MobileResult> {
    if (this.pending >= 8)
      return Promise.reject(new Error('Simulator is busy. Try again after the current operation.'));
    this.pending++;
    const generation = this.generation;
    const result = this.queue.then(async () => {
      if (generation !== this.generation) throw new Error('Simulator session ended. Attach again.');
      return this.run(agentId, input, generation, userInitiated);
    });
    this.queue = result.catch(() => undefined);
    return result.finally(() => {
      this.pending--;
    });
  }

  clear(): void {
    this.generation++;
    this.viewStarts.clear();
    for (const view of this.views.values()) view.close();
    this.views.clear();
    for (const attachment of this.attachments.values()) this.adapter.detach(attachment.device);
    this.attachments.clear();
  }
  retainAgents(agentIds: string[]): void {
    this.retainedAgentIds = new Set(agentIds);
    for (const id of this.attachments.keys())
      if (!agentIds.includes(id)) {
        this.closeView(id);
        this.adapter.detach(this.attachments.get(id)!.device);
        this.attachments.delete(id);
      }
  }

  /** Separate from the command queue: video must continue during an agent swipe or launch. */
  async view(agentId: string, input: MobileViewRequest): Promise<MobileViewResult> {
    const current = this.attachments.get(agentId);
    // Cleanup can arrive after detach or after a newer view has replaced this one.
    if (input?.action === 'stop') {
      if (current?.id === input.attachmentId && this.views.get(agentId)?.id === input.viewId)
        this.closeView(agentId);
      return { viewId: input.viewId, ended: true };
    }
    if (!input || !current || current.id !== input.attachmentId)
      throw new Error('No matching attachment. Attach again.');
    if (input.action === 'start') {
      this.closeView(agentId);
      if (!this.adapter.startView) throw new Error('Live video is unavailable on this host.');
      const token = Symbol();
      this.viewStarts.set(agentId, token);
      try {
        const screen = await this.adapter.screen(current.device);
        if (this.attachments.get(agentId) !== current || this.viewStarts.get(agentId) !== token)
          return { viewId: randomUUID(), ended: true };
        const view = new MobileLiveView(screen.width, screen.height);
        view.displayRotation = await this.adapter.displayRotation(current.device);
        if (this.attachments.get(agentId) !== current || this.viewStarts.get(agentId) !== token) {
          view.close();
          return { viewId: view.id, ended: true };
        }
        this.views.set(agentId, view);
        await view.connect((frame, error) => this.adapter.startView!(current.device, screen, frame, error));
        if (this.views.get(agentId) !== view) return { viewId: view.id, ended: true };
        return { viewId: view.id };
      } finally {
        if (this.viewStarts.get(agentId) === token) this.viewStarts.delete(agentId);
      }
    }
    const view = this.views.get(agentId);
    if (!view || view.id !== input.viewId) throw new Error('No matching simulator view. Reconnect the view.');
    switch (input.action) {
      case 'frame': return view.next();
      case 'touch':
        if (this.inputInFlight && input.phase === 'down') throw new Error('Simulator is busy. Try again.');
        await view.touch(input.phase, input.x, input.y, input.geometry);
        return { viewId: view.id };
      default: throw new Error('Unsupported simulator view action.');
    }
  }

  /** A device closed outside the app releases its attachment; checks are throttled because the pane polls. */
  private async stillRunning(agentId: string, attachment: MobileAttachment): Promise<boolean> {
    const now = Date.now();
    if (now - (this.checkedAt.get(attachment.id) ?? 0) < LIVENESS_INTERVAL_MS) return true;
    this.checkedAt.set(attachment.id, now);
    if (await this.adapter.isRunning(attachment.device)) return true;
    if (this.attachments.get(agentId) === attachment) {
      this.closeView(agentId);
      this.adapter.detach(attachment.device);
      this.attachments.delete(agentId);
    }
    this.checkedAt.delete(attachment.id);
    return false;
  }

  private closeView(agentId: string): void {
    this.viewStarts.delete(agentId);
    this.views.get(agentId)?.close();
    this.views.delete(agentId);
  }

  private async run(agentId: string, input: MobileRequest, generation: number, userInitiated: boolean): Promise<MobileResult> {
    if (!input || typeof input !== 'object' || typeof input.action !== 'string')
      throw new Error('Invalid simulator request.');
    if (this.retainedAgentIds && !this.retainedAgentIds.has(agentId)) throw new Error('Agent is no longer available.');
    const current = this.attachments.get(agentId) ?? null;
    if (input.action === 'status') {
      if (current && !(await this.stillRunning(agentId, current))) return { attachment: null };
      return { attachment: current };
    }
    if (input.action === 'list') {
      const catalog = await this.adapter.list();
      for (const device of catalog.devices) {
        const owner = [...this.attachments].find(([, attachment]) => attachment.device.id === device.id);
        if (owner) device.owner = owner[0];
      }
      return { attachment: current, catalog };
    }
    if (input.action === 'attach') {
      if (current) {
        if (current.device.id === input.deviceId) return { attachment: current };
        throw new Error('Detach the current device before attaching another.');
      }
      const devices = (await this.adapter.list()).devices;
      // A virtual device started since the pane last listed (even outside the app) is now listed under its serial.
      const device =
        devices.find((device) => device.id === input.deviceId) ??
        devices.find((device) => input.deviceId === `${AVD_PREFIX}${device.name}` && device.state === 'booted');
      if (!device) throw new Error('Device unavailable. Refresh devices and check prerequisites.');
      if ([...this.attachments.values()].some((attachment) => attachment.device.id === device.id))
        throw new Error('This device is attached to another agent. Its owner must detach first.');
      if (generation !== this.generation) throw new Error('Simulator session ended. Attach again.');
      let target = device;
      try {
        target = (await this.adapter.boot(device)) ?? device;
        await this.adapter.screen(target); // Verify the bridge and coordinate metadata before granting input.
        if (generation !== this.generation) throw new Error('Simulator session ended. Attach again.');
        if (this.retainedAgentIds && !this.retainedAgentIds.has(agentId))
          throw new Error('Agent is no longer available.');
        const attachment = { id: randomUUID(), device: { ...target, state: 'booted' as const } };
        this.attachments.set(agentId, attachment);
        return { attachment };
      } catch (error) {
        this.adapter.detach(target);
        throw error;
      }
    }
    if (!current || !('attachmentId' in input) || current.id !== input.attachmentId)
      throw new Error('No matching attachment. Read simulator status and attach again.');
    if (input.action === 'detach') {
      this.closeView(agentId);
      this.adapter.detach(current.device);
      this.attachments.delete(agentId);
      return { attachment: null };
    }
    if (input.action === 'rotate') {
      if (!userInitiated) throw new Error('Only the desktop user can rotate a device.');
      if (this.views.get(agentId)?.touching) throw new Error('A pane touch is in progress. Try again after release.');
      await this.adapter.rotate(current.device);
      const view = this.views.get(agentId);
      if (view) view.displayRotation = await this.adapter.displayRotation(current.device);
      return { attachment: current };
    }
    if (input.action === 'shutdown') {
      this.closeView(agentId);
      this.adapter.detach(current.device);
      this.attachments.delete(agentId);
      await this.adapter.shutdown(current.device);
      return { attachment: null };
    }
    if (input.action === 'inspect') {
      let inspection: NonNullable<MobileResult['inspection']>;
      try {
        inspection = { kind: 'accessibility', text: await this.adapter.inspect(current.device) };
      } catch {
        inspection = {
          kind: 'screenshot',
          text: 'Accessibility is unavailable. Read a screenshot; do not infer control state from missing accessibility data.',
        };
      }
      if (this.attachments.get(agentId) !== current || generation !== this.generation)
        throw new Error('Simulator session ended.');
      return { attachment: current, inspection };
    }
    if (input.action === 'screenshot') {
      const screen = await this.adapter.screen(current.device);
      if (this.attachments.get(agentId) !== current || generation !== this.generation)
        throw new Error('Simulator session ended.');
      return {
        attachment: current,
        frame: {
          attachmentId: current.id,
          data: screen.png.toString('base64'),
          mimeType: 'image/png',
          scale: screen.scale,
          width: screen.width,
          height: screen.height,
        },
      };
    }
    validateAction(input);
    if (this.views.get(agentId)?.touching) throw new Error('A pane touch is in progress. Try again after release.');
    this.inputInFlight = true;
    try {
    let screen: DeviceScreen | undefined;
    if (input.action === 'tap' || input.action === 'swipe') {
      screen = await this.adapter.screen(current.device);
      if (screen.width !== input.width || screen.height !== input.height)
        throw new Error('Screen dimensions changed. Read a fresh screenshot before interacting.');
    }
    if (generation !== this.generation || this.attachments.get(agentId) !== current)
      throw new Error('Simulator session ended.');
    await this.adapter.perform(current.device, input, screen);
    return { attachment: current };
    } finally { this.inputInFlight = false; }
  }
}

function validateAction(input: MobileAction): void {
  switch (input.action) {
    case 'tap':
    case 'swipe': {
      const point = (x: number, y: number) =>
        Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < input.width && y < input.height;
      if (
        !Number.isInteger(input.width) ||
        !Number.isInteger(input.height) ||
        input.width <= 0 ||
        input.height <= 0 ||
        input.width > 10000 ||
        input.height > 10000 ||
        !point(input.x, input.y)
      )
        throw new Error('Invalid screenshot coordinates.');
      if (
        input.action === 'swipe' &&
        (!point(input.toX, input.toY) ||
          !Number.isFinite(input.durationMs) ||
          input.durationMs < 100 ||
          input.durationMs > 3000)
      )
        throw new Error('Invalid swipe.');
      return;
    }
    case 'text':
      if (typeof input.text !== 'string' || input.text.length > 2000) throw new Error('Invalid text.');
      return;
    case 'launch':
      if (typeof input.appId !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.]{0,199}$/.test(input.appId))
        throw new Error('Invalid app identifier.');
      return;
    case 'button':
      if (!['home', 'back', 'enter', 'backspace', 'volumeUp', 'volumeDown', 'power'].includes(input.button)) throw new Error('Unsupported device button.');
      return;
    default:
      throw new Error('Unsupported simulator action.');
  }
}
