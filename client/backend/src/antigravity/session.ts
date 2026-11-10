import { AcpSession as NativeSession } from 'multi-agents-sdk/providers/antigravity';
import { product } from '@workspace/core/product';
import { appAcpRuntimeOptions } from './acp-runtime';
import { antigravityHome } from './runtime';
export type AcpSession = NativeSession;
export const AcpSession = { open: (options: Parameters<typeof NativeSession.open>[0]) => NativeSession.open({
  ...options, home: options.home ?? antigravityHome(), runtimeOptions: { ...appAcpRuntimeOptions(), ...options.runtimeOptions },
  client: { metadataDirectory: 'korus-sessions', trustedMcpServerName: product.mcpServerName },
}) };
