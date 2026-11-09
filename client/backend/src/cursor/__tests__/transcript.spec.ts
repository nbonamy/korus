import { describe, expect, it } from 'vitest';
import { CursorTranscript } from '../transcript';
import { cursorContent } from '../content';

function live() {
  const transcript = new CursorTranscript('agent', 'session', () => {});
  transcript.start('hello');
  return transcript;
}

describe('Cursor transcript presentation updates', () => {
  it('keeps a live turn open when the CLI emits an unknown sessionUpdate', () => {
    const transcript = live();
    expect(() => transcript.update({ sessionUpdate: 'future_session_update' })).not.toThrow();
    expect(transcript.replica.getSnapshot().busy).toBe(true);
    expect(() => transcript.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } })).not.toThrow();
    expect(transcript.replica.getSnapshot().messages.flatMap(message => message.parts)).toContainEqual({ type: 'text', text: 'Hello' });
  });

  it('ignores unknown content variants and still rejects malformed known image payloads', () => {
    const transcript = live();
    expect(() => transcript.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'future_block', value: 1 } })).not.toThrow();
    expect(cursorContent({ type: 'future_block', value: 1 })).toStrictEqual({});
    expect(() => cursorContent(null)).toThrow(/Invalid Cursor content/);
    expect(() => cursorContent({ type: 'image', mimeType: 'image/png', data: 'not-base64!!!' })).toThrow(/Invalid Cursor image/);
    expect(transcript.replica.getSnapshot().busy).toBe(true);
  });
});
