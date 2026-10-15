import { expect, it } from "vitest";
import { validExecutionBehavior, type ExecutionBehavior } from "../usage";
const value: ExecutionBehavior = {
  model: "claude-sonnet-4-6",
  responses: 2,
  toolCalls: 0,
  toolResponses: 0,
  multiToolResponses: 0,
  stream: { outputTokens: 120, durationMs: 2000, responses: 1 },
};
it("preserves known zero separately from unavailable measurements and validates paired stream evidence", () => {
  expect(validExecutionBehavior(value)).toBe(true);
  expect(
    validExecutionBehavior({
      ...value,
      model: null,
      responses: null,
      toolCalls: 0,
      toolResponses: null,
      multiToolResponses: null,
      stream: null,
    }),
  ).toBe(true);
  for (const invalid of [
    null,
    [],
    {},
    { ...value, content: "secret" },
    { ...value, model: "x".repeat(201) },
    { ...value, model: 42 },
    { ...value, toolCalls: -1 },
    { ...value, toolCalls: 1.5 },
    { ...value, toolCalls: 1e9 + 1 },
    { ...value, toolResponses: 3 },
    { ...value, multiToolResponses: 1 },
    { ...value, stream: [] },
    { ...value, stream: undefined },
    { ...value, stream: { ...value.stream!, durationMs: 0 } },
    { ...value, stream: { ...value.stream!, responses: 3 } },
    { ...value, stream: { ...value.stream!, outputTokens: NaN } },
    { ...value, stream: { ...value.stream!, transcript: "secret" } },
  ])
    expect(validExecutionBehavior(invalid)).toBe(false);
});
