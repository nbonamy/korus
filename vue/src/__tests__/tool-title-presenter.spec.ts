import { product } from '@workspace/core/product';
import { describe, expect, it } from 'vitest';
import type { CodexToolTitlePresenterContext } from '@codex-app-sdk/vue';
import { messages } from '../i18n/messages';
import { presentAppToolTitle } from '../tool-title-presenter';

describe(`${product.name} tool title presenter`, () => {
  it.each([
    ['korus.generate-image', { prompt: 'Private prompt' }, 'running', 'Generating images'],
    ['mcp__korus__generate_image', {}, 'completed', 'Generated images'],
    ['korus.generate-image', {}, 'error', 'Could not generate images'],
    ['korus.simulator', { action: 'list' }, 'completed', 'Listed simulators'],
    ['korus.simulator', { action: 'status' }, 'completed', 'Checked simulator status'],
    ['korus.simulator', { action: 'attach', deviceId: 'private-device-id' }, 'running', 'Opening simulator'],
    ['korus.simulator', { action: 'attach' }, 'completed', 'Opened simulator'],
    ['korus.simulator', { action: 'detach' }, 'completed', 'Detached simulator'],
    ['korus.simulator', { action: 'shutdown' }, 'completed', 'Shut down simulator'],
    ['korus.simulator', { action: 'screenshot' }, 'completed', 'Captured simulator screenshot'],
    ['korus.simulator', { action: 'screenshot' }, 'running', 'Capturing simulator screenshot'],
    ['korus.simulator', { action: 'screenshot' }, 'error', 'Could not capture simulator screenshot'],
    ['korus.simulator', { action: 'inspect' }, 'completed', 'Inspected simulator screen'],
    ['korus.simulator', { action: 'tap', x: 30, y: 40 }, 'completed', 'Tapped simulator screen'],
    ['korus.simulator', { action: 'swipe' }, 'completed', 'Swiped simulator screen'],
    ['korus.simulator', { action: 'text', text: 'private content' }, 'completed', 'Typed in simulator'],
    ['korus.simulator', { action: 'button', button: 'home' }, 'completed', 'Pressed simulator button'],
    ['korus.simulator', { action: 'launch', appId: 'com.example.app' }, 'completed', 'Launched simulator app'],
    ['korus.simulator', {}, 'completed', 'Used simulator'],
    ['korus.simulator', { action: 'future-action' }, 'running', 'Using simulator'],
    ['korus.read-skill', { name: 'korus-inline-html' }, 'running', 'Loading skill korus-inline-html'],
    ['mcp__korus__read_skill', { name: 'korus-inline-html' }, 'completed', 'Loaded skill korus-inline-html'],
    ['korus.read-skill', { name: 'korus-inline-html' }, 'error', 'Could not load skill korus-inline-html'],
    ['korus.create-automation', { name: 'Daily check' }, 'running', 'Creating automation Daily check'],
    ['mcp__korus__create-automation', { name: 'Daily check' }, 'completed', 'Created automation Daily check'],
    ['korus.create-automation', {}, 'error', 'Failed creating automation'],
    ['workspace.start_automatic_review', {}, 'running', 'Starting automatic review'],
    [`${product.mcpServerName}.start_automatic_review`, {}, 'completed', 'Started automatic review'],
    ['workspace.start_automatic_review', {}, 'error', 'Could not start automatic review'],
    [`mcp__${product.mcpServerName}__report_finding`, {}, 'completed', 'Reported finding'],
    [`${product.mcpServerName}.report_finding`, {}, 'completed', 'Reported finding'],
    ['workspace.wait-tasks', {}, 'running', 'Waiting for delegated tasks'],
    ['workspace.wait-tasks', {}, 'completed', 'Checked delegated tasks'],
    ['workspace.wait-tasks', {}, 'error', 'Could not check delegated tasks'],
    ['workspace.complete-task', {}, 'running', 'Submitting task result'],
    ['workspace.complete-task', {}, 'completed', 'Submitted task result'],
    ['workspace.complete-task', {}, 'error', 'Could not submit task result'],
    ['workspace.cancel-task', {}, 'running', 'Cancelling delegated task'],
    ['workspace.cancel-task', {}, 'completed', 'Requested task cancellation'],
    ['workspace.cancel-task', {}, 'error', 'Could not cancel delegated task'],
    ['workspace.suggest-visualizations', { suggestions: [] }, 'completed', 'Suggested diagrams'],
    ['workspace.add-visualization', { title: 'System map' }, 'completed', 'Created diagram'],
    ['workspace.read-visualization-canvas', {}, 'completed', 'Read canvas selection'],
    ['workspace.edit-visualization-canvas', {}, 'running', 'Editing canvas'],
    ['workspace.edit-visualization-canvas', {}, 'error', 'Could not edit canvas'],
    ['workspace.view-visualization-canvas', {}, 'completed', 'Viewed canvas'],
    ['workspace.get-visualization', { visualizationId: 'diagram-1' }, 'completed', 'Read diagram'],
    ['workspace.list-visualizations', {}, 'completed', 'Listed diagrams'],
    ['workspace.delete-visualization', { visualizationId: 'diagram-1' }, 'completed', 'Deleted diagram'],
    ['workspace.replace-visualization', { visualizationId: 'diagram-1' }, 'completed', 'Updated diagram'],
    ['workspace.set-mission-title', { title: 'Add team billing' }, 'running', 'Naming mission'],
    ['workspace.set-mission-title', { title: 'Add team billing' }, 'completed', 'Named mission'],
    ['workspace.set-mission-title', { title: 'Add team billing' }, 'error', 'Could not name mission'],
    ['workspace.attach-mission-repository', { repoPath: '/repo' }, 'completed', 'Attached mission repository'],
    ['workspace.get-mission-assignment', {}, 'running', 'Reading mission assignment'],
    ['workspace.get-mission-assignment', {}, 'completed', 'Read mission assignment'],
    ['workspace.get-mission-assignment', {}, 'error', 'Could not read mission assignment'],
    ['workspace.list-mission-artifacts', {}, 'completed', 'Checked mission artifacts'],
    ['workspace.read-mission-artifact', { stage: 'requirements' }, 'completed', 'Read mission artifact'],
    ['workspace.write-mission-artifact', { stage: 'requirements' }, 'completed', 'Saved mission artifact'],
    ['workspace.submit-mission-result', {}, 'running', 'Submitting mission artifact'],
    ['workspace.submit-mission-result', {}, 'completed', 'Mission artifact ready for review'],
    ['workspace.submit-mission-result', {}, 'error', 'Could not submit mission artifact'],
    ['workspace.upsert-mission-ticket', { title: 'Add checkout' }, 'running', 'Drafting mission ticket'],
    ['workspace.upsert-mission-ticket', { title: 'Add checkout' }, 'completed', 'Drafted mission ticket'],
    ['workspace.upsert-mission-ticket', { title: 'Add checkout' }, 'error', 'Could not draft mission ticket'],
    ['workspace.toggle_thread_flag', { id: 'delegate_to_worktree', value: true }, 'completed', 'Updated thread flag'],
    ['workspace.send-message', { to: 'computer-use' }, 'completed', 'Sent message to computer-use'],
    ['workspace.list-agents', {}, 'completed', 'Listed agents'],
    ['workspace.report_finding', { title: 'Keep tool copy product-facing' }, 'running', 'Reporting finding'],
    ['workspace.report-mission-review-finding', { title: 'Persist selection' }, 'completed', 'Reported Mission finding'],
    ['workspace.update-mission-review-finding', { findingId: 'finding-1' }, 'completed', 'Updated Mission finding'],
    ['workspace.report_finding', { title: 'Keep tool copy product-facing' }, 'completed', 'Reported finding'],
    ['workspace.update_finding', { findingId: 'finding-1' }, 'completed', 'Updated finding'],
    ['workspace.delete_finding', { findingId: 'finding-1' }, 'running', 'Deleting finding'],
    ['workspace.delete_finding', { findingId: 'finding-1' }, 'completed', 'Deleted finding'],
    ['workspace.mark_finding_complete', { findingId: 'finding-1' }, 'completed', 'Verified finding fix'],
    ['workspace.browser-screenshot', {}, 'running', 'Capturing page screenshot'],
    ['workspace.browser-open', { url: 'https://example.com' }, 'completed', 'Opened https://example.com'],
    ['korus.browser-set-viewport', { preset: 'phone' }, 'running', 'Resizing browser viewport'],
    ['korus.browser-set-viewport', { width: 900, height: 700 }, 'completed', 'Resized browser viewport'],
    ['korus.browser-set-viewport', {}, 'error', 'Failed resizing browser viewport'],
    ['mcp__workspace__computer_use_launch_app', { path: `/Applications/${product.name}.app` }, 'completed', `Launched ${product.name}`],
    ['mcp__workspace__computer_use_list_windows', { app: 'Safari' }, 'completed', 'Listed Safari windows'],
    ['mcp__workspace__computer_use_get_app_state', { app: `${product.name}` }, 'completed', `Inspected ${product.name}`],
    ['mcp__workspace__computer_use_guide', {}, 'running', 'Loading Computer Use guide'],
    ['mcp__workspace__computer_use_guide', {}, 'completed', 'Loaded Computer Use guide'],
    ['mcp__workspace__computer_use_dismiss', { pid: 74070, accessibilityScope: 'menu_bar' }, 'completed', 'Dismissed native menu'],
    ['mcp__workspace__computer_use_click', { pid: 74070, x: 33, y: 236 }, 'error', 'Failed clicking target app at (33, 236)'],
    ['mcp__workspace__computer_use_scroll', { app: 'Safari', direction: 'down' }, 'completed', 'Scrolled down in Safari'],
    ['mcp__workspace__computer_use_press_key', { app: 'Safari', key: 'Super_L+l' }, 'completed', 'Pressed Super_L+l in Safari'],
    ['mcp__workspace__computer_use_paste', { app: 'Safari', text: 'private text' }, 'completed', 'Pasted content in Safari'],
    ['mcp__workspace__computer_use_select_text', { app: 'Safari', element_index: 7, text: 'private text' }, 'completed', 'Selected text in control #7 in Safari'],
    ['mcp__workspace__computer_use_drag', { app: 'Safari', from_x: 1, from_y: 2, to_x: 3, to_y: 4 }, 'completed', 'Dragged in Safari'],
    ['mcp__workspace__computer_use_perform_secondary_action', { app: 'Safari', element_index: 7, action: 'AXShowMenu' }, 'completed', 'Performed secondary action on control #7 in Safari'],
    ['mcp__workspace__computer_use_screenshot', { displayId: 42, scope: 'screen' }, 'completed', 'Captured display 42 screenshot'],
    ['mcp__workspace__computer_use_request_screen_recording', {}, 'completed', 'Requested macOS Screen Recording access for Computer Use'],
    ['workspace.create-worktree', { branchName: 'feature/tool-labels' }, 'error', 'Failed creating worktree feature/tool-labels'],
    ['workspace.create-project', { name: 'new-product' }, 'running', 'Creating project new-product'],
    ['workspace.create-project', { name: 'new-product' }, 'completed', 'Created project new-product'],
    ['workspace.create-project', { name: 'new-product' }, 'error', 'Failed creating project new-product'],
  ])('presents %s as user-facing activity text', (functionName, args, state, expected) => {
    expect(presentAppToolTitle(context(
      functionName,
      args,
      state as 'running' | 'completed' | 'error',
    ))).toBe(expected);
  });

  it('uses the resolved recipient name after sending by agent id', () => {
    expect(presentAppToolTitle({
      ...context('workspace.send-message', { to: 'agent-uuid' }, 'completed'),
      toolCall: {
        ...context('workspace.send-message', { to: 'agent-uuid' }, 'completed').toolCall,
        result: { recipientId: 'agent-uuid', recipientName: 'Computer Use' },
      },
    })).toBe('Sent message to Computer Use');
  });

  it('uses the attached simulator name from structured results without showing its id', () => {
    const attachment = context('mcp__korus__simulator', { action: 'attach', deviceId: 'private-device-id' }, 'completed');
    attachment.toolCall = {
      ...attachment.toolCall,
      result: { structuredContent: { attachment: { id: 'private-attachment-id', device: { name: 'iPhone 18 Pro' } } } },
    };
    expect(presentAppToolTitle(attachment)).toBe('Opened iPhone 18 Pro');
  });

  it('uses the created agent name after delegation completes', () => {
    const creation = context('workspace.create-agent', {
      repoPath: '/src/codex-app-sdk',
      branchName: 'feature/contracts',
    }, 'completed');
    creation.toolCall = {
      ...creation.toolCall,
      result: { agentName: 'feature/contracts' },
    };

    expect(presentAppToolTitle(creation)).toBe('Created agent feature/contracts');
  });

  it('uses the loaded agent name while sending by agent id', () => {
    expect(presentAppToolTitle(
      context('workspace.send-message', { to: 'agent-uuid' }, 'running'),
      (identifier) => identifier === 'agent-uuid' ? 'Computer Use' : undefined,
    )).toBe('Sending message to Computer Use');
  });

  it('uses approval descriptors and leaves other MCP servers to their own presenters', () => {
    expect(presentAppToolTitle(context(
      'workspace.register-agent',
      {},
      'running',
      { params: { tool: 'workspace.register-agent' }, phase: 'running' },
    ))).toBe('Registering agent');
    expect(presentAppToolTitle(context('github.create_issue', {}, 'completed'))).toBeUndefined();
  });

  it('uses completed Computer Use result context without exposing entered text or values', () => {
    const typeText = context('mcp__workspace__computer_use_type_text', {
      pid: 74070,
      text: 'private draft text',
    }, 'completed');
    typeText.toolCall = {
      ...typeText.toolCall,
      result: { structuredContent: { app: { localizedName: `${product.name}` } } },
    };

    expect(presentAppToolTitle(typeText)).toBe(`Entered text in ${product.name}`);
    expect(presentAppToolTitle(typeText)).not.toContain('private draft text');

    expect(presentAppToolTitle(context(
      'mcp__workspace__computer_use_set_value',
      { app: 'TextEdit', element_index: 7, value: 'secret' },
      'completed',
    ))).toBe('Updated control #7 in TextEdit');
  });

  it('uses the resolved app name and never exposes a process id', () => {
    const inspection = context('mcp__workspace__computer_use_get_app_state', { pid: 74070 }, 'completed');
    inspection.toolCall = {
      ...inspection.toolCall,
      result: {
        structuredContent: {
          app: { localizedName: 'Electron', pid: 74070 },
          window: { title: `${product.name}` },
        },
      },
    };

    expect(presentAppToolTitle(inspection)).toBe('Inspected Electron');
    expect(presentAppToolTitle(inspection)).not.toContain('74070');
  });

});

function context(
  functionName: string,
  args: unknown,
  state: 'running' | 'completed' | 'error',
  descriptor?: { params?: Record<string, unknown>; phase: string },
): CodexToolTitlePresenterContext {
  return {
    descriptor: descriptor ? { action: 'run', source: 'mcp', ...descriptor } : undefined,
    toolCall: {
      args,
      done: state !== 'running',
      function: functionName,
      id: 'tool-1',
      result: undefined,
      state,
    },
    translate: translate as CodexToolTitlePresenterContext['translate'],
  };
}

function translate(key: string, params?: Record<string, unknown>): string {
  const value = key.split('.').reduce<unknown>((current, segment) => (
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>)[segment]
      : undefined
  ), messages.en);
  if (typeof value !== 'string') return key;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? '')).trim();
}
