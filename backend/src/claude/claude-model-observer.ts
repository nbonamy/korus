import type { ClaudeSdkMessage } from "./protocol";

/** Actual main-loop model metadata; mixed or incomplete evidence stays unknown. */
export class ClaudeModelObserver {
  private readonly models = new Map<string, string | null>();
  private invalid = false;
  observe(message: ClaudeSdkMessage): void {
    const envelope = message as Record<string, unknown>;
    if (
      this.invalid ||
      envelope.parent_tool_use_id != null ||
      envelope.isReplay === true ||
      (message.type === "assistant" && typeof message.error === "string")
    )
      return;
    const event = envelope.event as Record<string, unknown> | undefined;
    const metadata = (
      message.type === "assistant"
        ? message.message
        : message.type === "stream_event" && event?.type === "message_start"
          ? event.message
          : null
    ) as Record<string, unknown> | null;
    if (
      !metadata ||
      typeof metadata.id !== "string" ||
      !metadata.id ||
      metadata.id.length > 256
    )
      return;
    if (!this.models.has(metadata.id)) {
      if (this.models.size >= 10000) {
        this.invalid = true;
        return;
      }
      this.models.set(
        metadata.id,
        typeof metadata.model === "string" && metadata.model.length <= 200
          ? metadata.model
          : null,
      );
    } else if (
      typeof metadata.model === "string" &&
      metadata.model !== this.models.get(metadata.id)
    ) {
      this.models.set(metadata.id, null);
    }
  }
  /** No response evidence leaves the provider-reported init model intact. */
  snapshot(): string | null | undefined {
    if (this.invalid) return null;
    if (!this.models.size) return undefined;
    const models = new Set(this.models.values());
    return models.size === 1 ? models.values().next().value! : null;
  }
}
