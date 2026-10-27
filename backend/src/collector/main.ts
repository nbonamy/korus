import { runCollector } from "./cli";

void runCollector(process.argv.slice(2))
  .then((runtime) => {
    if (!runtime) return;
    process.stdout.write("Collector ready.\n");
    const stop = () => {
      void runtime.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  })
  .catch(() => {
    process.stderr.write("Collector startup failed.\n");
    process.exitCode = 1;
  });
