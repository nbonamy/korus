import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { errorToolResult, STRUCTURED_TOOL_RESULT_NOTICE, structuredToolResult } from './tool-result';

export type ComputerUseClient = {
  execute(input: { command: ComputerUseCommand; arguments: Record<string, unknown> }): Promise<unknown>;
  requestAccessibility(): Promise<unknown>;
  status(): Promise<unknown>;
  stop(): Promise<unknown>;
};

type ComputerUseCommand =
  | 'click'
  | 'dismiss'
  | 'drag'
  | 'find_apps'
  | 'focus_app'
  | 'get_app_state'
  | 'launch_app'
  | 'list_apps'
  | 'list_windows'
  | 'paste'
  | 'perform_secondary_action'
  | 'press_key'
  | 'request_screen_capture'
  | 'scroll'
  | 'select_option'
  | 'select_text'
  | 'set_value'
  | 'screenshot'
  | 'type_text';

export function registerComputerUseTools(server: McpServer, computerUse: ComputerUseClient): void {
  if (!observationRecovery.has(computerUse)) observationRecovery.set(computerUse, { generation: 0, scopes: new Map() });

  server.registerTool('computer-use-status', {
    description: 'Read korus-computer-use before GUI actions. Check local helper availability and macOS Accessibility/Screen Recording permissions.',
    inputSchema: {},
  }, () => computerUseResult(() => computerUse.status()));

  server.registerTool('computer-use-request-accessibility', {
    description: 'Request macOS Accessibility permission for the bundled Computer Use helper and open System Settings when needed.',
    inputSchema: {},
  }, () => computerUseResult(() => computerUse.requestAccessibility()));

  server.registerTool('computer-use-request-screen-recording', {
    description: 'Request macOS Screen Recording permission for the bundled Computer Use helper and open System Settings when needed.',
    inputSchema: {},
  }, () => execute(computerUse, 'request_screen_capture', {}));

  server.registerTool('computer-use-stop', {
    description: 'End the local Computer Use session and hide its virtual cursor immediately.',
    inputSchema: {},
  }, () => computerUseResult(() => computerUse.stop()));

  server.registerTool('computer-use-list-apps', {
    description: 'List currently running macOS applications before focusing or inspecting one.',
    inputSchema: {},
  }, () => execute(computerUse, 'list_apps', {}));

  server.registerTool('computer-use-list-windows', {
    description: 'List a running app\'s windows and their session-local window IDs before inspecting, focusing, or acting on one.',
    inputSchema: z.strictObject(optionalAppSchema),
  }, (arguments_) => execute(computerUse, 'list_windows', arguments_));

  server.registerTool('computer-use-find-apps', {
    description: 'Find installed macOS applications by optional name, path, or bundle identifier.',
    inputSchema: z.strictObject(optionalAppSchema),
  }, (arguments_) => execute(computerUse, 'find_apps', arguments_));

  server.registerTool('computer-use-launch-app', {
    description: 'Launch an installed macOS application by bundle identifier or .app path.',
    inputSchema: z.strictObject({
      bundleIdentifier: z.string().optional(),
      path: z.string().optional(),
    }),
  }, (arguments_) => execute(computerUse, 'launch_app', arguments_));

  server.registerTool('computer-use-focus-app', {
    description: 'Explicitly bring the selected window to the foreground.',
    inputSchema: z.strictObject(windowTargetSchema),
  }, (arguments_) => executeWindowTargeted(computerUse, 'focus_app', arguments_));

  server.registerTool('computer-use-get-app-state', {
    description: 'Read selected-window AX state (full/diff), optional screenshot and waitForText. Read-only menu-bar inspection needs no window ID. In code mode, chain known steps in one exec.',
    inputSchema: appStateInputSchema,
  }, ({ label: _label, ...arguments_ }) => arguments_.accessibilityScope === 'menu_bar'
    ? observeAppState(computerUse, arguments_)
    : computerUseWindowAppStateResult(computerUse, arguments_));

  server.registerTool('computer-use-screenshot', {
    description: 'Capture an explicitly selected app window or an entire macOS display as a PNG with coordinate metadata.',
    inputSchema: screenshotInputSchema,
  }, (arguments_) => arguments_.scope === 'screen'
    ? computerUseScreenshotResult(() => computerUse.execute({ command: 'screenshot', arguments: arguments_ }))
    : computerUseWindowScreenshotResult(computerUse, arguments_));

  server.registerTool('computer-use-click', {
    description: 'Click by background AX or foreground physical input; observe optionally returns resulting UI state. In code mode, chain known steps in one exec.',
    inputSchema: z.strictObject({
      ...actionTargetSchema,
      click_count: z.number().int().min(1).max(3).optional(),
      mouse_button: z.enum(['left', 'right', 'middle']).optional(),
      physical: z.boolean().optional().describe('Move the real cursor to the target and click in the foreground instead of AXPress. Leaves the cursor at the target.'),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'click', arguments_));

  server.registerTool('computer-use-dismiss', {
    description: 'Dismiss an active native menu or popover with its Accessibility cancel action.',
    inputSchema: z.strictObject(semanticOrIndexedTargetSchema),
  }, (arguments_) => executeWindowTargeted(computerUse, 'dismiss', arguments_));

  server.registerTool('computer-use-press-key', {
    description: 'Send one key or X-keysym-style chord directly to a running app process. In code mode, chain known steps in one exec.',
    inputSchema: z.strictObject({
      ...keyboardTargetSchema,
      key: z.string().min(1).max(200),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'press_key', arguments_));

  server.registerTool('computer-use-type-text', {
    description: 'Type into an indexed editable control with focus verification. replace=true replaces contents; submit=true presses Return. click_before=true clicks element_index first, so no separate click call. In code mode, chain known steps in one exec.',
    inputSchema: z.strictObject({
      ...windowTargetSchema,
      element_index: z.number().int().nonnegative().optional(),
      label: labelSchema,
      click_before: z.boolean().optional().describe('Click element_index first. Requires element_index.'),
      replace: z.boolean().optional(),
      submit: z.boolean().optional(),
      text: z.string().max(100_000),
    }),
  }, (arguments_) => typeText(computerUse, arguments_));

  server.registerTool('computer-use-fill-form', {
    description: 'Fill several controls in one call: text fields are typed; checked sets a checkbox or radio to a state (clicking only if it differs); option chooses a dropdown item by title; value sets a slider or settable control. Stops at the first failure. observe returns the state after the last field.',
    inputSchema: z.strictObject({
      ...windowTargetSchema,
      fields: z.array(z.strictObject({
        element_index: z.number().int().nonnegative(),
        label: labelSchema,
        text: z.string().max(100_000).optional().describe('Text to type.'),
        checked: z.boolean().optional().describe('Wanted state of a checkbox or radio.'),
        option: z.string().min(1).max(500).optional().describe('Dropdown option title. Read the dropdown with rootElementIndex to list them.'),
        value: z.string().max(100_000).optional().describe('Value to set on a slider or other settable control.'),
        replace: z.boolean().optional(),
        submit: z.boolean().optional(),
      }).refine((field) => [field.text, field.checked, field.option, field.value].filter((value) => value !== undefined).length === 1, { message: 'give exactly one of text, checked, option or value' })).min(1).max(30),
    }),
  }, (arguments_) => fillForm(computerUse, arguments_));

  server.registerTool('computer-use-paste', {
    description: 'Paste plain text, Markdown, or HTML into a running app while preserving the existing pasteboard when possible.',
    inputSchema: z.strictObject({
      ...keyboardTargetSchema,
      format: z.enum(['text', 'md', 'html']).optional(),
      text: z.string().max(100_000),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'paste', arguments_));

  server.registerTool('computer-use-set-value', {
    description: 'Set AXValue on an indexed, settable element from the latest app observation. Do not use this for rich web editors.',
    inputSchema: z.strictObject({
      ...indexedTargetSchema,
      element_index: z.number().int().nonnegative(),
      value: z.string().max(100_000),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'set_value', arguments_));

  server.registerTool('computer-use-select-text', {
    description: 'Select an exact text match or place the insertion cursor in an indexed editable element from the latest observation.',
    inputSchema: z.strictObject({
      ...indexedTargetSchema,
      element_index: z.number().int().nonnegative(),
      prefix: z.string().optional(),
      selection_type: z.enum(['text', 'cursor_before', 'cursor_after']).optional(),
      suffix: z.string().optional(),
      text: z.string().min(1).max(100_000),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'select_text', arguments_));

  server.registerTool('computer-use-scroll', {
    description: 'Scroll an indexed element from the latest observation or the current view.',
    inputSchema: z.strictObject({
      ...indexedTargetSchema,
      direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      pages: z.number().int().positive().max(100).optional(),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'scroll', arguments_));

  server.registerTool('computer-use-drag', {
    description: 'Drag between absolute macOS logical screen coordinates while the target app is foreground and unobstructed.',
    inputSchema: z.strictObject({
      ...windowTargetSchema,
      from_x: z.number().finite(),
      from_y: z.number().finite(),
      to_x: z.number().finite(),
      to_y: z.number().finite(),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'drag', arguments_));

  server.registerTool('computer-use-perform-secondary-action', {
    description: 'Invoke a non-primary Accessibility action advertised by an indexed element in the latest observation.',
    inputSchema: z.strictObject({
      ...indexedTargetSchema,
      action: z.string().min(1).max(200),
      element_index: z.number().int().nonnegative(),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'perform_secondary_action', arguments_));
}

const optionalAppSchema = {
  app: z.string().optional(),
  bundleIdentifier: z.string().optional(),
  path: z.string().optional(),
  pid: z.number().int().positive().optional(),
};

const accessibilityScopeSchema = z.enum(['application', 'menu_bar']).optional()
  .describe('Target the application accessibility tree or its native menu bar. Defaults to application.');

const windowIdSchema = z.number().int().positive()
  .describe('Session-local window ID returned by computer-use-list-windows.');

/** What the person sees in the activity row ("Clicked First Name"); the helper never receives it. */
const labelSchema = z.string().trim().min(1).max(120).optional()
  .describe('Control name shown to the user, e.g. "First Name".');

const windowTargetSchema = {
  ...optionalAppSchema,
  window_id: windowIdSchema,
  observe: z.strictObject({
    includeScreenshot: z.boolean().optional(),
    waitForText: z.string().min(1).max(500).optional(),
    timeoutMs: z.number().int().min(1).max(15_000).optional(),
  }).optional().describe('Return a settled AX observation after successful delivery, optionally waiting for expected text. Prefer this over a separate get-app-state call.'),
};

const keyboardTargetSchema = windowTargetSchema;

const appStateOptionsSchema = {
  ...optionalAppSchema,
  disableDiff: z.boolean().optional().describe('Force a full hierarchy when the prior diff baseline is unavailable.'),
  includeDebug: z.boolean().optional(),
  includeScreenshot: z.boolean().optional().describe('Include the selected window screenshot. Defaults to false.'),
  waitForText: z.string().min(1).max(500).optional(),
  timeoutMs: z.number().int().min(1).max(15_000).optional(),
  maxDepth: z.number().int().positive().max(30).optional(),
  maxNodes: z.number().int().positive().max(10_000).optional(),
  maxTextCharacters: z.number().int().positive().max(100_000).optional(),
  rootElementIndex: z.number().int().nonnegative().optional().describe('Read only this element and its children. On a dropdown its line lists options=A|B|C.'),
};

const appStateInputSchema = z.strictObject({
  ...appStateOptionsSchema,
  label: labelSchema,
  accessibilityScope: accessibilityScopeSchema,
  window_id: windowIdSchema.optional().describe('Required for application scope; omit only for read-only menu_bar inspection.'),
}).refine((input) => input.accessibilityScope === 'menu_bar' || input.window_id !== undefined, {
  message: 'window_id is required for application observations',
});

// A plain object keeps the published JSON schema typed; a top-level union publishes no properties.
const screenshotInputSchema = z.object({
  ...optionalAppSchema,
  displayId: z.number().int().positive().optional().describe('Display to capture when scope is screen.'),
  scope: z.enum(['screen', 'window']).optional().describe('screen captures a whole display; window (default) needs window_id.'),
  window_id: windowIdSchema.optional(),
}).refine((input) => input.scope === 'screen' || input.window_id !== undefined, {
  message: 'window_id is required for window screenshots',
});

const semanticSelectorSchema = z.strictObject({
  description: z.string().optional(),
  occurrence: z.number().int().positive().optional(),
  role: z.string().optional().describe('Raw macOS Accessibility role, for example AXButton or AXMenuBarItem.'),
  subrole: z.string().optional(),
  title: z.string().optional(),
  value: z.string().optional(),
}).refine((selector) => Object.keys(selector).some((key) => key !== 'occurrence'), {
  message: 'selector must include at least one matching attribute',
});

const actionTargetSchema = {
  ...windowTargetSchema,
  label: labelSchema,
  accessibilityScope: accessibilityScopeSchema,
  element_index: z.number().int().nonnegative().optional(),
  selector: semanticSelectorSchema.optional()
    .describe('Stable semantic AX target. Prefer this over element_index when the UI can change after inspection.'),
  x: z.number().finite().optional().describe('Absolute macOS logical screen x-coordinate, measured rightward from the main display origin. Not a screenshot pixel or window-relative coordinate.'),
  y: z.number().finite().optional().describe('Absolute macOS logical screen y-coordinate, measured downward from the main display origin. Not a screenshot pixel or window-relative coordinate.'),
};

const indexedTargetSchema = {
  ...windowTargetSchema,
  label: labelSchema,
  accessibilityScope: accessibilityScopeSchema,
  element_index: z.number().int().nonnegative().optional(),
};

const semanticOrIndexedTargetSchema = {
  ...indexedTargetSchema,
  selector: semanticSelectorSchema.optional(),
};

function execute(computerUse: ComputerUseClient, command: ComputerUseCommand, arguments_: Record<string, unknown>) {
  return computerUseResult(() => computerUse.execute({ command, arguments: arguments_ }));
}

async function executeWindowTargeted(
  computerUse: ComputerUseClient,
  command: ComputerUseCommand,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  const invalid = invalidWindowIdResult(arguments_);
  if (invalid) return invalid;
  const { observe, label: _label, ...actionArguments } = arguments_;
  if (!observe) return execute(computerUse, command, actionArguments);
  try {
    const delivered = await computerUse.execute({ command, arguments: actionArguments });
    if (isFailure(delivered)) return errorToolResult(computerUseFailureMessage(delivered));
    const actionResult = isSuccess(delivered) ? delivered.result : delivered;
    if (record(actionResult)?.success === false) return errorToolResult(String(record(actionResult)?.error ?? 'Action failed.'));
    const { app, pid, path, bundleIdentifier, window_id } = actionArguments;
    const observation = await observeAppState(computerUse,
      { app, pid, path, bundleIdentifier, window_id, includeScreenshot: false, ...record(observe) });
    return { ...observation, structuredContent: { ...observation.structuredContent, actionResult, actionDelivered: true } };
  } catch (error) {
    return errorToolResult(error instanceof Error ? error.message : String(error));
  }
}

const windowTargetFields = ['app', 'bundleIdentifier', 'path', 'pid', 'window_id'] as const;

function windowTarget(arguments_: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(windowTargetFields.flatMap(field => arguments_[field] === undefined ? [] : [[field, arguments_[field]]]));
}

/** Delivers one helper command and returns why it failed, or null when it went through. */
async function deliver(computerUse: ComputerUseClient, command: ComputerUseCommand, arguments_: Record<string, unknown>): Promise<string | null> {
  try {
    const delivered = await computerUse.execute({ command, arguments: arguments_ });
    if (isFailure(delivered)) return computerUseFailureMessage(delivered);
    const result = isSuccess(delivered) ? delivered.result : delivered;
    return record(result)?.success === false ? String(record(result)?.error ?? 'Action failed.') : null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function typeText(computerUse: ComputerUseClient, arguments_: Record<string, unknown>): Promise<CallToolResult> {
  const { click_before: clickBefore, ...input } = arguments_;
  if (!clickBefore) return executeWindowTargeted(computerUse, 'type_text', input);
  const invalid = invalidWindowIdResult(input);
  if (invalid) return invalid;
  if (typeof input.element_index !== 'number') return errorToolResult('invalid_request: click_before needs the element_index of the control to click.');
  const failure = await deliver(computerUse, 'click', { ...windowTarget(input), element_index: input.element_index });
  if (failure) return errorToolResult(`click before typing failed: ${failure}`);
  return executeWindowTargeted(computerUse, 'type_text', input);
}

type FormField = { checked?: boolean; element_index: number; label?: string; option?: string; replace?: boolean; submit?: boolean; text?: string; value?: string };

async function fillForm(computerUse: ComputerUseClient, arguments_: Record<string, unknown>): Promise<CallToolResult> {
  const invalid = invalidWindowIdResult(arguments_);
  if (invalid) return invalid;
  const target = windowTarget(arguments_);
  const fields = (arguments_.fields ?? []) as FormField[];
  for (const [index, field] of fields.entries()) {
    const failure = await fillField(computerUse, target, field);
    if (failure) return errorToolResult(`fill_form: field ${index + 1} of ${fields.length} (${field.label ?? `#${field.element_index}`}) failed, ${index} filled: ${failure}`);
  }
  const actionResult = { filled: fields.length, total: fields.length };
  if (!arguments_.observe) return structuredToolResult(actionResult);
  const observation = await observeAppState(computerUse, { ...target, includeScreenshot: false, ...record(arguments_.observe) });
  return { ...observation, structuredContent: { ...observation.structuredContent, actionResult, actionDelivered: true } };
}

/** One field of a form: a value, a dropdown option, a checkbox or radio state, or text, whichever the field carries. */
function fillField(computerUse: ComputerUseClient, target: Record<string, unknown>, field: FormField): Promise<string | null> {
  if (field.value !== undefined) return deliver(computerUse, 'set_value', { ...target, element_index: field.element_index, value: field.value });
  if (field.option !== undefined) return deliver(computerUse, 'select_option', { ...target, element_index: field.element_index, option: field.option });
  if (field.checked !== undefined) return checkField(computerUse, target, field);
  return typeField(computerUse, target, field);
}

/** Targeted typing focuses the control itself, so a text field needs no click first. */
function typeField(computerUse: ComputerUseClient, target: Record<string, unknown>, field: FormField): Promise<string | null> {
  return deliver(computerUse, 'type_text', {
    ...target,
    element_index: field.element_index,
    text: field.text ?? '',
    ...(field.replace === undefined ? {} : { replace: field.replace }),
    ...(field.submit === undefined ? {} : { submit: field.submit }),
  });
}

/** Sets a checkbox or radio to the state asked for. A click toggles a checkbox and selects a radio, so it only happens when needed. */
async function checkField(computerUse: ComputerUseClient, target: Record<string, unknown>, field: FormField): Promise<string | null> {
  const before = await controlState(computerUse, target, field.element_index);
  if (typeof before === 'string') return before;
  if (before.checked === field.checked) return null;
  if (before.radio && field.checked === false) return 'a radio button cannot be unchecked; choose another one in its group';
  const failure = await deliver(computerUse, 'click', { ...target, element_index: field.element_index });
  if (failure) return failure;
  const after = await controlState(computerUse, target, field.element_index);
  if (typeof after === 'string') return after;
  return after.checked === field.checked ? null : `still ${after.checked ? 'checked' : 'unchecked'} after the click`;
}

/** The checked state of one checkbox, radio or switch, from its line of the observation (`value=on` or `value=off`). */
async function controlState(computerUse: ComputerUseClient, target: Record<string, unknown>, elementIndex: number): Promise<{ checked: boolean; radio: boolean } | string> {
  try {
    const delivered = await computerUse.execute({ command: 'get_app_state', arguments: { ...target, rootElementIndex: elementIndex, maxDepth: 0, includeScreenshot: false, disableDiff: true } });
    if (isFailure(delivered)) return computerUseFailureMessage(delivered);
    const text = record(isSuccess(delivered) ? delivered.result : delivered)?.text;
    const line = typeof text === 'string' ? text.split('\n').find((candidate) => /\bvalue=(on|off)\b/.test(candidate)) : undefined;
    if (!line) return 'could not read the on/off state of this control; is it a checkbox or radio button?';
    return { checked: /\bvalue=on\b/.test(line), radio: /\bradio button\b/.test(line) };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function computerUseWindowAppStateResult(
  computerUse: ComputerUseClient,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  const invalid = invalidWindowIdResult(arguments_);
  return invalid
    ? Promise.resolve(invalid)
    : observeAppState(computerUse, { includeScreenshot: false, ...arguments_ });
}

const observationRecovery = new WeakMap<ComputerUseClient, { generation: number; scopes: Map<string, number> }>();

async function observeAppState(computerUse: ComputerUseClient, arguments_: Record<string, unknown>): Promise<CallToolResult> {
  const recovery = observationRecovery.get(computerUse)!;
  const key = JSON.stringify(['app', 'pid', 'path', 'bundleIdentifier', 'window_id', 'accessibilityScope',
    'rootElementIndex', 'maxDepth', 'maxNodes', 'maxTextCharacters'].map((field) => arguments_[field] ?? null));
  const generation = recovery.generation;
  const needsBaseline = (recovery.scopes.get(key) ?? 0) < generation;
  const result = await computerUseAppStateResult(() => computerUse.execute({
    command: 'get_app_state', arguments: { ...arguments_, ...(needsBaseline ? { disableDiff: true } : {}) },
  }));
  // A timed-out request can still advance the helper's history. Recover every
  // scope independently; observing a different window must not consume recovery.
  if (result.isError) recovery.generation += 1;
  else recovery.scopes.set(key, generation);
  return result;
}

function computerUseWindowScreenshotResult(
  computerUse: ComputerUseClient,
  arguments_: Record<string, unknown>,
): Promise<CallToolResult> {
  const invalid = invalidWindowIdResult(arguments_);
  return invalid
    ? Promise.resolve(invalid)
    : computerUseScreenshotResult(() => computerUse.execute({ command: 'screenshot', arguments: arguments_ }));
}

function invalidWindowIdResult(arguments_: Record<string, unknown>): CallToolResult | null {
  const windowId = arguments_.window_id;
  return typeof windowId === 'number' && Number.isInteger(windowId) && windowId > 0
    ? null
    : errorToolResult('invalid_request: window_id must be a positive integer returned by computer-use-list-windows.');
}

async function computerUseResult(run: () => Promise<unknown>) {
  try {
    const result = await run();
    if (isFailure(result)) {
      return errorToolResult(computerUseFailureMessage(result));
    }
    if (isSuccess(result)) {
      if (record(result.result)?.success === false) {
        return errorToolResult(String(record(result.result)?.error ?? 'Computer Use action failed.'));
      }
      return structuredToolResult(result.result);
    }
    return structuredToolResult(result);
  } catch (error) {
    return errorToolResult(error instanceof Error ? error.message : String(error));
  }
}

async function computerUseAppStateResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await run();
    if (isFailure(value)) return errorToolResult(computerUseFailureMessage(value));
    const result = isSuccess(value) ? value.result : value;
    const payload = record(result);
    if (!payload) return errorToolResult('Computer Use returned invalid app state.');

    const screenshot = screenshotProjection(payload.screenshot);
    // Structured-first clients (Claude Code) read only structuredContent, so
    // the tree lives there once rather than being duplicated in text content.
    const { text: hierarchyText, contextSnapshot: _contextSnapshot, ...metadata } = payload;
    const structuredContent = {
      ...metadata,
      ...(typeof hierarchyText === 'string' ? { text: hierarchyText } : {}),
      ...(Object.hasOwn(payload, 'screenshot') ? { screenshot: screenshot?.metadata ?? null } : {}),
    };
    return {
      content: [
        { type: 'text', text: STRUCTURED_TOOL_RESULT_NOTICE },
        ...(screenshot?.data ? [{ type: 'image' as const, data: screenshot.data, mimeType: screenshot.mimeType }] : []),
      ],
      structuredContent,
      isError: false,
    };
  } catch (error) {
    return errorToolResult(error instanceof Error ? error.message : String(error));
  }
}

async function computerUseScreenshotResult(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await run();
    if (isFailure(value)) return errorToolResult(computerUseFailureMessage(value));
    const result = isSuccess(value) ? value.result : value;
    const payload = record(result);
    const screenshot = screenshotProjection(payload);
    if (!payload || !screenshot?.data) return errorToolResult('Computer Use returned an invalid screenshot.');
    return {
      content: [
        { type: 'text', text: screenshotCoordinateGuide(screenshot.coordinateSystem) },
        { type: 'image', data: screenshot.data, mimeType: screenshot.mimeType },
      ],
      structuredContent: screenshot.metadata,
      isError: false,
    };
  } catch (error) {
    return errorToolResult(error instanceof Error ? error.message : String(error));
  }
}

type ScreenshotProjection = {
  coordinateSystem: ScreenshotCoordinateSystem;
  data: string | null;
  metadata: Record<string, unknown>;
  mimeType: string;
};

function screenshotProjection(value: unknown): ScreenshotProjection | null {
  const payload = record(value);
  if (!payload) return null;
  const image = record(payload.image);
  if (!image) return null;
  const data = typeof image.dataBase64 === 'string' ? image.dataBase64 : null;
  const mimeType = typeof image.mimeType === 'string' ? image.mimeType : 'image/png';
  const { dataBase64: _dataBase64, ...imageMetadata } = image;
  const coordinateSystem = screenshotCoordinateSystem(payload, imageMetadata);
  return {
    coordinateSystem,
    data,
    metadata: {
      ...payload,
      image: imageMetadata,
      coordinateSystem,
    },
    mimeType,
  };
}

type ScreenshotCoordinateSystem = {
  bounds?: { height: number; width: number; x: number; y: number };
  imageScaleFactor?: number;
  origin: 'top-left-main-display';
  type: 'macos-global-logical-points';
  units: 'logical-points';
  xDirection: 'right';
  yDirection: 'down';
};

function screenshotCoordinateSystem(
  payload: Record<string, unknown>,
  image: Record<string, unknown>,
): ScreenshotCoordinateSystem {
  const target = record(payload.scope === 'screen' ? payload.screen : payload.window);
  const bounds = rectangle(record(target?.bounds));
  const scaleFactor = positiveNumber(image.scaleFactor);
  return {
    type: 'macos-global-logical-points',
    origin: 'top-left-main-display',
    units: 'logical-points',
    xDirection: 'right',
    yDirection: 'down',
    ...(bounds ? { bounds } : {}),
    ...(scaleFactor ? { imageScaleFactor: scaleFactor } : {}),
  };
}

function screenshotCoordinateGuide(coordinateSystem: ScreenshotCoordinateSystem): string {
  const lines = [
    'Click coordinates are absolute macOS logical screen points: (0,0) is the top-left of the main display and y increases downward.',
    'Use screen scope to capture and click the menu bar. Displays left of or above the main display can have negative origins.',
  ];
  const { bounds, imageScaleFactor } = coordinateSystem;
  if (bounds) {
    lines.push(`Captured absolute bounds: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}.`);
  }
  if (bounds && imageScaleFactor) {
    lines.push(`Convert an original-image pixel (px, py) to a click with x=${bounds.x}+px/${imageScaleFactor}, y=${bounds.y}+py/${imageScaleFactor}. Do not use rendered preview pixels.`);
  }
  return lines.join('\n');
}

function rectangle(value: Record<string, unknown> | null): ScreenshotCoordinateSystem['bounds'] | undefined {
  if (!value) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = positiveNumber(value.width);
  const height = positiveNumber(value.height);
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isSuccess(value: unknown): value is { ok: true; result: unknown } {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true && 'result' in value;
}

function isFailure(value: unknown): value is { error: string; errorCode?: string; ok: false } {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false && typeof (value as { error?: unknown }).error === 'string';
}

function computerUseFailureMessage(failure: { error: string; errorCode?: string }): string {
  return failure.errorCode ? `${failure.errorCode}: ${failure.error}` : failure.error;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
