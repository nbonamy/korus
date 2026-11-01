/**
 * A log-safe reason for a failure: never the stack, and for schema errors only which fields failed,
 * because the message of a validation error can echo what the peer sent.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error && error.name === 'ZodError' && 'issues' in error && Array.isArray(error.issues)) {
    return `invalid ${error.issues.slice(0, 5).map((issue: { path?: unknown[]; code?: string }) => `${(issue.path ?? []).join('.')}:${issue.code}`).join(',')}`;
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
