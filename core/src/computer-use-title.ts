/** The row Korus shows for one of its own Computer Use tool calls. English only. */
export type ComputerUseTitlePhase = 'running' | 'completed' | 'failed';

type Verbs = readonly [completed: string, failed: string, running: string];

/** `{target}` is the control or app the call acted on. */
const verbs: Readonly<Record<string, Verbs>> = {
  'computer-use-click': ['Clicked {target}', 'Failed clicking {target}', 'Clicking {target}'],
  'computer-use-dismiss': ['Dismissed native menu', 'Failed dismissing native menu', 'Dismissing native menu'],
  'computer-use-drag': ['Dragged in {target}', 'Failed dragging in {target}', 'Dragging in {target}'],
  'computer-use-fill-form': ['Filled {target}', 'Failed filling {target}', 'Filling {target}'],
  'computer-use-find-apps': ['Found {target}', 'Failed finding {target}', 'Finding {target}'],
  'computer-use-focus-app': ['Focused {target}', 'Failed focusing {target}', 'Focusing {target}'],
  'computer-use-get-app-state': ['Inspected {target}', 'Failed inspecting {target}', 'Inspecting {target}'],
  'computer-use-guide': ['Loaded Computer Use guide', 'Failed loading Computer Use guide', 'Loading Computer Use guide'],
  'computer-use-launch-app': ['Launched {target}', 'Failed launching {target}', 'Launching {target}'],
  'computer-use-list-apps': ['Listed {target}', 'Failed listing {target}', 'Listing {target}'],
  'computer-use-list-windows': ['Listed {target}', 'Failed listing {target}', 'Listing {target}'],
  'computer-use-paste': ['Pasted content in {target}', 'Failed pasting content in {target}', 'Pasting content in {target}'],
  'computer-use-perform-secondary-action': ['Performed secondary action on {target}', 'Failed performing secondary action on {target}', 'Performing secondary action on {target}'],
  'computer-use-press-key': ['Pressed {target}', 'Failed pressing {target}', 'Pressing {target}'],
  'computer-use-request-accessibility': ['Requested macOS Accessibility access for Computer Use', 'Failed requesting macOS Accessibility access for Computer Use', 'Requesting macOS Accessibility access for Computer Use'],
  'computer-use-request-screen-recording': ['Requested macOS Screen Recording access for Computer Use', 'Failed requesting macOS Screen Recording access for Computer Use', 'Requesting macOS Screen Recording access for Computer Use'],
  'computer-use-screenshot': ['Captured {target}', 'Failed capturing {target}', 'Capturing {target}'],
  'computer-use-scroll': ['Scrolled {target}', 'Failed scrolling {target}', 'Scrolling {target}'],
  'computer-use-select-text': ['Selected text in {target}', 'Failed selecting text in {target}', 'Selecting text in {target}'],
  'computer-use-set-value': ['Updated {target}', 'Failed updating {target}', 'Updating {target}'],
  'computer-use-status': ['Checked Computer Use permissions and availability', 'Failed checking Computer Use permissions and availability', 'Checking Computer Use permissions and availability'],
  'computer-use-stop': ['Stopped the local Computer Use session', 'Failed stopping the local Computer Use session', 'Stopping the local Computer Use session'],
  'computer-use-type-text': ['Entered text in {target}', 'Failed entering text in {target}', 'Entering text in {target}'],
};

const phaseIndex: Record<ComputerUseTitlePhase, 0 | 1 | 2> = { completed: 0, failed: 1, running: 2 };

/** The title of a `computer-use-*` tool call, or undefined for a tool this does not know. */
export function computerUseTitle(tool: string, args: Record<string, unknown>, result: unknown, phase: ComputerUseTitlePhase): string | undefined {
  const entry = verbs[tool];
  return entry?.[phaseIndex[phase]].replace('{target}', () => target(tool, args, result));
}

