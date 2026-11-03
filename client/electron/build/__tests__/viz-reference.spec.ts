// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import config from '../../forge.config';

it('ships the approved reference as a Forge resource outside app.asar', async () => {
  const resources=config.packagerConfig?.extraResource;
  const directory=path.resolve(import.meta.dirname,'../../assets/viz');
  expect(resources).toContain(directory);
  const bytes=await readFile(path.join(directory,'reference.png'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('a371a9700afb84c21bb5c07f8fa96abda45a7b7555c949b9351a6f79e7e1f33b');
});
