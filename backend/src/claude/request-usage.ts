import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RequestObservation } from "@workspace/core/usage";

export type ClaudeRequestUsage = Omit<
  RequestObservation,
  "provider" | "agentId" | "sessionId" | "turnId"
>;
export type ClaudeRequestUsageOwner = {
  emit: (usage: ClaudeRequestUsage | null) => void;
  requestedServiceTier: string | null;
  unknown: boolean;
  children: boolean;
  totals: number[];
};
type State = {
  owner: ClaudeRequestUsageOwner;
  id: string;
  at: number;
  parent: string | null;
  upstream: string | null;
  model: string | null;
  raw: Record<string, unknown>;
  output: number | null;
  streamed: boolean;
  final: boolean;
  revision: number;
  last?: ClaudeRequestUsage;
};
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= 2048 ? v : null;
const count = (v: unknown): number | null =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 1e9
    ? (v as number)
    : null;
const sum = (values: (number | null)[]): number | null =>
  values.includes(null)
    ? null
    : count((values as number[]).reduce((a, b) => a + b, 0));

/** Numeric projection at the public SDK boundary. Never retains content or result cost estimates. */
export class ClaudeRequestUsageObserver {
  private readonly requests = new Map<string, State>();
  private readonly cursors = new Map<string | null, State>();
  private readonly tools = new Map<string, ClaudeRequestUsageOwner>();
  constructor(private readonly apiProvider: "anthropic" | null) {}

  observe(message: SDKMessage, current: ClaudeRequestUsageOwner | null): void {
    const raw = record(message);
    const parent = text(raw.parent_tool_use_id);
    const owner = parent ? (this.tools.get(parent) ?? current) : current;
    const event = message.type === "stream_event" ? record(raw.event) : {};
    const body =
      message.type === "assistant"
        ? record(raw.message)
        : event.type === "message_start"
          ? record(event.message)
          : null;
    if (body) {
      if (body.model === '<synthetic>') return;
      const id = text(body.id);
      if (!id) {
        if (owner) this.incomplete(owner);
        return;
      }
      let state = this.requests.get(id);
      if (!state && parent && !this.tools.has(parent)) {
        if (owner) this.incomplete(owner);
        return;
      }
      if (!state) {
        if (!owner) return;
        state = {
          owner,
          id,
          at: Date.now(),
          parent,
          upstream: null,
          model: text(body.model),
          raw: {},
          output: null,
          streamed: false,
          final: false,
          revision: 0,
        };
        this.requests.set(id, state);
      }
      if (parent && !state.owner.children) {
        state.owner.children = true;
        state.owner.emit(null);
      }
      if (!state.streamed || (event.type === "message_start" && !state.last)) {
        state.raw = { ...record(body.usage) };
        state.model = text(body.model);
      }
      if (event.type === "message_start") {
        // A replayed start must not replace measured final usage or its timestamp.
        state.streamed = true;
        this.cursors.set(parent, state);
      }
      state.upstream = text(raw.request_id) ?? state.upstream;
      for (const block of Array.isArray(body.content) ? body.content : [])
        this.tool(record(block), state.owner);
      // Assistant output is the API's message_start placeholder, even on final blocks.
      // Only stream terminal evidence establishes final usage; assistant blocks
      // can arrive while a response is still generating.
      this.publish(state);
      return;
    }
    const state = this.cursors.get(parent);
    if (event.type === "content_block_start" && (state?.owner ?? owner))
      this.tool(record(event.content_block), (state?.owner ?? owner)!);
    if (!state) return;
    if (event.type === "message_delta") {
      const usage = record(event.usage);
      const output = count(usage.output_tokens);
      // A late cumulative sample cannot replace any category from a newer one.
      if (output !== null && state.output !== null && output < state.output)
        return;
      // Nullable cumulative input fields in deltas mean no new input measurement.
      for (const [key, value] of Object.entries(usage))
        if (value !== null) state.raw[key] = value;
      if (output !== null && (state.output === null || output >= state.output))
        state.output = output;
      if (text(record(event.delta).stop_reason)) state.final = true;
      this.publish(state);
    } else if (event.type === "message_stop") {
      state.final = true;
      this.publish(state);
    }
  }

