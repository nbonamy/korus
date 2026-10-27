// Native WebViews can predate the Promise API required by the companion transport.
import 'core-js/actual/promise/with-resolvers';
import { createNativeMessageBridge, type NativeMessagePort } from '../../src/native-message-bridge';

/** Native mobile hosts provide message handlers and receive the same bundled pages. */
type Handler = { postMessage(message: unknown): Promise<unknown> | void };
declare global {
  interface Window {
    companionNative?: NativeMessagePort;
    webkit?: { messageHandlers: Record<string, Handler | undefined> };
    companionChanges?: { setDiff(json: string): void };
    companionEngine?: { dispatch(command: string): Promise<void>; start(): Promise<void> };
    companionTranscript?: { setTransfer(json: string): Promise<Record<string, unknown> | null>; setConversation(json: string): Promise<{ agentId: string; revision: number } | null>; setContext(json: string): Promise<{ agentId: string; revision: number } | null>; setContent(json: string): void; setImage(json: string): void; setInsets(top: number, bottom: number, leading?: number, trailing?: number): void };
  }
}
let androidBridge: ReturnType<typeof createNativeMessageBridge> | undefined;
export function handler(name: string): Handler {
  const found = window.webkit?.messageHandlers[name];
  if (found) return found;
  if (window.companionNative) {
    if (!androidBridge) {
      androidBridge = createNativeMessageBridge(window.companionNative);
      window.addEventListener('pagehide', () => androidBridge?.dispose(), { once: true });
    }
    return androidBridge.handler(name);
  }
  throw new Error(`The native host did not register "${name}".`);
}
/** A request the native host answers (vault, configuration). */
export async function request<Result>(message: Record<string, unknown>): Promise<Result> {
  return await handler('native').postMessage(message) as Result;
}
