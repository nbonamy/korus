import { describe, expect, it } from 'vitest';
import { readChromePluginStatus } from '../plugin-status';

describe('readChromePluginStatus', () => {
  it('reads the enabled value from the Chrome plugin section', () => {
    expect(readChromePluginStatus('[plugins."chrome@openai-bundled"]\nenabled = true')).toEqual({ chromeEnabled: true });
    expect(readChromePluginStatus('[plugins."chrome@openai-bundled"]\nenabled = false')).toEqual({ chromeEnabled: false });
  });

  it('does not treat another plugin section as Chrome status', () => {
    expect(readChromePluginStatus('[plugins."other@openai-bundled"]\nenabled = true')).toEqual({ chromeEnabled: false });
  });

  it('defaults to disabled when Chrome has no explicit enabled value', () => {
    expect(readChromePluginStatus('[plugins."chrome@openai-bundled"]\n')).toEqual({ chromeEnabled: false });
  });
});