  private incomplete(owner: ClaudeRequestUsageOwner): void {
    owner.unknown = true;
    owner.emit(null);
  }

  private tool(
    block: Record<string, unknown>,
    owner: ClaudeRequestUsageOwner,
  ): void {
    if (block.type !== "tool_use" || !text(block.id)) return;
    // Keep the original execution owner when the same block is replayed later.
    if (!this.tools.has(block.id as string))
      this.tools.set(block.id as string, owner);
    if (block.name === "Agent" || block.name === "Task") owner.children = true;
  }

  private publish(s: State): void {
    const u = s.raw;
    const input = count(u.input_tokens),
      read = count(u.cache_read_input_tokens),
      writes = count(u.cache_creation_input_tokens);
    const buckets = record(u.cache_creation);
    const short = count(buckets.ephemeral_5m_input_tokens),
      hour = count(buckets.ephemeral_1h_input_tokens);
    const cacheWrite: Record<string, number> | null =
      writes === 0 && Object.values(buckets).every((n) => n === null || n === 0)
        ? {}
        : writes !== null &&
            short !== null &&
            hour !== null &&
            short + hour === writes
          ? { "5m": short, "1h": hour }
          : null;
    const tier = text(u.service_tier),
      speed = text(u.speed);
    const unavailableReason =
      Array.isArray(u.iterations) &&
      (u.iterations.length > 1 ||
        u.iterations.some((iteration) => {
          const detail = record(iteration);
          // Ordinary wire iterations can omit model; the enclosing message owns it.
          return (
            detail.type !== "message" ||
            (detail.model !== undefined && text(detail.model) !== s.model)
          );
        }))
        ? "unsupported-request-iterations"
        : !tier
          ? "missing-service-tier"
          : !speed
            ? "missing-billing-mode"
            : s.output === null
              ? "missing-token-usage"
              : undefined;
    const usage: ClaudeRequestUsage = {
      requestId: s.id,
      at: s.at,
      revision: s.revision,
      status: s.final ? "final" : "provisional",
      apiProvider: this.apiProvider,
      model: s.model,
      modality: "text",
      cacheMode: "explicit",
      parentToolUseId: s.parent,
      upstreamRequestId: s.upstream,
      tokens: {
        input,
        output: s.output,
        cacheRead: read,
        cacheWrite,
        reasoning: count(record(u.output_tokens_details).thinking_tokens),
        inputIncludesCacheRead: false,
        inputIncludesCacheWrite: false,
        outputIncludesReasoning: true,
      },
      pricingContext: {
        context: sum([input, read, writes]),
        region: text(u.inference_geo),
      },
      requestedServiceTier: s.owner.requestedServiceTier,
      reportedServiceTier: tier,
      reportedMode: speed,
      ...(unavailableReason ? { unavailableReason } : {}),
    };
    if (
      s.last &&
      JSON.stringify({ ...s.last, revision: 0 }) ===
        JSON.stringify({ ...usage, revision: 0 })
    )
      return;
    usage.revision = s.revision++;
    s.last = usage;
    s.owner.emit(usage);
  }

  /** Main-loop totals can attest that captured requests cover that loop. The public
   * SDK has no equivalent per-child final totals, so child executions stay partial. */
  finish(
    owner: ClaudeRequestUsageOwner,
    usage: unknown,
  ): "complete" | "partial" {
    const u = record(usage);
    const values = [
      u.input_tokens,
      u.cache_read_input_tokens,
      u.cache_creation_input_tokens,
      u.output_tokens,
    ].map(count);
    owner.totals = owner.totals.map((n, i) =>
      values[i] === null ? NaN : n + values[i]!,
    );
    const states = [...this.requests.values()].filter(
      (s) => s.owner === owner && s.parent === null,
    );
    const totals = states.reduce(
      (result, s) =>
        result.map(
          (n, i) =>
            n +
            ([
              count(s.raw.input_tokens),
              count(s.raw.cache_read_input_tokens),
              count(s.raw.cache_creation_input_tokens),
              s.output,
            ][i] ?? NaN),
        ),
      [0, 0, 0, 0],
    );
    return !owner.unknown &&
      !owner.children &&
      states.length > 0 &&
      states.every((s) => s.final) &&
      totals.every((n, i) => n === owner.totals[i])
      ? "complete"
      : "partial";
  }
}
