export type SdkSources = { enabled: boolean; root: string; aliases: { find: RegExp; replacement: string }[]; paths: Record<string, string[]>; typePaths: Record<string, string[]> };
export function sdkSources(projectRoot: string, environment?: Record<string, string | undefined>, requested?: string[]): SdkSources;
export function sourceTypecheck(projectRoot: string, args: string[], environment?: Record<string, string | undefined>): { args: string[]; cleanup(): void };
