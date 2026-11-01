import { runCollector } from "./cli";
import {
  createDiagnostics,
  diagnosticService,
  writeDiagnosticLine,
} from "./diagnostics";

// A closed supervisor pipe must not crash the service or expose an error dump.
process.stdout.on("error", () => {});
const diagnostics = createDiagnostics(
  diagnosticService(process.argv[2]),
  writeDiagnosticLine,
);
const fatal = (error: unknown) => {
  diagnostics.failure("process", error, "process_failed");
  process.exit(1);
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);
void runCollector(process.argv.slice(2), process.env, writeDiagnosticLine)
  .then((runtime) => {
    if (!runtime) return;
    const stop = () => {
      void runtime.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  })
  .catch(() => {
    process.exitCode = 1;
  });
