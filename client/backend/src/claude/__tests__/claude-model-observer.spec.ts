import { expect, it } from "vitest";
import { ClaudeModelObserver } from "../claude-model-observer";
import type { ClaudeSdkMessage } from "../protocol";

it("keeps actual main-loop model evidence across repeated blocks, excluding replay, subagents and errors", () => {
  const observer = new ClaudeModelObserver();
  expect(observer.snapshot()).toBeUndefined();
  observer.observe({
    type: "stream_event",
    event: { type: "message_start", message: { id: "a", model: "sonnet" } },
  });
  observer.observe({
    type: "assistant",
    message: { id: "a", model: "sonnet" },
  });
  observer.observe({ type: "assistant", message: { id: "a", content: [] } });
  for (const extra of [
    { parent_tool_use_id: "subagent" },
    { isReplay: true },
    { error: "api_error" },
  ])
    observer.observe({
      type: "assistant",
      ...extra,
      message: { id: "ignored", model: "other" },
    } as ClaudeSdkMessage);
  observer.observe({ type: "assistant", message: { id: "sdk-notice", model: "<synthetic>" } });
  expect(observer.snapshot()).toBe("sonnet");
  observer.observe({ type: "assistant", message: { id: "b", model: "opus" } });
  expect(observer.snapshot()).toBeNull();
});

it("keeps incomplete, inconsistent and oversized model evidence unknown", () => {
  for (const metadata of [
    { id: "b" },
    { id: "a", model: "other" },
    { id: "b", model: "x".repeat(201) },
  ]) {
    const observer = new ClaudeModelObserver();
    observer.observe({
      type: "assistant",
      message: { id: "a", model: "sonnet" },
    });
    observer.observe({ type: "assistant", message: metadata });
    expect(observer.snapshot()).toBeNull();
  }
});
