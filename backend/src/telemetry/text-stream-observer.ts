import { validTextStream, type TextStream } from "@workspace/core/usage";
type Message = {
  first: number;
  last: number;
  characters: number;
  ended: boolean;
  highSurrogate: boolean;
};
/** Numeric receipt-time observation only. The first chunk establishes the clock and is excluded from the numerator. */
export class TextStreamObserver {
  private readonly messages = new Map<string, Message>();
  private invalid = false;
  constructor(private readonly now: () => number = () => performance.now()) {}
  delta(id: string, text: string): void {
    if (this.invalid || !text) return;
    if (
      typeof id !== "string" ||
      typeof text !== "string" ||
      id.length > 256 ||
      text.length > 1_000_000 ||
      (!this.messages.has(id) && this.messages.size >= 10000)
    ) {
      this.invalid = true;
      return;
    }
    const at = this.now(),
      previous = this.messages.get(id);
    if (previous?.ended) return;
    let count = 0;
    for (const _character of text) count++;
    if (
      previous?.highSurrogate &&
      text.charCodeAt(0) >= 0xdc00 &&
      text.charCodeAt(0) <= 0xdfff
    )
      count--;
    const last = text.charCodeAt(text.length - 1),
      highSurrogate = last >= 0xd800 && last <= 0xdbff;
    if (!previous)
      this.messages.set(id, {
        first: at,
        last: at,
        characters: 0,
        ended: false,
        highSurrogate,
      });
    else {
      previous.last = at;
      previous.characters += count;
      previous.highSurrogate = highSurrogate;
    }
  }
  end(id: string): void {
    const message = this.messages.get(id);
    if (message) message.ended = true;
  }
  snapshot(): TextStream | null {
    if (this.invalid) return null;
    const result: TextStream = { characters: 0, durationMs: 0, messages: 0 };
    for (const message of this.messages.values())
      if (message.last > message.first) {
        result.characters += message.characters;
        result.durationMs += message.last - message.first;
        result.messages++;
      }
    result.durationMs = Math.round(result.durationMs);
    return validTextStream(result) ? result : null;
  }
}
