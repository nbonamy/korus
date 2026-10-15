import { expect, it } from "vitest";
import { TextStreamObserver } from "../text-stream-observer";
it("measures newly delivered Unicode characters over matched live message intervals without counting tool waits", () => {
  let now = 100;
  const observer = new TextStreamObserver(() => now);
  observer.delta("one", "PRIVATE_CONTENT_CANARY");
  now = 1100;
  observer.delta("one", "😀ab");
  now = 2100;
  observer.delta("one", "cd");
  observer.end("one");
  now = 92100;
  observer.delta("two", "first chunk");
  now = 93100;
  observer.delta("two", "hello");
  observer.end("two");
  expect(observer.snapshot()).toStrictEqual({
    characters: 10,
    durationMs: 3000,
    messages: 2,
  });
  observer.delta("one", "duplicate after end");
  expect(observer.snapshot()).toStrictEqual({
    characters: 10,
    durationMs: 3000,
    messages: 2,
  });
});
it("leaves single-chunk and zero-duration delivery unknown and fails closed on identity bounds", () => {
  const observer = new TextStreamObserver(() => 100);
  observer.delta("one", "first");
  observer.delta("one", "second");
  expect(observer.snapshot()).toBeNull();
  observer.delta("x".repeat(257), "ignored");
  expect(observer.snapshot()).toBeNull();
});
