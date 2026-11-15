import { describe, expect, it } from 'vitest';
import { computerUsePlugin, computerUsePluginId, isAppPlugin } from '../app-plugins';

describe('app plugins', () => {
  it("lists Korus's Computer Use under the id the harness is told is the app's own", () => {
    expect(isAppPlugin(computerUsePluginId)).toBe(true);
    expect(computerUsePlugin).toMatchObject({ id: computerUsePluginId, displayName: 'Computer Use', enabled: true });
  });
});
