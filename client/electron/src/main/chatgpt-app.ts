import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { LaunchChatGptAppInput, LaunchChatGptAppResult } from '@workspace/core/contracts';
import { runtimeDaemonHome } from './runtime-config';

const defaultChatGptAppPath = '/Applications/ChatGPT.app';
const defaultOpenCommand = '/usr/bin/open';
const defaultProcessLookupCommand = '/usr/bin/pgrep';
const defaultQuitCommand = '/usr/bin/osascript';
const processExitPollIntervalMs = 100;
const processExitPollAttempts = 50;
const execFile = promisify(execFileCallback);

export type ChatGptAppDependencies = {
  appPath?: string;
  appHome?: string;
  execFile?: (command: string, args: readonly string[]) => Promise<unknown>;
  existsSync?: (filePath: string) => boolean;
  openCommand?: string;
  platform?: NodeJS.Platform;
  wait?: (milliseconds: number) => Promise<unknown>;
};

export async function launchChatGptApp(
  input: LaunchChatGptAppInput = {},
  dependencies: ChatGptAppDependencies = {},
): Promise<LaunchChatGptAppResult> {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'darwin') {
    throw new Error('Launching the ChatGPT app is only supported on macOS.');
  }

  const appPath = dependencies.appPath ?? defaultChatGptAppPath;
  const fileExists = dependencies.existsSync ?? existsSync;
  if (!fileExists(appPath)) {
    throw new Error(`ChatGPT is not installed at ${appPath}.`);
  }

  const run = dependencies.execFile ?? execFile;
  if (await isChatGptRunning(run)) {
    if (input.quitRunning !== true) return { status: 'alreadyRunning' };
    await quitChatGptApp(run, dependencies.wait ?? wait);
  }

  const appHome = dependencies.appHome ?? runtimeDaemonHome();
  const codexHome = path.join(appHome, 'codex-home');
  await run(dependencies.openCommand ?? defaultOpenCommand, [
    '-n',
    '--env',
    `CODEX_HOME=${codexHome}`,
    '-a',
    appPath,
  ]);
  return { status: 'launched' };
}

async function isChatGptRunning(run: NonNullable<ChatGptAppDependencies['execFile']>): Promise<boolean> {
  try {
    await run(defaultProcessLookupCommand, ['-x', 'ChatGPT']);
    return true;
  } catch (error) {
    if (processLookupFoundNoMatches(error)) return false;
    throw error;
  }
}

function processLookupFoundNoMatches(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 1 || error.code === '1';
}

async function quitChatGptApp(
  run: NonNullable<ChatGptAppDependencies['execFile']>,
  pause: NonNullable<ChatGptAppDependencies['wait']>,
): Promise<void> {
  await run(defaultQuitCommand, ['-e', 'tell application "ChatGPT" to quit']);
  for (let attempt = 0; attempt < processExitPollAttempts; attempt += 1) {
    if (!await isChatGptRunning(run)) return;
    await pause(processExitPollIntervalMs);
  }
  throw new Error('ChatGPT did not quit. Quit it manually, then try again.');
}
