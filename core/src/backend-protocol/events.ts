import type { ClientState, HarnessProvider } from '../contracts';
import type { BackendPublishedEvent } from '../contracts/events';
import { isClientState, isAppSnapshot } from '../snapshot-guards';
import { agentPayloadValidators } from './event-agent-payloads';
import { conversationPayloadValidators } from './event-conversation-payloads';
import { runtimePayloadValidators } from './event-runtime-payloads';
import {
  expectKnownShape,
  expectArray,
  expectLiteral,
  expectOptional,
  expectRecord,
  expectString,
  expectNumber,
  failEventValidation,
  type EventValueValidator,
} from './event-validation';
import { harnessProviders } from '@korus-dev/multi-agent-sdk/contracts';

type AppBackendEventFrom<Event extends BackendPublishedEvent> = Event extends BackendPublishedEvent
  ? Omit<Event, 'source'> & { clientState?: ClientState }
  : never;

export type AppBackendEvent = AppBackendEventFrom<BackendPublishedEvent>;

type AppBackendEventType = AppBackendEvent['type'];

function expectGuestProposal(value: unknown, path: string): void {
  expectRecord(value, path);
  for (const key of ['id', 'handle', 'identity', 'name', 'discriminator', 'text', 'createdAt']) {
    expectString(value[key], `${path}.${key}`);
  }
  expectLiteral(value.status, ['pending', 'queued', 'dispatching', 'dismissed', 'submitted', 'rejected', 'unresolved'], `${path}.status`);
  expectOptional(value, 'messageId', path, expectString);
  expectOptional(value, 'turnId', path, expectString);
}

function expectGuestAuthor(value: unknown, path: string): void {
  expectRecord(value, path);
  for (const key of ['messageId', 'identity', 'name', 'discriminator']) {
    expectString(value[key], `${path}.${key}`);
  }
}

const payloadValidators = {
  'conversation.shareChanged': (value: unknown, path: string) => {
    expectRecord(value, path);
    if (Object.keys(value).some(key => !['active', 'handle', 'connectedGuests', 'availability', 'proposals', 'authors', 'guests'].includes(key))) failEventValidation(path, 'unexpected share state field');
    if (typeof value.active !== 'boolean' || (value.handle !== null && (typeof value.handle !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(value.handle)))
      || (value.connectedGuests !== null && (typeof value.connectedGuests !== 'number' || !Number.isSafeInteger(value.connectedGuests) || value.connectedGuests < 0))) failEventValidation(path, 'invalid share state');
    expectLiteral(value.availability, ['transportPending', 'notConfigured', 'ready', 'unavailable', 'capacity', 'rateLimited', 'upgradeRequired'], `${path}.availability`);
    expectOptional(value, 'proposals', path, (items, itemsPath) => expectArray(items, itemsPath, expectGuestProposal));
    expectOptional(value, 'authors', path, (items, itemsPath) => expectArray(items, itemsPath, expectGuestAuthor));
    expectOptional(value, 'guests', path, (items, itemsPath) => expectArray(items, itemsPath, (guest, guestPath) => {
      expectRecord(guest, guestPath);
      for (const key of ['identity', 'name', 'discriminator']) expectString(guest[key], `${guestPath}.${key}`);
      if (typeof guest.writeAccess !== 'boolean') failEventValidation(guestPath, 'invalid guest access');
    }));
  },
  ...runtimePayloadValidators,
  ...agentPayloadValidators,
  ...conversationPayloadValidators,
} satisfies Record<AppBackendEventType, EventValueValidator>;

type EventRecord = Record<string, unknown> & { type: AppBackendEventType };

function expectRequiredString(
  event: Record<string, unknown>,
  key: string,
): void {
  expectString(event[key], `$.${key}`);
}

function expectRequiredProvider(
  event: Record<string, unknown>,
  provider?: HarnessProvider,
): void {
  expectLiteral(
    event.provider,
    provider ? [provider] : harnessProviders,
    '$.provider',
  );
}

