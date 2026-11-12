import { describe, expect, it } from 'vitest';
import { withProductPermissionLabels } from '../runtime-status-labels';

describe('withProductPermissionLabels', () => {
  it('adds the product labels to provider-default permission modes in runtime status events', () => {
    const event = { type: 'provider.statusChanged', provider: 'claude', payload: { provider: 'claude', status: 'running', capabilities: { permissionModes: [{ id: 'default' }, { id: 'acceptEdits', dangerous: false }] } } };
    const labeled = withProductPermissionLabels(event as never) as unknown as { payload: { capabilities: { permissionModes: { id: string; label?: unknown }[] } } };
    expect(labeled.payload.capabilities.permissionModes.map(mode => mode.id)).toEqual(['default', 'acceptEdits']);
    expect(labeled.payload.capabilities.permissionModes.every(mode => mode.label !== undefined)).toBe(true);
  });

  it('leaves other events and statuses without permission modes untouched', () => {
    const other = { type: 'agent.updated', agentId: 'a', payload: {} };
    const noModes = { type: 'provider.statusChanged', provider: 'cursor', payload: { provider: 'cursor', status: 'running' } };
    expect(withProductPermissionLabels(other)).toBe(other);
    expect(withProductPermissionLabels(noModes)).toBe(noModes);
  });
});
