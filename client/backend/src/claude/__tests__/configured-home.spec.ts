import { access, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@workspace/core/contracts';
import type { BackendEvent } from '@workspace/core/backend-driver';
import { ClaudeBackendDriver } from '../claude-driver';
import { ClaudeAgentSdkTransport } from '../agent-sdk-transport';
import { createQueryHarness } from './sdk-query-fixture';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const homedir = () => process.env.APP_TEST_USER_HOME!;
  return { ...actual, homedir, default: { ...actual, homedir } };
});

vi.mock('@workspace/core/runtime-discovery', () => ({
  resolveRuntimeLaunch: (command: string, env: NodeJS.ProcessEnv | undefined) => ({ command, env: { ...process.env, ...env } }),
}));

// Claude names project directories by replacing every non-alphanumeric character
// (temp dirs on macOS CI contain underscores).
const claudeProjectDirName = (folder: string) => folder.replace(/[^a-zA-Z0-9]/g, '-');

describe('Claude configured home', () => {
  let root: string;
  let configDir: string;
  const drivers: ClaudeBackendDriver[] = [];

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'app-claude-home-')));
    configDir = path.join(root, 'app', 'claude-home');
    vi.stubEnv('APP_TEST_USER_HOME', path.join(root, 'personal'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', configDir);
  });

  afterEach(async () => {
    await Promise.all(drivers.splice(0).map(driver => driver.close()));
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it.each([false, true])('reads saved history and resumes after restart (symlinked workspace: %s)', async (linkedWorkspace) => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const agent: Agent = {
      id: 'claude-home-test', name: 'Claude', backend: 'claude', folder: path.join(root, 'repo'),
      backendSession: { kind: 'claude', sessionId, transport: 'stdio' },
      status: { type: 'idle' }, createdAt: '', updatedAt: '',
    };
    const recordedCwd = linkedWorkspace ? path.join(root, 'physical-repo') : agent.folder!;
    await mkdir(recordedCwd, { recursive: true });
    if (linkedWorkspace) await symlink(recordedCwd, agent.folder!, 'dir');
    // Claude records the physical cwd even when App opens the workspace through a symlink.
    const projectDir = path.join(configDir, 'projects', claudeProjectDirName(recordedCwd));
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), JSON.stringify({
      type: 'user', uuid: 'saved-message', sessionId,
      message: { role: 'user', content: 'remember this before restart' },
    }) + '\n');

    for (let restart = 0; restart < 2; restart += 1) {
      const sdk = createQueryHarness();
      const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }));
      drivers.push(driver);
      const events: BackendEvent[] = [];
      driver.onEvent(event => events.push(event));
      await driver.loadConversation(agent);
      const reset = events.find(event => event.type === 'claude.conversationSnapshotChanged');
      expect(reset).toMatchObject({ payload: { snapshot: { messages: [
        expect.objectContaining({ parts: [{ type: 'text', text: 'remember this before restart' }] }),
      ] } } });
      if (linkedWorkspace && restart === 0) {
        // Older CLI versions may also have left a copy under the logical path.
        const legacyDir = path.join(configDir, 'projects', claudeProjectDirName(agent.folder!));
        await mkdir(legacyDir, { recursive: true });
        await copyFile(path.join(projectDir, `${sessionId}.jsonl`), path.join(legacyDir, `${sessionId}.jsonl`));
      }
      expect(await driver.listConversations(agent)).toEqual([
        expect.objectContaining({ id: sessionId, title: 'remember this before restart' }),
      ]);
      const sending = driver.sendPrompt(agent, 'continue');
      await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
      expect(sdk.options.at(-1)).toMatchObject({ resume: sessionId, env: { CLAUDE_CONFIG_DIR: configDir } });
      sdk.emit({ type: 'system', subtype: 'init', session_id: sessionId });
      await sending;
      sdk.emit({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false });
      await driver.close();
    }
  });

  it('does not introduce a custom authentication home for sessions using the default setup', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(process.env.APP_TEST_USER_HOME!, '.claude'));
    const sdk = createQueryHarness();
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }));
    drivers.push(driver);
    const sending = driver.sendPrompt({
      id: 'default-home', name: null, backend: 'claude', folder: root,
      status: { type: 'idle' }, createdAt: '', updatedAt: '',
    }, 'hello');
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'default-session' });
    await sending;
    expect(sdk.options.at(-1)?.env?.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('offers shared symlinked skills from the configured home without exposing unrelated personal skills', async () => {
    const shared = path.join(root, 'personal', 'skills', 'shared');
    await mkdir(shared, { recursive: true });
    await writeFile(path.join(shared, 'SKILL.md'), '---\nname: shared\ndescription: Shared skill\n---\n');
    await mkdir(path.join(configDir, 'skills'), { recursive: true });
    await symlink(shared, path.join(configDir, 'skills', 'shared'), 'dir');
    await symlink(path.join(root, 'missing'), path.join(configDir, 'skills', 'broken'), 'dir');
    await symlink(path.join(shared, 'SKILL.md'), path.join(configDir, 'skills', 'not-a-directory'), 'file');
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: createQueryHarness().createQuery }));
    drivers.push(driver);
    const skills = await driver.listSkills({
      id: 'quick', name: null, backend: 'claude', folder: null, sessionKind: 'quickChat',
      status: { type: 'idle' }, createdAt: '', updatedAt: '',
    });
    expect(skills).toEqual([expect.objectContaining({ name: 'shared', scope: 'user',
      path: path.join(configDir, 'skills', 'shared', 'SKILL.md'),
    })]);
  });

  it('deletes a review session only from the configured home through the installed SDK', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const cwd = path.join(root, 'repo');
    const paths = [configDir, path.join(root, 'personal', '.claude')].map(home =>
      path.join(home, 'projects', claudeProjectDirName(cwd), `${sessionId}.jsonl`));
    for (const file of paths) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, 'original\n');
    }
    const transport = new ClaudeAgentSdkTransport();
    try {
      await transport.deleteSession(sessionId, cwd);
      await expect(access(paths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(paths[1]!, 'utf8')).resolves.toBe('original\n');
    } finally {
      await transport.close();
    }
  });

  it('streams private plan writes from the configured home as proposed plans', async () => {
    const sdk = createQueryHarness();
    const driver = new ClaudeBackendDriver(new ClaudeAgentSdkTransport({ createQuery: sdk.createQuery }));
    drivers.push(driver);
    const events: BackendEvent[] = [];
    driver.onEvent(event => events.push(event));
    const started = driver.sendPrompt({
      id: 'planner', name: 'Planner', backend: 'claude', folder: root,
      status: { type: 'idle' }, createdAt: '', updatedAt: '',
    }, 'plan it', { planMode: true });
    await vi.waitFor(() => expect(sdk.inputs).toHaveLength(1));
    sdk.emit({ type: 'system', subtype: 'init', session_id: 'plan-session' });
    await started;
    sdk.emit({ type: 'stream_event', session_id: 'plan-session', event: {
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 'plan-write', name: 'Write', input: {} },
    } });
    sdk.emit({ type: 'stream_event', session_id: 'plan-session', event: {
      type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify({
        file_path: path.join(configDir, 'plans', 'draft.md'), content: '# Isolated plan',
      }) },
    } });
    await vi.waitFor(() => expect(events.filter(event => event.type === 'claude.conversationEventReceived')
      .map(event => event.payload.event)).toContainEqual(expect.objectContaining({
        type: 'turn.proposedPlanDelta', payload: expect.objectContaining({ delta: '# Isolated plan' }),
      })));
    sdk.emit({ type: 'result', subtype: 'success', session_id: 'plan-session', is_error: false });
  });
});