function expectAgent(event: Record<string, unknown>): void {
  expectRequiredString(event, 'agentId');
}

function expectHarnessProvider(
  event: Record<string, unknown>,
  provider?: HarnessProvider,
): void {
  expectAgent(event);
  expectRequiredProvider(event, provider);
}

function expectTurnContext(
  event: Record<string, unknown>,
  threadRequired: boolean,
): void {
  expectHarnessProvider(event);
  expectRequiredString(event, 'turnId');
  if (threadRequired) expectRequiredString(event, 'threadId');
}

function expectEventContext(event: EventRecord): void {
  switch (event.type) {
    case 'provider.statusChanged':
    case 'account.rateLimitsUpdated':
    case 'models.changed':
    case 'skills.changed':
      expectRequiredProvider(event);
      return;
    case 'client.markdownDisplayRequested':
    case 'plan.reviewResolved':
    case 'client.celebrationRequested':
    case 'agentCreation.progress':
    case 'git.branchWorkProgress':
    case 'git.operationProgress':
    case 'conversation.shareChanged':
    case 'agent.updated':
    case 'agent.statusChanged':
    case 'conversation.goalCleared':
    case 'conversation.historyLoadFailed':
    case 'agent.promptQueued':
    case 'agent.promptRetryScheduled':
    case 'agent.promptDequeued':
    case 'git.statusUpdated':
      expectAgent(event);
      return;
    case 'plan.readyForReview':
      expectAgent(event);
      expectRequiredString(event, 'turnId');
      return;
    case 'agent.conversationAttached':
      expectHarnessProvider(event);
      expectRequiredString(event, 'conversationId');
      return;
    case 'conversation.settingsUpdated':
      expectHarnessProvider(event);
      return;
    case 'conversation.modeUpdated':
      expectHarnessProvider(event);
      return;
    case 'conversation.goalUpdated':
      expectAgent(event);
      return;
    case 'conversation.contextUsageUpdated':
    case 'subagent.operationChanged':
    case 'subagent.activityChanged':
    case 'subagent.identityChanged':
    case 'subagent.statusChanged':
      expectHarnessProvider(event);
      return;
    case 'conversation.turnDiffUpdated':
    case 'workspace.fileActivityDetected':
      expectTurnContext(event, false);
      return;
    case 'agentRequest.created':
    case 'agentRequest.resolved':
      expectHarnessProvider(event);
      return;
    case 'snapshot.updated':
    case 'provider.authenticationChanged':
    case 'remoteControl.statusChanged':
    case 'browser.annotationCreated':
    case 'mission.implementationStartProgress':
    case 'mission.focusRequested':
    case 'workItem.assignmentUpdated':
      return;
  }
}

export function decodeAppBackendEvent(value: unknown): AppBackendEvent {
  expectRecord(value, '$');
  expectNumber(value.seq, '$.seq');
  expectString(value.occurredAt, '$.occurredAt');
  if (typeof value.type !== 'string' || !(value.type in payloadValidators)) {
    failEventValidation('$.type', 'expected a supported event type');
  }
  const event = value as EventRecord;
  expectOptional(event, 'agentId', '$', expectString);
  expectOptional(event, 'provider', '$', (candidate, path) =>
    expectLiteral(candidate, harnessProviders, path),
  );
  expectOptional(event, 'providerSessionId', '$', expectString);
  expectOptional(event, 'conversationId', '$', expectString);
  expectOptional(event, 'threadId', '$', expectString);
  expectOptional(event, 'turnId', '$', expectString);
  expectOptional(event, 'snapshot', '$', (candidate, path) => {
    expectKnownShape(
      candidate,
      path,
      isAppSnapshot,
      'full application snapshot',
    );
  });
  expectOptional(event, 'clientState', '$', (candidate, path) => {
    expectKnownShape(candidate, path, isClientState, 'client state');
  });
  payloadValidators[event.type](event.payload, '$.payload');
  expectEventContext(event);
  return value as AppBackendEvent;
}
