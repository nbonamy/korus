import { describe, expect, it } from 'vitest';
import { claudeModelOptionsFromSdk } from '../models';

describe('claudeModelOptionsFromSdk', () => {
  it("flags the SDK's default alias so clients can resolve it to the real model", () => {
    const options = claudeModelOptionsFromSdk([
      { value: 'default', displayName: 'Default (recommended)', resolvedModel: 'claude-opus-5-5' },
      { value: 'opus', displayName: 'Opus 5.5', resolvedModel: 'claude-opus-5-5' },
    ]);

    expect(options.map(option => [option.model, option.isDefault === true])).toEqual([['default', true], ['opus', false]]);
    expect(options[0]?.providerMetadata).toEqual({ resolvedModel: 'claude-opus-5-5' });
  });
});
