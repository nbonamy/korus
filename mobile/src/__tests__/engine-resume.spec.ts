import { afterEach, describe, expect, it } from 'vitest';
import { createEngine } from '../engine';
import { createDemoConnector } from '../demo-connector';
import { setConnectionDiagnosticSink, type ConnectionDiagnostic } from '../connection-diagnostics';

afterEach(() => setConnectionDiagnosticSink(undefined));
describe('resume timeline', () => {
  it('records how long the phone was away and when the conversation was usable again', async () => {
    const records: ConnectionDiagnostic[] = []; setConnectionDiagnosticSink(record => { records.push(record); });
    const engine = createEngine({ connector: createDemoConnector(), post: () => {} });
    try {
      await engine.start(); await engine.dispatch({ type: 'selectTeam', id: 'demo-team' }); await engine.dispatch({ type: 'selectAgent', id: 'demo-agent' });
      records.length = 0;
      await engine.dispatch({ type: 'activity', active: false });
      await engine.dispatch({ type: 'activity', active: true });
      const resume = records.filter(record => record.event.startsWith('resume.'));
      expect(resume.map(record => record.event)).toStrictEqual(['resume.start', 'resume.settled']);
      expect(resume[0]).toMatchObject({ idleMs: expect.any(Number) });
      expect(resume[1]).toMatchObject({ stage: 'connected', reason: 'ready', elapsedMs: expect.any(Number) });
    } finally { engine.dispose(); }
  });
  it('adds the native lifecycle events it is handed to the timeline and ignores anything else', async () => {
    const records: ConnectionDiagnostic[] = []; setConnectionDiagnosticSink(record => { records.push(record); });
    const engine = createEngine({ connector: createDemoConnector(), post: () => {} });
    try {
      await engine.dispatch({ type: 'nativeDiagnostic', event: 'app.background-execution', stage: 'expired' });
      await engine.dispatch({ type: 'nativeDiagnostic', event: 'app.foreground-dispatched', stage: 'ready', elapsedMs: 41 });
      await engine.dispatch({ type: 'nativeDiagnostic', event: 'private.prompt-text', stage: 'secret' });
      expect(records.filter(record => record.event.startsWith('app.') && record.event !== 'app.activity')).toMatchObject([
        { event: 'app.background-execution', stage: 'expired' }, { event: 'app.foreground-dispatched', stage: 'ready', elapsedMs: 41 }]);
      expect(records.some(record => record.event === 'private.prompt-text')).toBe(false);
    } finally { engine.dispose(); }
  });
});
