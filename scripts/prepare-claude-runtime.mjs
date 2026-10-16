import path from 'node:path';
import { parseArgs } from 'node:util';
import { prepareClaudeRuntime } from './claude-runtime.mjs';

const { values } = parseArgs({ options: {
  platform: { type: 'string', default: process.platform },
  arch: { type: 'string', default: process.arch },
  output: { type: 'string' },
} });
const root = path.resolve(import.meta.dirname, '..');
if (!values.output) throw new Error('Claude runtime output directory is required.');
const executable = await prepareClaudeRuntime({ root, platform: values.platform, arch: values.arch, outputDir: path.resolve(values.output) });
console.log(`[prepare-claude-runtime] ${values.platform}/${values.arch}: ${executable}`);
