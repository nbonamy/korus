import type { ProviderInstallation } from './provider-updates';

/** Host IO shared by registered update adapters; no consent or lifecycle authority. */
export type ProviderUpdateIO = {
  resolve(command: string): string | null;
  realpath(file: string): Promise<string>;
  read(file: string): Promise<string>;
  run(file: string, args: string[], timeout: number, env?: NodeJS.ProcessEnv): Promise<string>;
  fetchText(url: string): Promise<string>;
  home: string;
  platform: NodeJS.Platform;
};

export type ProviderUpdateAdapter = {
  inspect(): Promise<ProviderInstallation>;
  upgrade(installation: ProviderInstallation): Promise<void>;
};
