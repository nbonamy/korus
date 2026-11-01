#!/usr/bin/env node

import product from '../../../core/src/product.json' with { type: 'json' };

import { spawnSync } from 'node:child_process';
import { copyFile, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCodexSurface } from '@codex-app-sdk/backend';

const scriptFolder = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptFolder, '..', '..', '..');
const defaultStatePath = path.join(homedir(), product.homeDirectory, 'roster.json');
const defaultCodexHome = path.join(homedir(), product.homeDirectory, 'codex-home');
const stateArchiveEntries = [`${product.homeDirectory}/roster.json`, `${product.homeDirectory}/state.json`];

export function parseRecoveryArguments(argv) {
  const args = [...argv];
  const dryRunIndex = args.indexOf('--dry-run');
  const dryRun = dryRunIndex >= 0;
  if (dryRun) args.splice(dryRunIndex, 1);
  if (args.length !== 2) {
    throw new Error(
      'Usage: node client/backend/scripts/recover-compressed-session.mjs [--dry-run] <backup.tar> <agent-folder>',
    );
  }
  return { backupPath: path.resolve(args[0]), agentFolder: path.resolve(args[1]), dryRun };
}

export function agentRecovery(currentState, backupState, agentFolder) {
  const currentAgent = uniqueCodexAgent(currentState, agentFolder, 'current');
  const backupAgent = uniqueCodexAgent(backupState, agentFolder, 'backup');
  if (currentAgent.id !== backupAgent.id) {
    throw new Error(`Agent identity differs between current state and backup for ${agentFolder}.`);
  }
  const currentThreadId = codexThreadId(currentAgent, 'current');
  const recoveredThreadId = codexThreadId(backupAgent, 'backup');
  return { currentAgent, currentThreadId, recoveredThreadId };
}

// Current state is roster.json ({ data: { agents: [{ engine }] } }); backups of older builds hold state.json
// ({ agents: [{ backend, backendSession }] }). Both shapes are understood.
function agentsOf(state) {
  if (Array.isArray(state?.data?.agents)) return state.data.agents;
  return Array.isArray(state?.agents) ? state.agents : null;
}

function isCodexAgent(agent) {
  return agent?.engine?.kind === 'codex' || agent?.backend === 'codex';
}

export function stateWithRecoveredThread(currentState, agentId, recoveredThreadId, now) {
  const recovered = (agent) => (agent.engine
    ? { ...agent, engine: { ...agent.engine, session: { threadId: recoveredThreadId } }, updatedAt: now }
    : { ...agent, backendSession: { kind: 'codex', threadId: recoveredThreadId }, updatedAt: now });
  const replace = (agents) => agents.map((agent) => (agent.id === agentId ? recovered(agent) : agent));
  return Array.isArray(currentState.data?.agents)
    ? { ...currentState, data: { ...currentState.data, agents: replace(currentState.data.agents) } }
    : { ...currentState, agents: replace(currentState.agents) };
}

