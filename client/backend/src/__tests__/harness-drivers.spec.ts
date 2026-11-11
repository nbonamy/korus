import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultProviderDrivers } from '../driver-rpc';

const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { for (const driver of opened.splice(0)) await driver.close(); });

describe('Korus provider drivers over the SDK Harness', () => {
  it('creates a driver for every provider without starting any runtime', () => {
    const drivers = createDefaultProviderDrivers({});
    opened.push(...drivers.values());
    expect([...drivers.keys()].sort()).toStrictEqual(['antigravity', 'claude', 'codex', 'cursor']);
    for (const [provider, driver] of drivers) {
      expect(driver.provider).toBe(provider);
      expect(driver.getRuntimeStatus()).toMatchObject({ provider });
    }
  });

  it('reports provider capabilities Korus layers its own review and share rules over', () => {
    const drivers = createDefaultProviderDrivers({});
    opened.push(...drivers.values());
    const agent = { id: 'a', name: 'A', folder: '/work', provider: 'cursor', status: { type: 'idle' }, avatar: 'A', createdAt: '', updatedAt: '' } as never;
    expect(drivers.get('cursor')!.getCapabilities(agent)).toMatchObject({ codeReview: true, planReview: true, conversationShare: false });
    expect(drivers.get('claude')!.getCapabilities({ ...(agent as object), provider: 'claude' } as never)).toMatchObject({ codeReview: true, conversationShare: true });
  });
});
