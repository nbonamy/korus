import { TextStreamObserver } from "../telemetry/text-stream-observer";
import {
  validExecutionBehavior,
  type ExecutionBehavior,
} from "@workspace/core/usage";
import type { ClaudeSdkMessage } from "./protocol";
type Response = {
  model: string | null;
  tools: Set<string>;
  start: number | null;
  stop: number | null;
  output: number | null;
};
/** Observes API metadata, never stores text, tool names, arguments or reasoning content. */
export class ClaudeBehaviorObserver {
  private responses = new Map<string, Response>();
  private current: string | null = null;
  private blocks = new Map<number, string>();
  private invalid = false;
  private toolCount = 0;
  private readonly text: TextStreamObserver;
  constructor(private readonly now: () => number = () => performance.now()) {
    this.text = new TextStreamObserver(now);
  }
  textSnapshot() {
    return this.invalid ? null : this.text.snapshot();
  }
  observe(message: ClaudeSdkMessage): void {
    if (this.invalid) return;
    if (message.type === "assistant" && typeof message.error === "string")
      return;
    const envelope = message as Record<string, unknown>;
    if (envelope.parent_tool_use_id != null || envelope.isReplay === true)
      return;
    if (
      message.type === "assistant" &&
      message.message &&
      typeof message.message === "object"
    ) {
      const metadata = message.message as Record<string, unknown>;
      const response = this.response(metadata);
      if (!response) return;
      if (Array.isArray(metadata.content))
        for (const block of metadata.content) {
          if (
            block &&
            block.type === "tool_use" &&
            typeof block.id === "string"
          )
            this.tool(response, block.id);
        }
    }
    if (
      message.type !== "stream_event" ||
      !message.event ||
      typeof message.event !== "object"
    )
      return;
    const event = message.event as Record<string, unknown>;
    if (event.type === "message_start") {
      this.current = null;
      this.blocks.clear();
      const metadata = event.message;
      if (!metadata || typeof metadata !== "object") return;
      const record = metadata as Record<string, unknown>;
      const response = this.response(record);
      if (!response) return;
      // Duplicate starts cannot restart the interval or create a second response.
      if (response.start === null && response.stop === null)
        response.start = this.now();
      this.current = record.id as string;
      this.blocks.clear();
      return;
    }
    const response = this.current
      ? this.responses.get(this.current)
      : undefined;
    if (!response) return;
    if (event.type === "content_block_start") {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (
        block?.type === "tool_use" &&
        typeof block.id === "string" &&
        Number.isSafeInteger(event.index)
      ) {
        if (block.id.length > 256 || this.blocks.size >= 10000) {
          this.invalid = true;
          return;
        }
        this.blocks.set(event.index as number, block.id);
      }
    }
    if (
      event.type === "content_block_stop" &&
      Number.isSafeInteger(event.index)
    ) {
      const id = this.blocks.get(event.index as number);
      if (id) this.tool(response, id);
      this.blocks.delete(event.index as number);
    }
    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string")
        this.text.delta(this.current!, delta.text);
    }
    if (event.type === "message_delta") {
      const usage = event.usage as Record<string, unknown> | undefined;
      const delta = event.delta as Record<string, unknown> | undefined;
      // Only a completed response's numeric output counter matches this stream interval.
      if (
        typeof delta?.stop_reason === "string" &&
        Number.isSafeInteger(usage?.output_tokens) &&
        (usage!.output_tokens as number) >= 0 &&
        (usage!.output_tokens as number) <= 1e9
      )
        response.output = usage!.output_tokens as number;
    }
    if (event.type === "message_stop") {
      this.text.end(this.current!);
      response.stop ??= this.now();
      this.current = null;
      this.blocks.clear();
    }
  }
  snapshot(): ExecutionBehavior | null {
    if (this.invalid || !this.responses.size) return null;
    const responses = [...this.responses.values()];
    const models = new Set(responses.map((r) => r.model));
    const streams = responses.filter(
      (r) =>
        r.start !== null &&
        r.stop !== null &&
        r.stop > r.start &&
        r.output !== null,
    );
    const behavior: ExecutionBehavior = {
      model: models.size === 1 ? [...models][0]! : null,
      responses: responses.length,
      toolCalls: responses.reduce((n, r) => n + r.tools.size, 0),
      toolResponses: responses.filter((r) => r.tools.size > 0).length,
      multiToolResponses: responses.filter((r) => r.tools.size > 1).length,
      stream: streams.length
        ? {
            outputTokens: streams.reduce((n, r) => n + r.output!, 0),
            durationMs: Math.max(
              1,
              Math.round(streams.reduce((n, r) => n + r.stop! - r.start!, 0)),
            ),
            responses: streams.length,
          }
        : null,
    };
    return validExecutionBehavior(behavior) ? behavior : null;
  }
  private response(metadata: Record<string, unknown>): Response | null {
    if (
      typeof metadata.id !== "string" ||
      !metadata.id ||
      metadata.id.length > 256
    )
      return null;
    let response = this.responses.get(metadata.id);
    if (!response) {
      if (this.responses.size >= 10000) {
        this.invalid = true;
        return null;
      }
      response = {
        model:
          typeof metadata.model === "string" && metadata.model.length <= 200
            ? metadata.model
            : null,
        tools: new Set(),
        start: null,
        stop: null,
        output: null,
      };
      this.responses.set(metadata.id, response);
    } else if (
      typeof metadata.model === "string" &&
      metadata.model !== response.model
    )
      response.model = null;
    return response;
  }
  private tool(response: Response, id: string): void {
    if (response.tools.has(id)) return;
    if (id.length > 256 || this.toolCount >= 10000) {
      this.invalid = true;
      return;
    }
    response.tools.add(id);
    this.toolCount++;
  }
}
