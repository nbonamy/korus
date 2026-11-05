import { runCli } from './run-cli';
import { CliError } from './context';
const cancellation = new AbortController();
const interrupt = () => cancellation.abort(new CliError('Cancelled.', 130));
const terminate = () => cancellation.abort(new CliError('Cancelled.', 143));
process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
process.stdout.on('error', error => { if ('code' in error && error.code === 'EPIPE') process.exit(0); else throw error; });
try { process.exitCode = await runCli(process.argv.slice(2), { signal: cancellation.signal }); }
finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
