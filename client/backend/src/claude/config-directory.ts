import { homedir } from 'node:os';
import path from 'node:path';

/** The CLI, SDK child processes, and App's filesystem readers must agree. */
export function claudeConfigDirectory(): string {
  return path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'));
}

/** Explicitly setting the default path changes Claude's credential lookup. */
export function claudeConfigDirectoryOverride(): string | undefined {
  const directory = claudeConfigDirectory();
  return directory === path.join(homedir(), '.claude') ? undefined : directory;
}