function target(tool: string, args: Record<string, unknown>, result: unknown): string {
  const app = appTarget(args, result);
  const elementIndex = integer(args.element_index);
  const rootElementIndex = integer(args.rootElementIndex);
  const x = finiteNumber(args.x);
  const y = finiteNumber(args.y);
  // The name the model gave the control reads better than its element number.
  const label = firstString(args.label) ?? reportedControlName(result);

  switch (tool) {
    case 'computer-use-click':
      if (label) return `${label} in ${app}`;
      if (elementIndex !== undefined) return `control #${elementIndex} in ${app}`;
      if (x !== undefined && y !== undefined) return `${app} at (${x}, ${y})`;
      return `app control in ${app}`;
    case 'computer-use-find-apps':
      return hasExplicitAppTarget(args) ? `installed apps matching ${app}` : 'installed apps';
    case 'computer-use-focus-app':
    case 'computer-use-launch-app':
      return app;
    case 'computer-use-get-app-state':
      if (label && rootElementIndex !== undefined) return `${label} in ${app}`;
      return rootElementIndex === undefined ? app : `control #${rootElementIndex} in ${app}`;
    case 'computer-use-list-apps': {
      const count = resultArrayLength(result, 'apps');
      return count === undefined ? 'open apps' : `${count} open apps`;
    }
    case 'computer-use-list-windows': {
      const count = resultArrayLength(result, 'windows');
      return count === undefined ? `${app} windows` : `${count} ${app} windows`;
    }
    case 'computer-use-scroll': {
      const direction = firstString(args.direction);
      if (label) return `${label}${direction ? ` ${direction}` : ''} in ${app}`;
      return elementIndex === undefined
        ? `${direction ?? ''}${direction ? ' in ' : ''}${app}`
        : `control #${elementIndex}${direction ? ` ${direction}` : ''} in ${app}`;
    }
    case 'computer-use-screenshot': {
      if (args.scope === 'screen') {
        const displayId = integer(args.displayId);
        return `${displayId === undefined ? 'main display' : `display ${displayId}`} screenshot`;
      }
      return `${app} window screenshot`;
    }
    case 'computer-use-set-value':
    case 'computer-use-select-text':
    case 'computer-use-perform-secondary-action':
      if (label) return `${label} in ${app}`;
      return elementIndex === undefined ? `app control in ${app}` : `control #${elementIndex} in ${app}`;
    case 'computer-use-fill-form': {
      const count = Array.isArray(args.fields) ? args.fields.length : 0;
      return count === 0 ? app : `${count} ${count === 1 ? 'field' : 'fields'} in ${app}`;
    }
    case 'computer-use-press-key': {
      const key = firstString(args.key);
      return key ? `${key} in ${app}` : app;
    }
    case 'computer-use-type-text':
      return label ? `${label} in ${app}` : app;
    default:
      return app;
  }
}

/** The name of the control the helper says it acted on, so a call without a label still reads well once it is done. */
function reportedControlName(result: unknown): string | undefined {
  for (const payload of nestedResultRecords(result)) {
    const target = isRecord(payload.target) ? payload.target : undefined;
    const name = target ? firstString(target.title, target.description) : undefined;
    if (name) return name.length > 40 ? `${name.slice(0, 39)}…` : name;
  }
  return undefined;
}

function appTarget(args: Record<string, unknown>, result: unknown): string {
  return resultAppName(result) ??
    firstString(args.app, args.name, args.appName) ??
    appNameFromPath(firstString(args.path)) ??
    firstString(args.bundleIdentifier) ??
    (integer(args.pid) === undefined ? 'frontmost app' : 'target app');
}

function resultAppName(result: unknown): string | undefined {
  for (const payload of nestedResultRecords(result)) {
    const app = isRecord(payload.app) ? payload.app : undefined;
    const name = app ? firstString(app.localizedName, app.name) : undefined;
    if (name) return name;
  }
  return undefined;
}

function resultArrayLength(result: unknown, key: string): number | undefined {
  for (const payload of nestedResultRecords(result)) {
    if (Array.isArray(payload[key])) return payload[key].length;
  }
  return undefined;
}

function nestedResultRecords(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) return [];
  const records = [result];
  for (const key of ['structuredContent', 'result']) {
    if (isRecord(result[key])) records.push(result[key]);
  }
  return records;
}

function hasExplicitAppTarget(args: Record<string, unknown>): boolean {
  return firstString(args.app, args.name, args.appName, args.bundleIdentifier, args.path) !== undefined;
}

function appNameFromPath(value: string | undefined): string | undefined {
  const name = value?.split('/').filter(Boolean).at(-1)?.replace(/\.app$/u, '').trim();
  return name || undefined;
}

function firstString(...values: unknown[]): string | undefined {
  const value = values.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return value?.trim();
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
