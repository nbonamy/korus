import { AcpRuntime as NativeRuntime } from 'multi-agents-sdk/providers/antigravity/acp-runtime';
import { product } from '@workspace/core/product';
import { acpEnvironment, antigravityHome, resolveAcpRuntime } from './runtime';
export { NativeLoginRequired } from 'multi-agents-sdk/providers/antigravity/acp-runtime';
export type AcpRuntime = NativeRuntime;
export function appAcpRuntimeOptions() {
  const runtime = resolveAcpRuntime();
  if (!runtime) throw new Error('Install the Antigravity ACP runtime and matching harness in Settings.');
  return { runtime, home: antigravityHome(),
    client: { name: product.mcpServerName, title: product.name, temporaryDirectory: 'korus-tmp' },
    environment: acpEnvironment,
  };
}
export const AcpRuntime = { open: (options: Parameters<typeof NativeRuntime.open>[0]) => NativeRuntime.open({ ...appAcpRuntimeOptions(), ...options }) };
