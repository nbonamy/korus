import { expect, it } from "vitest";
import { ClaudeBehaviorObserver } from "../claude-behavior-observer";
import type { ClaudeSdkMessage } from "../protocol";
it("pairs response usage with its own stream interval and deduplicates per-block assistant/tool events", () => {
  let clock = 1000;
  const observer = new ClaudeBehaviorObserver(() => clock);
  const emit = (event: Record<string, unknown>) =>
    observer.observe({ type: "stream_event", event } as ClaudeSdkMessage);
  emit({
    type: "message_start",
    message: { id: "a", model: "claude-sonnet-4-6" },
  });
  emit({
    type: "message_start",
    message: { id: "a", model: "claude-sonnet-4-6" },
  });
  observer.observe({
    type: "assistant",
    message: {
      id: "a",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "CANARY response" }],
    },
  } as ClaudeSdkMessage);
  const tool = {
    type: "tool_use",
    id: "tool-1",
    name: "CANARY_name",
    input: { secret: "CANARY_input" },
  };
  observer.observe({
    type: "assistant",
    message: { id: "a", model: "claude-sonnet-4-6", content: [tool] },
  } as ClaudeSdkMessage);
  observer.observe({
    type: "assistant",
    message: { id: "a", content: [tool] },
  });
  emit({ type: "content_block_start", index: 1, content_block: tool });
  emit({ type: "content_block_stop", index: 1 });
  emit({
    type: "content_block_start",
    index: 2,
    content_block: { ...tool, id: "tool-2" },
  });
  emit({ type: "content_block_stop", index: 2 });
  emit({
    type: "message_delta",
    delta: { stop_reason: "tool_use" },
    usage: { output_tokens: 120 },
  });
  clock = 3000;
  emit({ type: "message_stop" });
  observer.observe({
    type: "assistant",
    message: {
      id: "b",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "CANARY" }],
    },
  } as ClaudeSdkMessage);
  const snapshot = observer.snapshot();
  expect(snapshot).toStrictEqual({
    model: "claude-sonnet-4-6",
    responses: 2,
    toolCalls: 2,
    toolResponses: 1,
    multiToolResponses: 1,
    stream: { outputTokens: 120, durationMs: 2000, responses: 1 },
  });
  expect(JSON.stringify(snapshot)).not.toContain("CANARY");
});
it("keeps absent intervals and model attribution unknown; excludes subagent/replayed evidence and unfinished tool inputs", () => {
  const observer = new ClaudeBehaviorObserver(() => 1000);
  for (const extra of [{ parent_tool_use_id: "subagent" }, { isReplay: true }])
    observer.observe({
      type: "assistant",
      ...extra,
      message: { id: "ignored", model: "private", content: [] },
    } as ClaudeSdkMessage);
  observer.observe({
    type: "stream_event",
    event: {
      type: "message_start",
      message: { id: "a", model: "claude-sonnet-4-6" },
    },
  });
  observer.observe({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "incomplete", name: "CANARY" },
    },
  });
  observer.observe({ type: "stream_event", event: { type: "message_stop" } });
  observer.observe({
    type: "assistant",
    message: { id: "b", model: "claude-opus-4-6", content: [] },
  } as ClaudeSdkMessage);
  expect(observer.snapshot()).toStrictEqual({
    model: null,
    responses: 2,
    toolCalls: 0,
    toolResponses: 0,
    multiToolResponses: 0,
    stream: null,
  });
  expect(new ClaudeBehaviorObserver().snapshot()).toBeNull();
});
it("fails closed when a response exceeds the local identity bound", () => {
  const observer = new ClaudeBehaviorObserver();
  observer.observe({
    type: "assistant",
    message: {
      id: "a",
      content: [{ type: "tool_use", id: "x".repeat(257), name: "CANARY" }],
    },
  });
  expect(observer.snapshot()).toBeNull();
});
