import { app, protocol } from 'electron';
import started from 'electron-squirrel-startup';
import { startMainApp } from './app-controller';
import { registerLocalMediaScheme } from './local-media';
import { configureDesktopIdentity } from './desktop-identity';
import { warnMain } from './log';

try {
  configureDesktopIdentity(app);
} catch (error) {
  warnMain('startup', 'failed to register desktop identity', { detail: String(error) });
}
registerLocalMediaScheme(protocol);

if (started) {
  app.quit();
} else {
  startMainApp();
}
