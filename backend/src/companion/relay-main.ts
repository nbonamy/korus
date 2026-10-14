import { runCompanionRelay } from './relay-cli';
import { relayStartupMessage } from './relay-startup-error';
void runCompanionRelay(process.argv[2] ?? '').catch((error: unknown) => {
  process.stderr.write(`${relayStartupMessage(error)}\n`);
  process.exitCode = 1;
});
