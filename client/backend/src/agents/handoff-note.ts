import type { Agent, BackendPublishedEvent, RendererMessage } from '@workspace/core/contracts';
import type { BackendSendResult } from '@workspace/core/backend-driver';
import { providerConversationEventView } from '@workspace/core/provider-conversation-event';

/** Observe a single accepted turn, then read its final text through the provider's history boundary. */
export async function requestHandoffNote(agent: Agent, prompt: string, port: {
  subscribe(listener: (event: BackendPublishedEvent) => void): () => void;
  send(agent: Agent, prompt: string): Promise<BackendSendResult>;
  read(agent: Agent): Promise<RendererMessage[]>;
  timeoutMs?: number;
}): Promise<string> {
  let accepted: BackendSendResult | undefined;
  const completions = new Map<string, string>();
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const complete = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // A timeout/error may occur while send is still waiting for acceptance.
  void complete.catch(() => undefined);
  const check = () => {
    if (!accepted?.turnId || !completions.has(accepted.turnId)) return;
    if (completions.get(accepted.turnId) !== 'completed') reject(new Error('Handoff note turn did not complete.'));
    else resolve();
  };
  const unsubscribe = port.subscribe(event => {
    if (event.agentId !== agent.id) return;
    const view = providerConversationEventView(event);
    if (view.type === 'error') reject(new Error('The source could not prepare a handoff note.'));
    if (view.type === 'turn.completed' && view.turnId) {
      const payload = view.payload as { status?: string; turn?: { status?: string } };
      completions.set(view.turnId, payload.status ?? payload.turn?.status ?? '');
      check();
    }
  });
  let expire!: (error: Error) => void;
  const deadline = new Promise<never>((_, no) => { expire = no; });
  const timer = setTimeout(() => expire(new Error('Handoff note timed out. The source has been kept.')), port.timeoutMs ?? 90_000);
  timer.unref?.();
  try {
    accepted = await Promise.race([port.send(agent, prompt), deadline, complete.then(() => { throw new Error('Handoff ended before acceptance.'); })]);
    if (!accepted.turnId) throw new Error('The provider did not identify the handoff turn. The source has been kept.');
    check();
    await Promise.race([complete, deadline]);
    const messages = await Promise.race([port.read(agent), deadline]);
    const final = [...messages].reverse().find(message => message.role === 'assistant' && message.status === 'complete' && message.turnId === accepted!.turnId);
    const text = final?.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n').trim();
    if (!text) throw new Error('The completed handoff note could not be read. The source has been kept.');
    return text;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
