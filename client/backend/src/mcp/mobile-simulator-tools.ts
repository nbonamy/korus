import * as z from 'zod/v4';
import type { MobileCatalog, MobileRequest, MobileResult } from '@workspace/core/mobile-simulator';
import type { AppMcpToolModuleProvider } from './tool-modules';
import { loggedToolResult } from './tool-modules';

export function createMobileSimulatorToolModuleProvider(
  execute: ((agentId: string, input: MobileRequest) => Promise<MobileResult>) | undefined,
): AppMcpToolModuleProvider {
  return {
    id: 'mobile-simulator',
    resolve: ({ agentId }) =>
      execute
        ? {
            id: 'mobile-simulator',
            register(server) {
              server.registerTool(
                'simulator',
                {
                  description:
                    'Control local iOS simulators or Android emulators; read korus-simulator first. Device actions require the exclusive attachmentId. Tap/swipe use screenshot pixels and dimensions. Input delivery is not settled UI; use waitMs and observe. No physical/remote devices, installation or builds.',
                  inputSchema: flatInput,
                },
                async (input) => {
                  let image: MobileResult['frame'];
                  const result = await loggedToolResult('simulator', { agentId, action: input.action }, async () => {
                    const parsed = request.safeParse(input);
                    if (!parsed.success)
                      throw new Error(
                        `Invalid ${input.action} request: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`,
                      );
                    // Actions return once the input is delivered, not once the app has reacted. The caller knows
                    // its app, so any pause is explicit: before a read, after anything else.
                    const waitMs = input.waitMs ?? 0;
                    const reads = parsed.data.action === 'screenshot' || parsed.data.action === 'inspect';
                    if (reads) await pause(waitMs);
                    const value = await execute(agentId, parsed.data);
                    if (!reads) await pause(waitMs);
                    image = value.frame;
                    const { frame, catalog, ...metadata } = value;
                    return {
                      ...metadata,
                      ...(catalog ? { catalog: groupCatalog(catalog) } : {}),
                      ...(frame ? { screen: { width: frame.width, height: frame.height, scale: frame.scale } } : {}),
                    };
                  });
                  if (image && !result.isError)
                    result.content.push({ type: 'image', mimeType: image.mimeType, data: image.data });
                  return result;
                },
              );
            },
          }
        : undefined,
  };
}
const coordinate = z.number().finite().nonnegative().max(10000);
const BUTTONS = ['home', 'back', 'enter', 'backspace', 'volumeUp', 'volumeDown', 'power'] as const;
const MAX_WAIT_MS = 10_000;
function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
const actionNames = [
  'list',
  'status',
  'attach',
  'detach',
  'shutdown',
  'screenshot',
  'inspect',
  'tap',
  'swipe',
  'text',
  'button',
  'launch',
] as const;
/** Flat object schema: clients cannot read argument types from a top-level union. Strict per-action checks follow in `request`. */
const flatInput = z.object({
  action: z.enum(actionNames),
  deviceId: z.string().optional().describe('attach: id from list'),
  attachmentId: z.string().optional().describe('every action except list, status and attach: id returned by attach'),
  x: z.number().optional().describe('tap, swipe: start x in screenshot pixels'),
  y: z.number().optional().describe('tap, swipe: start y in screenshot pixels'),
  toX: z.number().optional().describe('swipe: end x in screenshot pixels'),
  toY: z.number().optional().describe('swipe: end y in screenshot pixels'),
  width: z.number().optional().describe('tap, swipe: width of the screenshot the coordinates refer to'),
  height: z.number().optional().describe('tap, swipe: height of the screenshot the coordinates refer to'),
  durationMs: z.number().optional().describe('swipe: 100 to 3000'),
  text: z.string().optional().describe('text: printable ASCII to type'),
  button: z.enum(BUTTONS).optional().describe('button: key to press (power toggles the screen lock; volume shows the volume indicator)'),
  appId: z.string().optional().describe('launch: bundle or package id'),
  waitMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_MS)
    .optional()
    .describe('pause in ms: after a tap, swipe, text, button, launch or attach before returning; before a screenshot or inspect'),
});

const target = { attachmentId: z.string().min(1).max(200) };
const point = {
  x: coordinate,
  y: coordinate,
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
};

const request = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('status') }),
  z.object({ action: z.literal('attach'), deviceId: z.string().min(1).max(200) }),
  ...(['detach', 'shutdown', 'screenshot', 'inspect'] as const).map((action) =>
    z.object({ action: z.literal(action), attachmentId: z.string().min(1).max(200) }),
  ),
  z.object({ action: z.literal('tap'), ...target, ...point }),
  z.object({
    action: z.literal('swipe'),
    ...target,
    ...point,
    toX: coordinate,
    toY: coordinate,
    durationMs: z.number().min(100).max(3000),
  }),
  z.object({ action: z.literal('text'), ...target, text: z.string().max(2000) }),
  z.object({
    action: z.literal('button'),
    ...target,
    button: z.enum(BUTTONS),
  }),
  z.object({
    action: z.literal('launch'),
    ...target,
    appId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,199}$/),
  }),
]);

/** Devices per platform, split into booted and shutdown, so the model never has to filter a flat list. */
function groupCatalog(catalog: MobileCatalog) {
  const platforms: Record<string, { booted: unknown[]; shutdown: unknown[] }> = {};
  for (const device of catalog.devices) {
    const group = (platforms[device.platform] ??= { booted: [], shutdown: [] });
    group[device.state].push({
      id: device.id,
      name: device.name,
      ...(device.owner ? { attachedToAnotherAgent: true } : {}),
    });
  }
  return { platforms, setup: catalog.setup };
}
