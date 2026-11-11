import type { CodexConversationEvent } from '@korus-dev/multi-agent-sdk';

type Resolution = Extract<CodexConversationEvent, { type: 'approval.resolved' | 'clientRequest.resolved' }>;
type WireResolution<Event> = Event extends { payload: infer Payload }
  ? Omit<Event, 'payload'> & { payload: Omit<Payload, 'reason'> & { reason: Resolution['payload']['reason'] | 'surface' | 'surface_disconnected' } }
  : never;

/** Published companion frames retain the cancellation vocabulary of shipped clients. */
export type CodexWireConversationEvent = Exclude<CodexConversationEvent, Resolution> | WireResolution<Resolution>;

export function codexEventToWire(event: CodexWireConversationEvent): CodexWireConversationEvent {
  if (event.type !== 'approval.resolved' && event.type !== 'clientRequest.resolved') return event;
  const reason = event.payload.reason === 'host' ? 'surface'
    : event.payload.reason === 'host_disconnected' ? 'surface_disconnected' : event.payload.reason;
  return { ...event, payload: { ...event.payload, reason } } as CodexWireConversationEvent;
}

export function codexEventFromWire(event: CodexWireConversationEvent): CodexConversationEvent {
  if (event.type !== 'approval.resolved' && event.type !== 'clientRequest.resolved') return event;
  const reason = event.payload.reason === 'surface' ? 'host'
    : event.payload.reason === 'surface_disconnected' ? 'host_disconnected' : event.payload.reason;
  return { ...event, payload: { ...event.payload, reason } } as CodexConversationEvent;
}
