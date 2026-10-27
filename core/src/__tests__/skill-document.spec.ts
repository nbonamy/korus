import { describe, expect, it } from 'vitest';
import { parseSkillDocument } from '../skill-manager';

describe('parseSkillDocument', () => {
  it('separates name and description from the Markdown body', () => {
    const parsed = parseSkillDocument('---\nname: review\ndescription: "Review a change."\nlicense: MIT\n---\n# Review\n\nRead the diff.\n', 'fallback');
    expect(parsed).toEqual({ name: 'review', description: 'Review a change.', body: '# Review\n\nRead the diff.\n' });
  });

  it('joins folded descriptions and falls back to the folder name', () => {
    const parsed = parseSkillDocument('---\ndescription: >\n  First line\n  second line\n---\nBody', 'folder-name');
    expect(parsed).toEqual({ name: 'folder-name', description: 'First line second line', body: 'Body' });
  });

  it('treats a document without front matter as all body', () => {
    expect(parseSkillDocument('# Just notes\n', 'notes')).toEqual({ name: 'notes', description: '', body: '# Just notes\n' });
  });
});
