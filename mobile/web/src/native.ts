/** The only surface shared with the Swift app: message handlers in, and a few functions it calls. */
type Handler = { postMessage(message: unknown): Promise<unknown> | void };
declare global {
  interface Window {
    webkit?: { messageHandlers: Record<string, Handler | undefined> };
    companionEngine?: { dispatch(command: string): Promise<void>; start(): Promise<void> };
    companionTranscript?: { setConversation(json: string): Promise<string | null>; setInsets(top: number, bottom: number): void };
  }
}
export function handler(name: string): Handler {
  const found = window.webkit?.messageHandlers[name];
  if (!found) throw new Error(`The native host did not register "${name}".`);
  return found;
}
/** A request the Swift side answers (vault, configuration). */
export async function request<Result>(message: Record<string, unknown>): Promise<Result> {
  return await handler('native').postMessage(message) as Result;
}
