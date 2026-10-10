import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { errorToolResult, structuredToolResult } from './tool-result';

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
    description: 'Read selected-window AX state (full/diff), optional screenshot and waitForText. Read-only menu-bar inspection needs no window ID.',
    inputSchema: appStateInputSchema,
  }, (arguments_) => arguments_.accessibilityScope === 'menu_bar'
    ? observeAppState(computerUse, arguments_)
    : computerUseWindowAppStateResult(computerUse, arguments_));

  server.registerTool('computer-use-screenshot', {
    description: 'Capture an explicitly selected app window or an entire macOS display as a PNG with coordinate metadata.',
    inputSchema: screenshotInputSchema,
  }, (arguments_) => arguments_.scope === 'screen'
    ? computerUseScreenshotResult(() => computerUse.execute({ command: 'screenshot', arguments: arguments_ }))
    : computerUseWindowScreenshotResult(computerUse, arguments_));

  server.registerTool('computer-use-click', {
    description: 'Click by background AX or foreground physical input; observe optionally returns resulting UI state.',
    inputSchema: z.strictObject({
      ...actionTargetSchema,
      click_count: z.number().int().min(1).max(3).optional(),
      mouse_button: z.enum(['left', 'right', 'middle']).optional(),
      physical: z.boolean().optional().describe('Send a foreground mouse click instead of AXPress.'),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'click', arguments_));

  server.registerTool('computer-use-dismiss', {
    description: 'Dismiss an active native menu or popover with its Accessibility cancel action.',
    inputSchema: z.strictObject(semanticOrIndexedTargetSchema),
  }, (arguments_) => executeWindowTargeted(computerUse, 'dismiss', arguments_));

  server.registerTool('computer-use-press-key', {
    description: 'Send one key or X-keysym-style chord directly to a running app process.',
    inputSchema: z.strictObject({
      ...keyboardTargetSchema,
      key: z.string().min(1).max(200),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'press_key', arguments_));

  server.registerTool('computer-use-type-text', {
    description: 'Type into an indexed editable control with internal focus verification. replace=true replaces contents; submit=true presses Return.',
    inputSchema: z.strictObject({
      ...windowTargetSchema,
      element_index: z.number().int().nonnegative().optional(),
      replace: z.boolean().optional(),
      submit: z.boolean().optional(),
      text: z.string().max(100_000),
    }),
  }, (arguments_) => executeWindowTargeted(computerUse, 'type_text', arguments_));

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
  rootElementIndex: z.number().int().nonnegative().optional(),
};

const appStateInputSchema = z.strictObject({
  ...appStateOptionsSchema,
  accessibilityScope: accessibilityScopeSchema,
  window_id: windowIdSchema.optional().describe('Required for application scope; omit only for read-only menu_bar inspection.'),
}).refine((input) => input.accessibilityScope === 'menu_bar' || input.window_id !== undefined, {
  message: 'window_id is required for application observations',
});

const screenshotInputSchema = z.union([
  z.object({
    ...optionalAppSchema,
    displayId: z.number().int().positive().optional(),
    scope: z.literal('screen'),
  }),
  z.object({
    ...optionalAppSchema,
    scope: z.literal('window').optional(),
    window_id: windowIdSchema,
  }),
]);

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
  accessibilityScope: accessibilityScopeSchema,
  element_index: z.number().int().nonnegative().optional(),
  selector: semanticSelectorSchema.optional()
    .describe('Stable semantic AX target. Prefer this over element_index when the UI can change after inspection.'),
  x: z.number().finite().optional().describe('Absolute macOS logical screen x-coordinate, measured rightward from the main display origin. Not a screenshot pixel or window-relative coordinate.'),
  y: z.number().finite().optional().describe('Absolute macOS logical screen y-coordinate, measured downward from the main display origin. Not a screenshot pixel or window-relative coordinate.'),
};

const indexedTargetSchema = {
  ...windowTargetSchema,
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
  const { observe, ...actionArguments } = arguments_;
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
    const { text: hierarchyText, contextSnapshot: _contextSnapshot, ...metadata } = payload;
    const structuredContent = {
      ...metadata,
      ...(Object.hasOwn(payload, 'screenshot') ? { screenshot: screenshot?.metadata ?? null } : {}),
    };
    const text = typeof hierarchyText === 'string' ? hierarchyText : 'Observation metadata returned in structuredContent.';
    return {
      content: [
        { type: 'text', text },
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
