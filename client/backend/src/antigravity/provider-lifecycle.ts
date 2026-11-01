import { lstat, mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProviderLifecycle } from '../provider-lifecycle';
import { backendHomeDir } from '../state';
import { resolveAcpRuntime } from './runtime';
import { installAcpRuntime } from './installer';

export function createAntigravityLifecycle(): ProviderLifecycle {
  const isolated = path.join(backendHomeDir(), 'antigravity-home');
  const existing = process.env.GEMINI_HOME && path.resolve(process.env.GEMINI_HOME) !== isolated
    ? path.resolve(process.env.GEMINI_HOME) : path.join(homedir(), '.gemini');
  return {
    skillDirectories: home => ['config', 'antigravity-cli'].map(directory => path.join(home.homePath, directory, 'skills')),
    home: (_snapshot, choice = { isolated: true, shareSkills: false }) => ({ ...choice, homePath: choice.isolated ? isolated : existing }),
    installed: () => Boolean(resolveAcpRuntime()),
    install: installAcpRuntime,
    async prepareHome(home, configuring) {
      await mkdir(home.homePath, { recursive: true, mode: 0o700 });
      if (!home.isolated) return;
      const directories = await Promise.all(['config', 'antigravity-cli'].map(async directory => {
        const source = path.join(existing, directory, 'skills');
        const target = path.join(home.homePath, directory, 'skills');
        const current = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
        const linked = current?.isSymbolicLink() ? path.resolve(path.dirname(target), await readlink(target)) : null;
        return { source, target, current, linked };
      }));
      if (directories.some(({ current, linked, source }) => current && linked !== source)) {
        if (configuring && home.shareSkills) throw new Error('Private Antigravity skills were preserved. Disable sharing to continue.');
        home.shareSkills = false;
      }
      for (const { source, target, current, linked } of directories) {
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        if (home.shareSkills && !current) await symlink(source, target, 'dir');
        if (!home.shareSkills && linked === source) await unlink(target);
      }
    },
    applyHome: home => { process.env.GEMINI_HOME = home.homePath; },
  };
}