async function main() {
  const { backupPath, agentFolder, dryRun } = parseRecoveryArguments(process.argv.slice(2));
  await stat(backupPath);
  const statePath = process.env.APP_STATE_PATH?.trim() || defaultStatePath;
  const codexHome = process.env.APP_CODEX_HOME?.trim() || defaultCodexHome;
  const currentState = JSON.parse(await readFile(statePath, 'utf8'));
  const backupState = readBackupState(backupPath);
  const { currentAgent, currentThreadId, recoveredThreadId } = agentRecovery(
    currentState,
    backupState,
    agentFolder,
  );

  console.log(`Agent: ${currentAgent.id} (${agentFolder})`);
  console.log(`Current thread: ${currentThreadId}`);
  console.log(`Recovered thread: ${recoveredThreadId}`);
  if (dryRun) {
    console.log('Dry run complete; no files or conversations were changed.');
    return;
  }

  assertAppStopped();
  const codexCommand = await resolveCodexCommand(statePath);
  const surface = createCodexSurface({
    autoSelectFirstConversation: false,
    codexHome,
    transport: { command: codexCommand },
  });
  try {
    await surface.connect();
    await surface.unarchiveConversation(recoveredThreadId);
  } finally {
    await surface.close();
  }

  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const safetyCopyPath = `${statePath}.before-session-recovery-${timestamp}`;
  await copyFile(statePath, safetyCopyPath);
  const nextState = stateWithRecoveredThread(
    currentState,
    currentAgent.id,
    recoveredThreadId,
    new Date().toISOString(),
  );
  const stateInfo = await stat(statePath);
  const temporaryPath = `${statePath}.recovery-${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, {
    mode: stateInfo.mode,
    flag: 'wx',
  });
  await rename(temporaryPath, statePath);

  console.log(`Recovered ${agentFolder} to ${recoveredThreadId}.`);
  console.log(`Safety copy: ${safetyCopyPath}`);
}

function readBackupState(backupPath) {
  const failures = [];
  for (const entry of stateArchiveEntries) {
    const result = spawnSync('tar', ['-xOf', backupPath, entry], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status === 0) return JSON.parse(result.stdout);
    failures.push(`${entry}: ${result.stderr.trim()}`);
  }
  throw new Error(`Could not read the state from ${backupPath} (${failures.join('; ')})`);
}

function uniqueCodexAgent(state, agentFolder, source) {
  const agents = agentsOf(state);
  if (!agents) {
    throw new Error(`The ${source} state does not contain an agents array.`);
  }
  const matches = agents.filter((agent) => (
    isCodexAgent(agent)
    && [agent.folder, agent.workspace?.folder, agent.workspace?.repositoryRoot]
      .some((folder) => typeof folder === 'string' && path.resolve(folder) === agentFolder)
  ));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Codex agent for ${agentFolder} in ${source} state; found ${matches.length}.`);
  }
  return matches[0];
}

function codexThreadId(agent, source) {
  const threadId = agent.engine?.kind === 'codex'
    ? agent.engine.session?.threadId
    : agent.backendSession?.kind === 'codex' ? agent.backendSession.threadId : null;
  if (typeof threadId !== 'string' || !threadId.trim()) {
    throw new Error(`The ${source} agent does not have a Codex thread id.`);
  }
  return threadId;
}

function assertAppStopped() {
  const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Could not verify that ${product.name} is stopped: ${result.stderr.trim()}`);
  }
  const active = result.stdout.split('\n').filter((line) => (
    !line.includes('recover-compressed-session.mjs')
    && (
      line.includes(`/${product.name}.app/Contents/MacOS/${product.name}`)
      || line.includes(`/${product.name}.app/Contents/Resources/daemon/daemon.mjs`)
      || line.includes('/dist/daemon.mjs')
      || line.includes('/scripts/dev.mjs')
    )
  ));
  if (active.length > 0) {
    throw new Error(`${product.name} is still running. Quit the release build and npm run dev before recovery.`);
  }
}

async function configuredCodexBinary(statePath) {
  for (const [file, read] of [
    ['settings.json', (value) => value?.data?.settings?.codexBinaryPath],
    [path.basename(statePath), (value) => value?.general?.codexBinaryPath],
  ]) {
    try {
      const value = read(JSON.parse(await readFile(path.join(path.dirname(statePath), file), 'utf8')));
      if (typeof value === 'string' && value.trim()) return value;
    } catch {
      // Try the next location.
    }
  }
  return undefined;
}

async function resolveCodexCommand(statePath) {
  const configured = (await configuredCodexBinary(statePath))?.trim();
  if (configured) return configured;
  const bundled = path.join(repositoryRoot, 'electron', 'resources', 'codex', 'codex');
  try {
    await stat(bundled);
    return bundled;
  } catch {
    return undefined;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
