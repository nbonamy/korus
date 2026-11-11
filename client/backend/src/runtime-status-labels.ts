import { defaultProviderCapabilities } from '@workspace/core/provider-capabilities';
import type { ProviderCapabilities } from '@workspace/core/contracts';
import type { HarnessProvider } from '@workspace/core/contracts/shared';

/** SDK runtime status carries provider-default permission modes; the product owns their labels. */
export function withProductPermissionLabels<Event extends { type: string }>(event: Event): Event {
  if (event.type !== 'provider.statusChanged') return event;
  const status = event as unknown as { provider: HarnessProvider; payload: { capabilities?: ProviderCapabilities } };
  const modes = status.payload.capabilities?.permissionModes;
  if (!modes) return event;
  const labeled = defaultProviderCapabilities(status.provider).permissionModes ?? [];
  const permissionModes = modes.map(mode => ({ ...labeled.find(candidate => candidate.id === mode.id), ...mode }));
  return { ...event, payload: { ...status.payload, capabilities: { ...status.payload.capabilities, permissionModes } } } as Event;
}
