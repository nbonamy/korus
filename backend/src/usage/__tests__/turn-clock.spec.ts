import { expect, it } from "vitest";
import { TurnClock } from "../turn-clock";

const setup = () => {
  let now = 1000;
  const clock = new TurnClock(() => now);
  return { clock, at: (value: number) => (now = value) };
};

it("measures working time from prompt submission and the first output within it", () => {
  const { clock, at } = setup();
  clock.start("a", 1000);
  at(3000);
  clock.output("a");
  at(3500);
  clock.output("a"); // Only the first output counts.
  at(11000);
  expect(clock.finish("a")).toStrictEqual({ activeMs: 10000, ttftMs: 2000 });
  expect(clock.finish("a")).toBeNull();
});

it("excludes time spent waiting on the user, including before the first output", () => {
  const { clock, at } = setup();
  clock.start("a", 1000);
  at(2000);
  clock.wait("a", true);
  at(62000); // A minute waiting on an approval.
  clock.wait("a", true); // Repeating the wait does not move its start.
  clock.wait("a", false);
  at(63000);
  clock.output("a");
  at(73000);
  expect(clock.finish("a")).toStrictEqual({ activeMs: 12000, ttftMs: 2000 });
});

it("stops the clock when a turn ends while blocked and keeps agents independent", () => {
  const { clock, at } = setup();
  clock.start("a", 1000);
  clock.start("b", 1000);
  at(5000);
  clock.wait("a", true);
  at(65000);
  expect(clock.finish("a")).toStrictEqual({ activeMs: 4000, ttftMs: null });
  expect(clock.finish("b")).toStrictEqual({ activeMs: 64000, ttftMs: null });
});

it("treats output as proof that nothing is blocking", () => {
  const { clock, at } = setup();
  clock.start("a", 0);
  at(1000);
  clock.wait("a", true);
  at(9000);
  clock.output("a");
  at(10000);
  expect(clock.finish("a")).toStrictEqual({ activeMs: 2000, ttftMs: 1000 });
});

it("pauses once for parallel tool calls until the last one ends, and ignores repeated events", () => {
  const { clock, at } = setup();
  clock.start("a", 1000);
  at(2000);
  clock.tool("a", "one", true);
  at(3000);
  clock.tool("a", "two", true);
  clock.tool("a", "two", true);
  at(4000);
  clock.tool("a", "one", false); // "two" is still running.
  at(7000);
  clock.tool("a", "two", false);
  at(8000);
  clock.output("a");
  at(10000);
  // Working 1000-2000 and 7000-10000; the tools held the clock from 2000 to 7000.
  expect(clock.finish("a")).toStrictEqual({ activeMs: 4000, ttftMs: 2000 });
});

it("keeps the clock stopped while either the user or a tool is blocking", () => {
  const { clock, at } = setup();
  at(0);
  clock.start("a");
  clock.tool("a", "t", true);
  at(1000);
  clock.wait("a", true);
  at(2000);
  clock.tool("a", "t", false); // Still waiting on the user.
  at(5000);
  clock.wait("a", false);
  at(6000);
  expect(clock.finish("a")).toStrictEqual({ activeMs: 1000, ttftMs: null });
});
