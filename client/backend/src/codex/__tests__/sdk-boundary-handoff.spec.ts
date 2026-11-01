import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import { codexSdkFixture, sdkAgent } from './sdk-surface-fixture';

describe('Codex handoff readiness', () => {
  it(`checks SDK-owned busy state even when the ${product.name} agent is idle`, async () => {
    const fixture = codexSdkFixture();
    const agent = sdkAgent();
    fixture.conversation('conversation-a').setSnapshot({ busy: true, activeTurnId: 'ongoing' });
    await expect(fixture.driver.assertHandoffReady(agent)).rejects.toThrow('Codex turn');
    fixture.conversation('conversation-a').setSnapshot({ busy: false, activeTurnId: null });
    await expect(fixture.driver.assertHandoffReady(agent)).resolves.toBeUndefined();
    expect(fixture.conversation('conversation-a').handle.sendMessage).not.toHaveBeenCalled();
    await fixture.driver.close();
  });
});
