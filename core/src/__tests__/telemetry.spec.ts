import { describe, it, expect } from 'vitest';
import { isTelemetryReport, publicModel, type TelemetryReport } from '../telemetry';
const report: TelemetryReport = { schema:1, reportId:'a1234567-1234-4123-8123-123456789012', family:'runtime',version:'0.33.0',channel:'stable',platform:'macos',client:'desktop',rows:[{day:'2026-10-11',metric:'turn.started',provider:'codex',model:'unknown',value:1}] };
describe('telemetry wire privacy', () => {
  it('accepts only finite aggregate dimensions and rejects sensitive or unbounded payloads', () => {
    expect(isTelemetryReport(report)).toBe(true);
    for (const bad of [{...report,agentId:'secret'}, {...report,rows:[{...report.rows[0],model:'private-secret'}]}, {...report,rows:[{...report.rows[0],value:NaN}]}, {...report,rows:[{...report.rows[0],value:1.5}]}, {...report,rows:[{...report.rows[0],day:'2026-02-31'}]}, {...report,rows:[...report.rows,...report.rows]}, {...report,family:'feature'}, {...report,rows:[{...report.rows[0],url:'secret'}]}]) expect(isTelemetryReport(bad)).toBe(false);
    expect(publicModel('private-company-model')).toBe('custom');
    expect(publicModel(null)).toBe('unknown');
  });
});
it('bounds the behavior family and allows an explicitly measured zero without accepting zero observation counts or content',()=>{
 const behavior={...report,family:'behavior',rows:[{day:'2026-10-11',provider:'claude',model:'claude-sonnet-4-6',metric:'behavior.toolCalls',value:0}]};
 expect(isTelemetryReport(behavior)).toBe(true);
 for(const invalid of [{...behavior,family:'runtime'},{...behavior,rows:[{...behavior.rows[0],metric:'behavior.toolsObserved'}]},{...behavior,rows:[{...behavior.rows[0],value:-1}]},{...behavior,rows:[{...behavior.rows[0],commands:'secret'}]}])expect(isTelemetryReport(invalid)).toBe(false);
});
