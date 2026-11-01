/** Canonical application home override; APP_HOME takes precedence over its alias. */
export function configuredAppHome(env: Readonly<Record<string, string | undefined>>): string | undefined {
  return env.APP_HOME?.trim() || env.KORUS_HOME?.trim() || undefined;
}
