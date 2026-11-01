import { describe, expect, it } from 'vitest';
import { remoteEngineLinkCommand } from '../remote-engine-links';

describe('remote engine links', () => {
  it('links codex and claude into the private bin and looks past that bin to find them', () => {
    const command = remoteEngineLinkCommand();
    expect(command).toContain('for engine in codex claude;');
    expect(command).toContain('ln -sfn "$target" "$bin/$engine"');
    expect(command).toContain('rm -f "$bin/$engine"');
    expect(command.indexOf('grep -vxF "$bin"')).toBeLessThan(command.indexOf('command -v'));
    expect(command).not.toContain('--version');
  });
});
