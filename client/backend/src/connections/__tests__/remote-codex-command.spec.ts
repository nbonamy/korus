import { product } from '@workspace/core/product';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { remoteCodexVersionCommand } from '../remote-codex-command';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('remote Codex version discovery', () => {
  function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'app-remote-version-'));
    roots.push(root);
    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    mkdirSync(path.join(root, product.homeDirectory));
    symlinkSync(process.execPath, path.join(bin, 'node'));
    const install = (relativePath: string, version: string) => {
      const binary = path.join(root, relativePath);
      mkdirSync(path.dirname(binary), { recursive: true });
      writeFileSync(binary, `#!/bin/sh\nprintf 'codex-cli ${version}\\n'\n`, { mode: 0o755 });
      return binary;
    };
    const probe = () => spawnSync('/bin/sh', ['-c', remoteCodexVersionCommand()], {
      encoding: 'utf8', env: { HOME: root, PATH: bin },
    });
    return { root, install, probe };
  }

  it('ignores leftover app-managed binaries and detects the user CLI on PATH', () => {
    const { install, probe } = fixture();
    install(`${product.homeDirectory}/codex/0.159.3/bin/codex`, '0.159.3');
    expect(probe()).toMatchObject({ status: 0, stdout: '' });
    install('bin/codex', '0.160.0');
    expect(probe()).toMatchObject({ status: 0, stdout: 'codex-cli 0.160.0\n' });
  });

  it('honors a custom executable with spaces and does not hide a broken override with PATH', () => {
    const { root, install, probe } = fixture();
    install('bin/codex', '0.160.0');
    const custom = install('custom tools/codex', '0.100.0');
    writeFileSync(path.join(root, product.homeDirectory, 'settings.json'), JSON.stringify({ data: { settings: { codexBinaryPath: custom } } }));
    expect(probe()).toMatchObject({ status: 0, stdout: 'codex-cli 0.100.0\n' });
    rmSync(custom);
    expect(probe().status).not.toBe(0);
  });
});
