import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tests never write into the person's real app home: its log, state and sessions belong to the running app.
// The home is replaced even when one is already set, because an agent running inside the app inherits the app's own.
// A test that needs a particular home still sets one itself.
const home = path.join(os.tmpdir(), `korus-test-home-${process.pid}`);
mkdirSync(home, { recursive: true });
process.env.APP_HOME = home;
delete process.env.KORUS_HOME;
