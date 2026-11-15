import { describe, expect, it } from 'vitest';
import { computerUsePluginId } from '@workspace/core/app-plugins';
import { product } from '@workspace/core/product';
import { promptWithSelectedReferences } from '../prompt-content';

const computerUse = { type: 'mention' as const, kind: 'plugin' as const, id: computerUsePluginId, value: 'computer-use', label: '@Computer Use' };

describe('promptWithSelectedReferences', () => {
  it.each([false, true])('tells the model what the Computer Use reference asks for, whether or not the harness sends mentions natively (%s)', native => {
    const prompt = promptWithSelectedReferences('@Computer Use open Safari', [computerUse, { type: 'text', text: ' open Safari' }], native);

    expect(prompt).toContain('<context>');
    expect(prompt).toContain(computerUsePluginId);
    expect(prompt).toContain(`load korus-computer-use and use only ${product.mcpServerName} Computer Use tools`);
  });
});
