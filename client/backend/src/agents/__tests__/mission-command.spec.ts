import { describe, expect, it } from 'vitest';
import { MISSION_COMMAND_PROMPT, expandMissionCommand } from '../mission-command';

describe('expandMissionCommand', () => {
  it('asks the model to call create-mission with a self-contained brief', () => {
    expect(MISSION_COMMAND_PROMPT).toContain('create-mission');
    expect(MISSION_COMMAND_PROMPT).toContain('self-contained');
    expect(MISSION_COMMAND_PROMPT).toContain('at most 120 characters');
    expect(MISSION_COMMAND_PROMPT).toContain('do not start the work yourself');
  });

  it('works from the conversation when no instructions follow', () => {
    expect(expandMissionCommand('/mission')).toBe(MISSION_COMMAND_PROMPT);
    expect(expandMissionCommand('  /mission  ')).toBe(MISSION_COMMAND_PROMPT);
  });

  it('keeps the user instructions verbatim, including extra lines', () => {
    expect(expandMissionCommand('/mission Add CSV export\nKeep the filters')).toBe(`${MISSION_COMMAND_PROMPT}\n\nMission request:\nAdd CSV export\nKeep the filters`);
  });

  it.each(['mission now', 'please /mission it', '/missions', '/mission-control', '/delegate x', ''])('ignores %j', input => {
    expect(expandMissionCommand(input)).toBeNull();
  });
});
