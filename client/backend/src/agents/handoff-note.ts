import type { Agent, BackendPublishedEvent, RendererMessage } from '@workspace/core/contracts';
import type { ProviderSendResult } from '@workspace/core/provider-driver';

/** Observe a single accepted turn, then read its final text through the provider's history boundary. */
export async function requestHandoffNote(agent: Agent, prompt: string, port: {
  subscribe(listener: (event: BackendPublishedEvent) => void): () => void;
  send(agent: Agent, prompt: string): Promise<ProviderSendResult>;
  read(agent: Agent): Promise<RendererMessage[]>;
  timeoutMs?: number;
}): Promise<string> {
  let accepted: ProviderSendResult | undefined;
  const completions = new Map<string, string>();
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const complete = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // A timeout/error may occur while send is still waiting for acceptance.
  void complete.catch(() => undefined);
  const check = () => {
    if (!accepted?.turnId || !completions.has(accepted.turnId)) return;
    if (completions.get(accepted.turnId) !== 'completed') reject(new Error('The agent stopped before finishing its handoff note. This conversation is unchanged; try again.'));
    else resolve();
  };
  const unsubscribe = port.subscribe(event => {
    if (event.agentId !== agent.id) return;
    if (event.type === 'session.error') reject(new Error('The agent couldn’t write its handoff note. This conversation is unchanged; try again.'));
    if (event.type === 'turn.completed') {
      completions.set(event.turnId, event.payload.status);
      check();
    }
  });
  let expire!: (error: Error) => void;
  const deadline = new Promise<never>((_, no) => { expire = no; });
  const timer = setTimeout(() => expire(new Error('The agent didn’t finish its handoff note in time. This conversation is unchanged; try again.')), port.timeoutMs ?? 300_000);
  timer.unref?.();
  try {
    accepted = await Promise.race([port.send(agent, prompt), deadline, complete.then(() => { throw new Error('The handoff ended before the agent accepted the request. This conversation is unchanged; try again.'); })]);
    if (!accepted.turnId) throw new Error('The agent didn’t confirm the handoff request. This conversation is unchanged; try again.');
    check();
    await Promise.race([complete, deadline]);
    const messages = await Promise.race([port.read(agent), deadline]);
    const final = [...messages].reverse().find(message => message.role === 'assistant' && message.status === 'complete' && message.turnId === accepted!.turnId);
    const text = final?.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n').trim();
    if (!text) throw new Error('The agent’s handoff note couldn’t be read. This conversation is unchanged; try again.');
    return text;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
