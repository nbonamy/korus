import { product } from '@workspace/core/product';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computerUseSessionTimeoutMs, executeComputerUseCommand, getComputerUseStatus, isComputerUseCommand, resolveComputerUseHelperAppPath, stopComputerUseHelper } from '../computer-use-tools';

describe('Computer Use desktop helper', () => {
  let tempDir: string;
  let pilotPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-computer-use-'));
    pilotPath = path.join(tempDir, 'pilot');
    fs.writeFileSync(pilotPath, `#!/usr/bin/env node
let input = '';
let stateRevision = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  let newline = input.indexOf('\\n');
  while (newline >= 0) {
    const request = JSON.parse(input.slice(0, newline));
    input = input.slice(newline + 1);
    if (request.arguments?.failCode) {
      process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: { code: request.arguments.failCode, message: 'Action failed.' } }) + '\\n');
      newline = input.indexOf('\\n');
      continue;
    }
    const state = request.command === 'get_app_state'
      ? { stateKind: stateRevision === 0 ? 'full' : 'diff', stateRevision: ++stateRevision, ...(stateRevision > 1 ? { baseRevision: stateRevision - 1 } : {}) }
      : {};
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { command: request.command, arguments: request.arguments, accessibilityTrusted: false, pid: process.pid, version: '2.0.0', ...state } }) + '\\n');
    newline = input.indexOf('\\n');
  }
});
`, 'utf8');
    fs.chmodSync(pilotPath, 0o755);
  });

  afterEach(() => {
    stopComputerUseHelper();
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it('keeps the Computer Use session alive for thirty seconds by default', () => {
    expect(computerUseSessionTimeoutMs).toBe(30_000);
  });

  it('runs the product-neutral pilot through a narrow command contract', async () => {
    await expect(executeComputerUseCommand({
      command: 'get_app_state',
      arguments: { app: 'TextEdit', window_id: 1 },
      options: options(),
    })).resolves.toMatchObject({
      ok: true,
      result: {
        accessibilityTrusted: false,
        arguments: { app: 'TextEdit', window_id: 1 },
        command: 'get_app_state',
      },
    });
  });

  it('reports the helper status through the bundled helper instead of Electron Accessibility state', async () => {
    await expect(getComputerUseStatus(options())).resolves.toMatchObject({
      accessibilityTrusted: false,
      available: true,
      helperVersion: '2.0.0',
      helperPath: pilotPath,
      platform: 'darwin',
    });
  });

  it.each([
    'press_key',
    'drag',
    'perform_secondary_action',
    'paste',
    'select_text',
    'list_windows',
  ])('accepts the v2 %s command', (command) => {
    expect(isComputerUseCommand(command)).toBe(true);
  });

  it('preserves v2 stable error codes from the helper', async () => {
    await expect(executeComputerUseCommand({
      command: 'click',
      arguments: { app: 'TextEdit', window_id: 1, element_index: 99, failCode: 'stale_element' },
      options: options(),
    })).resolves.toStrictEqual({
      error: 'Action failed.',
      errorCode: 'stale_element',
      ok: false,
    });
  });

  it.each([
    'status',
    'request_accessibility',
    'request_screen_capture',
    'screenshot',
    'list_apps',
    'list_windows',
    'find_apps',
  ] as const)('never shows the virtual cursor for %s commands', async (command) => {
    await expect(executeComputerUseCommand({
      command,
      arguments: { showCursor: true },
      options: options(),
    })).resolves.toMatchObject({
      ok: true,
      result: {
        arguments: { showCursor: false },
        command,
      },
    });
  });

  it('preserves cursor visibility for interactive commands', async () => {
    await expect(executeComputerUseCommand({
      command: 'click',
      arguments: { window_id: 1, showCursor: true, x: 10, y: 20 },
      options: options(),
    })).resolves.toMatchObject({
      ok: true,
      result: {
        arguments: { window_id: 1, showCursor: true, x: 10, y: 20 },
        command: 'click',
      },
    });
  });

  it('keeps one lazy helper session alive across Computer Use commands', async () => {
    const first = await executeComputerUseCommand({ command: 'click', arguments: { window_id: 1, x: 1, y: 1 }, options: options() });
    const second = await executeComputerUseCommand({ command: 'get_app_state', arguments: { app: 'TextEdit', window_id: 1 }, options: options() });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect((first as { result: { pid: number } }).result.pid).toBe((second as { result: { pid: number } }).result.pid);
  });

  it('passes stable element indexes without synthesizing v1 traversal arguments', async () => {
    await executeComputerUseCommand({
      command: 'get_app_state',
      arguments: { app: 'System Settings', window_id: 1, maxDepth: 8, maxNodes: 500 },
      options: options(),
    });
    const click = await executeComputerUseCommand({
      command: 'click',
      arguments: { app: 'System Settings', window_id: 1, element_index: 33 },
      options: options(),
    });

    expect(click).toMatchObject({
      ok: true,
      result: {
        arguments: {
          app: 'System Settings',
          window_id: 1,
          element_index: 33,
        },
      },
    });
  });

  it('preserves the helper-owned diff baseline across observations', async () => {
    const first = await executeComputerUseCommand({ command: 'get_app_state', arguments: { app: 'TextEdit', window_id: 1 }, options: options() });
    const second = await executeComputerUseCommand({ command: 'get_app_state', arguments: { app: 'TextEdit', window_id: 1 }, options: options() });

    expect(first).toMatchObject({ ok: true, result: { stateKind: 'full', stateRevision: 1 } });
    expect(second).toMatchObject({ ok: true, result: { baseRevision: 1, stateKind: 'diff', stateRevision: 2 } });
    expect((first as { result: { pid: number } }).result.pid).toBe((second as { result: { pid: number } }).result.pid);
  });

  it('starts a new helper after the idle TTL expires', async () => {
    const shortTtlOptions = () => ({ ...options(), idleTtlMs: 20 });
    const first = await executeComputerUseCommand({ command: 'list_apps', arguments: {}, options: shortTtlOptions() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await executeComputerUseCommand({ command: 'list_apps', arguments: {}, options: shortTtlOptions() });

    expect((first as { result: { pid: number } }).result.pid).not.toBe((second as { result: { pid: number } }).result.pid);
  });

  it('resets the idle TTL after a screenshot', async () => {
    const shortTtlOptions = () => ({ ...options(), idleTtlMs: 200 });
    const first = await executeComputerUseCommand({ command: 'click', arguments: { window_id: 1, x: 1, y: 1 }, options: shortTtlOptions() });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const screenshot = await executeComputerUseCommand({ command: 'screenshot', arguments: {}, options: shortTtlOptions() });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const last = await executeComputerUseCommand({ command: 'status', arguments: {}, options: shortTtlOptions() });

    expect((screenshot as { result: { pid: number } }).result.pid).toBe((first as { result: { pid: number } }).result.pid);
    expect((last as { result: { pid: number } }).result.pid).toBe((first as { result: { pid: number } }).result.pid);
  });

  it('starts a new session after an explicit stop', async () => {
    const first = await executeComputerUseCommand({ command: 'click', arguments: { window_id: 1, x: 1, y: 1 }, options: options() });
    stopComputerUseHelper();
    const second = await executeComputerUseCommand({ command: 'click', arguments: { window_id: 1, x: 1, y: 1 }, options: options() });

    expect((first as { result: { pid: number } }).result.pid).not.toBe((second as { result: { pid: number } }).result.pid);
  });

  it('resolves the product bundle from packaged resources', () => {
    expect(resolveComputerUseHelperAppPath({
      appPath: '/unused',
      isPackaged: true,
      platform: 'darwin',
      resourcesPath: `/Applications/${product.name}.app/Contents/Resources`,
    })).toBe(`/Applications/${product.name}.app/Contents/Resources/${product.name} Computer Use.app`);
  });

  function options() {
    return {
      appPath: tempDir,
      isPackaged: false,
      pilotPath,
      platform: 'darwin' as const,
      resourcesPath: tempDir,
    };
  }
});
