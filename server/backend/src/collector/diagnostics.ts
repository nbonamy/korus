type Service = "collector" | "metrics" | "auth" | "migration" | "server";
type Operation =
  | "configuration"
  | "database_readiness"
  | "migration"
  | "credentials"
  | "listen"
  | "shutdown"
  | "telemetry_write"
  | "metrics_read"
  | "auth_session"
  | "database_pool"
  | "request"
  | "process";
export type DiagnosticSink = (line: string) => void;
export type Diagnostics = ReturnType<typeof createDiagnostics>;

export function diagnosticService(mode: string | undefined): Service {
  switch (mode) {
    case "serve":
      return "collector";
    case "read":
      return "metrics";
    case "auth":
      return "auth";
    case "migrate":
      return "migration";
    default:
      return "server";
  }
}

// Only recognized codes and authored descriptions reach the output. Error
// messages, stacks and PostgreSQL details can embed credentials or request data.
const causes: Record<string, readonly [string, string]> = {
  SCHEMA_NOT_READY: ["database_schema_mismatch", "Database schema is incompatible; apply server migrations."],
  ENOENT: ["file_missing", "Required operator file does not exist."],
  EACCES: [
    "permission_denied",
    "Permission denied opening a file or listener.",
  ],
  EADDRINUSE: ["address_in_use", "Listener address is already in use."],
  EADDRNOTAVAIL: [
    "address_unavailable",
    "Listener address is unavailable on this host.",
  ],
  ECONNREFUSED: ["connection_refused", "Dependency refused the connection."],
  ECONNRESET: ["connection_reset", "Dependency reset the connection."],
  ENOTFOUND: ["host_not_found", "Dependency hostname could not be resolved."],
  EAI_AGAIN: ["dns_unavailable", "Dependency DNS lookup temporarily failed."],
  ETIMEDOUT: ["connection_timeout", "Dependency connection timed out."],
  "08006": ["database_connection_failed", "Database connection failed."],
  "28P01": [
    "database_authentication_failed",
    "Database rejected the service credentials.",
  ],
  "3D000": ["database_missing", "Configured database does not exist."],
  "42P01": [
    "database_schema_missing",
    "Database table is missing; apply server migrations.",
  ],
  "42703": [
    "database_schema_mismatch",
    "Database column is missing; check server migrations.",
  ],
  "42501": [
    "database_permission_denied",
    "Database role lacks the required grant.",
  ],
  "53300": [
    "database_connections_exhausted",
    "Database connection limit was reached.",
  ],
  "57014": [
    "database_query_cancelled",
    "Database query was cancelled or exceeded its statement deadline.",
  ],
  "55P03": [
    "database_lock_timeout",
    "Database lock was unavailable or exceeded its deadline.",
  ],
  "40P01": [
    "database_deadlock",
    "Database transaction was aborted by a deadlock.",
  ],
  "40001": [
    "database_serialization_failure",
    "Database transaction could not be serialized.",
  ],
  "23503": [
    "database_constraint_violation",
    "Database foreign key constraint rejected the write.",
  ],
  "23505": [
    "database_constraint_violation",
    "Database uniqueness constraint rejected the write.",
  ],
  "23514": [
    "database_constraint_violation",
    "Database check constraint rejected the write.",
  ],
  P0001: ["database_exception", "Database procedure rejected the operation."],
  "57P01": [
    "database_shutdown",
    "Database connection was terminated by an administrator or shutdown.",
  ],
};

function cause(error: unknown, operation: Operation) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (typeof code === "string" && Object.hasOwn(causes, code)) {
    const [reason, message] = causes[code]!;
    return { reason, code, message };
  }
  // pg's client-side deadlines and disconnects have no error code. Match only
  // exact library messages; never serialize the supplied message itself.
  if (error instanceof Error) {
    if (
      [
        "Query read timeout",
        "timeout exceeded when trying to connect",
        "Connection terminated due to connection timeout",
      ].includes(error.message)
    )
      return {
        reason: "database_timeout",
        message:
          "Database client deadline expired waiting for a connection or query.",
      };
    if (
      ["Connection terminated unexpectedly", "Connection terminated"].includes(
        error.message,
      )
    )
      return {
        reason: "database_disconnected",
        message: "Database connection closed unexpectedly.",
      };
  }
  return operation === "configuration" || operation === "credentials"
    ? {
        reason: "invalid_configuration",
        message: "Operator configuration or service credentials are invalid.",
      }
    : {
        reason: "unexpected_error",
        message: "Unexpected internal failure in the named operation.",
      };
}

function applicationLocations(error: unknown): string[] {
  if (!(error instanceof Error) || typeof error.stack !== "string") return [];
  // Keep only known application filenames and numeric source positions. Omit
  // the error text, function names, host paths and all unrecognized frames.
  return error.stack
    .split("\n")
    .slice(1, 12)
    .flatMap((line) => {
      const match =
        /[/\\](cli|main|server|store|metrics-server|console-auth|collector)\.(ts|mjs):(\d{1,8}):(\d{1,8})\)?$/.exec(
          line.trim(),
        );
      return match ? [`${match[1]}.${match[2]}:${match[3]}:${match[4]}`] : [];
    })
    .slice(0, 6);
}

export function createDiagnostics(
  service: Service,
  sink: DiagnosticSink = () => {},
) {
  const emit = (record: object) => {
    // Diagnostics must not turn a recoverable failure into an unhandled error.
    try {
      sink(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service,
          ...record,
        }) + "\n",
      );
    } catch {
      /* unavailable output */
    }
  };
  return {
    info(event: "ready" | "stopped" | "migration_complete") {
      emit({ level: "info", event });
    },
    failure(
      operation: Operation,
      error: unknown,
      event:
        | "operation_failed"
        | "startup_failed"
        | "process_failed" = "operation_failed",
    ) {
      try {
        const classified = cause(error, operation);
        const locations =
          classified.reason === "unexpected_error"
            ? applicationLocations(error)
            : [];
        emit({
          level: "error",
          event,
          operation,
          ...classified,
          ...(locations.length ? { locations } : {}),
        });
      } catch {
        /* malformed error object */
      }
    },
  };
}

export const writeDiagnosticLine: DiagnosticSink = (line) => {
  // Avoid an unbounded Node write queue when the supervisor stops consuming.
  if (!process.stdout.destroyed && !process.stdout.writableNeedDrain)
    process.stdout.write(line);
};
