import { product } from '@workspace/core/product';
import { lstat, mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ProviderHomeSettings } from '@workspace/core/contracts/provider-setup';
import { resolveClaudeExecutable } from './claude-command';
import { providerHomePaths, type ProviderLifecycle } from '../provider-lifecycle';

export function createClaudeLifecycle(): ProviderLifecycle {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  const paths = providerHomePaths('claude', configured);
  return {
    skillDirectories: home => [path.join(home.homePath, 'skills')],
    home(snapshot, choice) {
      if (choice) return { ...choice, homePath: choice.isolated ? paths.isolated : paths.existing };
      const preserve = snapshot.general.claudeCodeEnabled || snapshot.agents.some(agent => agent.backend === 'claude');
      const homePath = preserve ? path.resolve(configured || paths.existing) : paths.existing;
      return { homePath, isolated: homePath === paths.isolated, shareSkills: !preserve };
    },
    installed: () => Boolean(resolveClaudeExecutable()),
    async prepareHome(home, configuring) {
      const requestedSharing = home.shareSkills;
      await prepareClaudeHome(home, paths.existing);
      if (configuring && requestedSharing && !home.shareSkills) {
        throw new Error(`This ${product.name} home already has private skills. They were kept; disable skill sharing to continue.`);
      }
    },
    applyHome: home => { process.env.CLAUDE_CONFIG_DIR = home.homePath; },
  };
}

async function prepareClaudeHome(home: ProviderHomeSettings, existingHome: string): Promise<void> {
    await mkdir(home.homePath, { recursive: true, mode: 0o700 });
    if (!home.isolated) return;
    const source = path.join(existingHome, 'skills');
    const target = path.join(home.homePath, 'skills');
    if (source === target) return;
    const current = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    // Existing private skills belong to the user. Never replace them during onboarding.
    if (current && !current.isSymbolicLink()) { home.shareSkills = false; return; }
    const linked = current ? path.resolve(path.dirname(target), await readlink(target)) : null;
    if (linked && linked !== source) { home.shareSkills = false; return; }
    if (home.shareSkills && !current) await symlink(path.resolve(source), target, process.platform === 'win32' ? 'junction' : 'dir');
    if (!home.shareSkills && linked === source) await unlink(target);
}
