import { runCompanionRelay } from './relay-cli';
void runCompanionRelay(process.argv[2] ?? '').catch(() => {
  process.stderr.write('Relay startup failed. Check the protected operator configuration, TLS certificate and persistent identity.\n');
  process.exitCode = 1;
});
